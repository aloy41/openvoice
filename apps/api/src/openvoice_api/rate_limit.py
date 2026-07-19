"""Fixed-window rate limiting on Redis.

Redis is ephemeral by design (the system must survive its loss), so the
limiter fails OPEN with a logged warning when Redis is unavailable — abuse
protection degrades rather than taking authentication down with it.
"""

from __future__ import annotations

import asyncio
import logging

import redis.asyncio as aioredis

log = logging.getLogger("openvoice.ratelimit")


async def check_rate_limit(
    redis: aioredis.Redis, key: str, limit: int, window_seconds: int
) -> bool:
    """Return True if the request is allowed."""
    try:
        async with asyncio.timeout(1):
            bucket = f"rl:{key}"
            count = await redis.incr(bucket)
            if count == 1:
                await redis.expire(bucket, window_seconds)
            return int(count) <= limit
    except Exception:
        log.warning(
            "rate limiter unavailable; failing open",
            extra={"extra_fields": {"limiter_key_prefix": key.split(":", 1)[0]}},
        )
        return True
