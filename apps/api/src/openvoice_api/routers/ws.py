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

from ..authz import load_access, viewable_channel_ids
from ..events import (
    AUTHZ_EVENT_PREFIXES,
    channel_for,
    event_envelope_from_row,
    event_visible,
)
from ..models import Event, User, UserSession
from ..presence import (
    PRESENCE_TTL_SECONDS,
    mark_offline,
    mark_online,
    publish_ephemeral,
)
from ..security import hash_session_secret

log = logging.getLogger("openvoice.ws")

router = APIRouter()

REPLAY_PAGE = 500
# How often an open socket re-checks that its session is still valid. Bounds
# how long a revoked session/device keeps receiving events (independent of
# presence TTL so revocation latency does not depend on presence config).
AUTH_RECHECK_SECONDS = 15


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

    # Pub/sub MUST use the timeout-free client: the general-purpose client's
    # socket_timeout would silently kill an idle listener after 2 seconds
    # (symptom: live updates stop until the client resubscribes).
    redis = websocket.app.state.redis_pubsub
    presence_redis = websocket.app.state.redis
    listener: asyncio.Task[None] | None = None
    heartbeat: asyncio.Task[None] | None = None
    watchdog: asyncio.Task[None] | None = None
    current_community: str | None = None

    async def run_auth_watchdog() -> None:
        """Re-validate the session periodically so revoking a session/device
        (which marks the sessions row revoked in Postgres) tears down an
        already-open socket instead of letting it keep receiving events until
        the client happens to reconnect."""
        while True:
            await asyncio.sleep(AUTH_RECHECK_SECONDS)
            if await _authenticate_ws(websocket) is None:
                with contextlib.suppress(Exception):
                    await websocket.send_json({"type": "unsubscribed", "code": "session_revoked"})
                with contextlib.suppress(Exception):
                    await websocket.close(code=4401)
                return

    async def stop_listener() -> None:
        nonlocal listener
        if listener is not None:
            listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await listener
            listener = None

    async def leave_presence() -> None:
        nonlocal heartbeat, current_community
        if heartbeat is not None:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
            heartbeat = None
        if current_community is not None:
            await mark_offline(presence_redis, current_community, str(user.id))
            await publish_ephemeral(
                presence_redis,
                current_community,
                {"type": "presence", "user_id": str(user.id), "online": False},
            )
            current_community = None

    async def run_heartbeat(community_id: str) -> None:
        while True:
            await mark_online(presence_redis, community_id, str(user.id))
            await asyncio.sleep(PRESENCE_TTL_SECONDS / 2)

    # The set of channel ids this user may VIEW, refreshed whenever a
    # permission-affecting event arrives. Channel-scoped events for channels
    # NOT in this set are never delivered (authorization: a member must not
    # receive content for channels they cannot see).
    viewable: set[str] = set()

    async def refresh_viewable(community_id: str) -> None:
        nonlocal viewable
        async with websocket.app.state.sessionmaker() as db:
            try:
                acc = await load_access(db, uuid.UUID(community_id), user)
            except Exception:
                viewable = set()
                return
            viewable = {str(c) for c in await viewable_channel_ids(db, acc)}

    def visible(envelope: dict[str, object]) -> bool:
        return event_visible(envelope, viewable)

    async def run_subscription(community_id: str, after_seq: int) -> None:
        pubsub = redis.pubsub()
        try:
            # Subscribe FIRST so live events are buffered by the pubsub client
            # while we replay the durable log — no gap, and live delivery does
            # not begin until replay is complete, so ordering is preserved.
            await pubsub.subscribe(channel_for(community_id))
            await refresh_viewable(community_id)

            # Replay the durable log fully (paginated) — closes the gap where a
            # client behind by more than one page would silently miss events.
            cursor = after_seq
            while True:
                async with websocket.app.state.sessionmaker() as db:
                    batch = (
                        (
                            await db.execute(
                                select(Event)
                                .where(Event.community_id == community_id, Event.seq > cursor)
                                .order_by(Event.seq)
                                .limit(REPLAY_PAGE)
                            )
                        )
                        .scalars()
                        .all()
                    )
                if not batch:
                    break
                for event in batch:
                    env = event_envelope_from_row(event)
                    if visible(env):
                        await websocket.send_json({"type": "event", "event": env})
                cursor = batch[-1].seq
                if len(batch) < REPLAY_PAGE:
                    break

            # Live: events buffered during replay + new ones, gated by seq so
            # nothing already replayed is re-sent.
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(item["data"])
                except (TypeError, ValueError):
                    continue
                if envelope.get("ephemeral"):
                    # Typing is channel-scoped → filter by visibility.
                    if envelope.get("type") == "typing":
                        ch = envelope.get("channel_id")
                        if ch and ch not in viewable:
                            continue
                    await websocket.send_json(
                        {k: v for k, v in envelope.items() if k != "ephemeral"}
                    )
                    continue
                etype = str(envelope.get("type", ""))
                # SECURITY: this user's membership ended → cut the stream now.
                if etype == "membership.removed" and (envelope.get("payload") or {}).get(
                    "user_id"
                ) == str(user.id):
                    await websocket.send_json(
                        {
                            "type": "unsubscribed",
                            "community_id": community_id,
                            "code": "membership_removed",
                        }
                    )
                    return
                # Any permission-affecting change → recompute what's visible so
                # channel-access removal takes effect immediately, mid-session.
                if etype.startswith(AUTHZ_EVENT_PREFIXES):
                    await refresh_viewable(community_id)
                if int(envelope.get("seq", 0)) <= cursor:
                    continue
                if not visible(envelope):
                    continue
                await websocket.send_json({"type": "event", "event": envelope})
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe()
                await pubsub.aclose()

    watchdog = asyncio.create_task(run_auth_watchdog())

    try:
        while True:
            raw = await websocket.receive_json()
            if not isinstance(raw, dict):
                continue
            cmd = raw.get("type")

            # Ephemeral typing signal → broadcast to the subscribed community.
            if cmd == "typing":
                if current_community and str(raw.get("community_id")) == current_community:
                    await publish_ephemeral(
                        presence_redis,
                        current_community,
                        {
                            "type": "typing",
                            "user_id": str(user.id),
                            "display_name": user.display_name,
                            "channel_id": str(raw.get("channel_id") or ""),
                        },
                    )
                continue

            if cmd != "subscribe":
                await websocket.send_json({"type": "error", "code": "unknown_command"})
                continue
            try:
                community_id = uuid.UUID(str(raw.get("community_id")))
                after_seq = max(0, int(raw.get("after_seq", 0)))
            except (TypeError, ValueError):
                await websocket.send_json({"type": "error", "code": "invalid_subscribe"})
                continue

            # Authorize the subscription (membership) before anything else.
            async with websocket.app.state.sessionmaker() as db:
                try:
                    access = await load_access(db, community_id, user)
                except Exception:
                    await websocket.send_json({"type": "error", "code": "not_found"})
                    continue
                latest = access.community.event_seq

            await stop_listener()
            await leave_presence()
            current_community = str(community_id)
            await mark_online(presence_redis, current_community, str(user.id))
            heartbeat = asyncio.create_task(run_heartbeat(current_community))
            await publish_ephemeral(
                presence_redis,
                current_community,
                {"type": "presence", "user_id": str(user.id), "online": True},
            )
            await websocket.send_json(
                {"type": "subscribed", "community_id": str(community_id), "latest_seq": latest}
            )
            listener = asyncio.create_task(run_subscription(str(community_id), after_seq))
    except WebSocketDisconnect:
        pass
    except Exception:
        log.warning("websocket closed unexpectedly")
    finally:
        if watchdog is not None:
            watchdog.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watchdog
        await stop_listener()
        await leave_presence()
