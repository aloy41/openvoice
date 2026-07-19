"""Realtime WebSocket: cookie-authenticated event stream.

Protocol (v1):
  client → {"type": "subscribe", "community_id": "<uuid>", "after_seq": N}
  server → {"type": "subscribed", "community_id": "...", "latest_seq": M}
  server → {"type": "event", ...event envelope...}   (replay, then live)
  server → {"type": "error", "code": "..."}

One community subscription per socket (resubscribing replaces it). Replay
comes from the durable event log before live fanout starts, so a client that
reconnects with its last seen seq never misses an event.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..authz import load_access
from ..events import channel_for, event_envelope_from_row
from ..models import Event, User, UserSession
from ..security import hash_session_secret

log = logging.getLogger("openvoice.ws")

router = APIRouter()


async def _authenticate_ws(websocket: WebSocket) -> User | None:
    settings = websocket.app.state.settings
    secret = websocket.cookies.get(settings.session_cookie_name)
    if not secret:
        return None
    from datetime import UTC, datetime

    token_hash = hash_session_secret(secret)
    async with websocket.app.state.sessionmaker() as db:
        row = (
            await db.execute(
                select(UserSession, User)
                .join(User, User.id == UserSession.user_id)
                .where(UserSession.token_hash == token_hash)
            )
        ).first()
        if row is None:
            return None
        session: UserSession = row[0]
        user: User = row[1]
        now = datetime.now(tz=UTC)
        if session.revoked_at is not None or session.expires_at <= now:
            return None
    return user


@router.websocket("/ws")
async def events_ws(websocket: WebSocket) -> None:
    user = await _authenticate_ws(websocket)
    if user is None:
        # 4401: application-defined "unauthenticated" close code.
        await websocket.close(code=4401)
        return
    await websocket.accept()

    redis = websocket.app.state.redis
    listener: asyncio.Task[None] | None = None

    async def stop_listener() -> None:
        nonlocal listener
        if listener is not None:
            listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await listener
            listener = None

    async def run_listener(community_id: str, min_seq: int) -> None:
        pubsub = redis.pubsub()
        try:
            await pubsub.subscribe(channel_for(community_id))
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(item["data"])
                except (TypeError, ValueError):
                    continue
                # Drop anything already delivered by replay.
                if int(envelope.get("seq", 0)) <= min_seq:
                    continue
                await websocket.send_json({"type": "event", **envelope})
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe()
                await pubsub.aclose()

    try:
        while True:
            raw = await websocket.receive_json()
            if not isinstance(raw, dict) or raw.get("type") != "subscribe":
                await websocket.send_json({"type": "error", "code": "unknown_command"})
                continue
            try:
                community_id = uuid.UUID(str(raw.get("community_id")))
                after_seq = max(0, int(raw.get("after_seq", 0)))
            except (TypeError, ValueError):
                await websocket.send_json({"type": "error", "code": "invalid_subscribe"})
                continue

            async with websocket.app.state.sessionmaker() as db:
                try:
                    access = await load_access(db, community_id, user)
                except Exception:
                    await websocket.send_json({"type": "error", "code": "not_found"})
                    continue
                replay = (
                    (
                        await db.execute(
                            select(Event)
                            .where(Event.community_id == community_id, Event.seq > after_seq)
                            .order_by(Event.seq)
                            .limit(500)
                        )
                    )
                    .scalars()
                    .all()
                )
                latest = access.community.event_seq

            await stop_listener()
            # Start live fanout FIRST, then replay: anything published while
            # we replay is either > replayed seqs (delivered live) or dropped
            # by the min_seq filter (already replayed).
            replay_max = replay[-1].seq if replay else after_seq
            listener = asyncio.create_task(run_listener(str(community_id), replay_max))
            await websocket.send_json(
                {"type": "subscribed", "community_id": str(community_id), "latest_seq": latest}
            )
            for event in replay:
                await websocket.send_json({"type": "event", **event_envelope_from_row(event)})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.warning("websocket closed unexpectedly")
    finally:
        await stop_listener()
