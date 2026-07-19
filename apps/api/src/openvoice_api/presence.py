"""Presence + ephemeral signalling (typing) over Redis.

Presence is a per-community sorted set of user ids scored by an expiry
timestamp; members re-mark themselves on a heartbeat while their WebSocket is
open. Everything here is ephemeral by design — losing Redis just means
everyone briefly shows offline until the next heartbeat, never data loss.
Ephemeral signals (typing, presence changes) are published WITHOUT a
sequence number so they bypass the durable event log.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import redis.asyncio as aioredis

from .events import channel_for

log = logging.getLogger("openvoice.presence")

PRESENCE_TTL_SECONDS = 60


def _key(community_id: str) -> str:
    return f"presence:{community_id}"


async def mark_online(redis: aioredis.Redis, community_id: str, user_id: str) -> None:
    try:
        await redis.zadd(_key(community_id), {user_id: time.time() + PRESENCE_TTL_SECONDS})
    except Exception:
        log.warning("presence mark_online failed")


async def mark_offline(redis: aioredis.Redis, community_id: str, user_id: str) -> None:
    try:
        await redis.zrem(_key(community_id), user_id)
    except Exception:
        log.warning("presence mark_offline failed")


async def online_user_ids(redis: aioredis.Redis, community_id: str) -> list[str]:
    try:
        now = time.time()
        await redis.zremrangebyscore(_key(community_id), 0, now)
        members = await redis.zrange(_key(community_id), 0, -1)
        return [m.decode() if isinstance(m, bytes) else str(m) for m in members]
    except Exception:
        log.warning("presence read failed")
        return []


async def publish_ephemeral(
    redis: aioredis.Redis, community_id: str, payload: dict[str, Any]
) -> None:
    """Publish an ephemeral (no-seq) signal to a community channel."""
    try:
        await redis.publish(channel_for(community_id), json.dumps({"ephemeral": True, **payload}))
    except Exception:
        log.warning("ephemeral publish failed")
