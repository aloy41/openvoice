"""Per-community durable event log + Redis fanout.

Pattern (master prompt "Realtime behavior"): the event row is written in the
SAME transaction as the change it describes, with a monotonically increasing
per-community sequence. Publishing to Redis after commit is best-effort —
subscribers replay from the event log on (re)connect, so a missed publish
can only delay, never lose, an event.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Community, Event

log = logging.getLogger("openvoice.events")

EVENT_VERSION = 1


def channel_for(community_id: uuid.UUID | str) -> str:
    return f"ov:events:{community_id}"


async def append_event(
    db: AsyncSession, community_id: uuid.UUID, event_type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Append to the community's event log inside the caller's transaction.
    Returns the wire-format envelope (publish it after commit)."""
    seq = (
        await db.execute(
            update(Community)
            .where(Community.id == community_id)
            .values(event_seq=Community.event_seq + 1)
            .returning(Community.event_seq)
        )
    ).scalar_one()
    event = Event(community_id=community_id, seq=seq, type=event_type, payload=payload)
    db.add(event)
    await db.flush()
    return {
        "v": EVENT_VERSION,
        "seq": seq,
        "id": str(event.id),
        "type": event_type,
        "ts": datetime.now(tz=UTC).isoformat(),
        "community_id": str(community_id),
        "payload": payload,
    }


async def publish_event(redis: aioredis.Redis, envelope: dict[str, Any]) -> None:
    """Best-effort post-commit fanout. Failures are logged, never raised —
    the durable log is the source of truth."""
    try:
        await redis.publish(channel_for(envelope["community_id"]), json.dumps(envelope))
    except Exception:
        log.warning(
            "event publish failed; subscribers will catch up from the log",
            extra={"extra_fields": {"type": envelope.get("type")}},
        )


def event_envelope_from_row(event: Event) -> dict[str, Any]:
    return {
        "v": EVENT_VERSION,
        "seq": event.seq,
        "id": str(event.id),
        "type": event.type,
        "ts": event.created_at.isoformat(),
        "community_id": str(event.community_id),
        "payload": event.payload,
    }
