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
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import redis.asyncio as aioredis
from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from .models import Community, Event

log = logging.getLogger("openvoice.events")

EVENT_VERSION = 1

# Channel-scoped event types whose delivery/replay must be gated by the
# subscriber's VIEW_CHANNELS permission for the target channel. A member who
# cannot see a channel must never receive its content — over the WebSocket OR
# via the REST catch-up endpoint (they share event_visible()).
CONTENT_EVENT_TYPES = frozenset(
    {
        "message.created",
        "message.updated",
        "message.deleted",
        "message.reaction_updated",
    }
)

# Event type prefixes that can change what a member may view; receiving one is
# the signal to recompute the viewable-channel set mid-session.
AUTHZ_EVENT_PREFIXES = ("role.", "channel.", "membership.", "community.")


def event_channel_id(envelope: dict[str, Any]) -> str | None:
    """The channel a (content) event belongs to, or None if not channel-scoped."""
    payload = envelope.get("payload")
    if isinstance(payload, dict):
        if payload.get("channel_id"):
            return str(payload["channel_id"])
        message = payload.get("message")
        if isinstance(message, dict) and message.get("channel_id"):
            return str(message["channel_id"])
    return None


def event_visible(envelope: dict[str, Any], viewable_channel_ids: set[str]) -> bool:
    """True unless this is a channel-scoped content event for a channel the
    subscriber cannot view. Shared by WebSocket delivery and REST replay so a
    hidden channel's messages leak through neither path."""
    if envelope.get("type") in CONTENT_EVENT_TYPES:
        channel = event_channel_id(envelope)
        return channel is None or channel in viewable_channel_ids
    return True


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


async def scrub_message_from_events(
    db: AsyncSession, community_id: uuid.UUID, message_id: uuid.UUID
) -> None:
    """Remove a message's content from the durable event log so a deletion
    actually erases the content everywhere — not just from the messages table.
    The message.created/updated events for this id keep their envelope (id,
    author, channel, timestamps) but their content is emptied and marked
    scrubbed, so a reconnecting client replays a content-free record."""
    events = (
        (
            await db.execute(
                select(Event).where(
                    Event.community_id == community_id,
                    Event.type.in_(("message.created", "message.updated")),
                )
            )
        )
        .scalars()
        .all()
    )
    target = str(message_id)
    for event in events:
        payload = event.payload
        message = payload.get("message") if isinstance(payload, dict) else None
        if isinstance(message, dict) and message.get("id") == target:
            new_message = {**message, "content": "", "scheme": "plaintext", "scrubbed": True}
            event.payload = {**payload, "message": new_message}
            # JSONB columns are not mutation-tracked by default; flag the
            # attribute so the reassignment is actually written on commit.
            flag_modified(event, "payload")


async def prune_all_communities(db: AsyncSession, keep_seconds: int) -> int:
    """Prune old events across every community in one pass. Returns the total
    number of rows removed."""
    cutoff = datetime.now(tz=UTC) - timedelta(seconds=keep_seconds)
    result = cast(
        CursorResult[Any], await db.execute(delete(Event).where(Event.created_at < cutoff))
    )
    return int(result.rowcount or 0)


async def prune_old_events(db: AsyncSession, community_id: uuid.UUID, keep_seconds: int) -> int:
    """Delete durable events older than the retention window. Reconnecting
    clients re-fetch current state (message history, membership, etc.) via the
    REST API, so old events are only a catch-up convenience — not a store of
    record — and are bounded to limit how long any content lingers."""
    cutoff = datetime.now(tz=UTC) - timedelta(seconds=keep_seconds)
    result = cast(
        CursorResult[Any],
        await db.execute(
            delete(Event).where(Event.community_id == community_id, Event.created_at < cutoff)
        ),
    )
    return int(result.rowcount or 0)


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
