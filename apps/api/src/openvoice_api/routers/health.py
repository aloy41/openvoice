"""Liveness and readiness endpoints.

/api/healthz — process is up (no dependency checks).
/api/readyz  — PostgreSQL and Redis are reachable; 503 names the failing
dependency so operators can diagnose without reading code.
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text

log = logging.getLogger("openvoice.health")

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    checks: dict[str, str] = {}
    ok = True

    try:
        async with asyncio.timeout(3):
            async with request.app.state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:
        log.warning("readiness check failed", extra={"extra_fields": {"dependency": "postgres"}})
        checks["postgres"] = "unavailable"
        ok = False

    try:
        async with asyncio.timeout(3):
            await request.app.state.redis.ping()
        checks["redis"] = "ok"
    except Exception:
        log.warning("readiness check failed", extra={"extra_fields": {"dependency": "redis"}})
        checks["redis"] = "unavailable"
        ok = False

    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "checks": checks},
    )


@router.get("/metrics")
async def metrics(request: Request) -> PlainTextResponse:
    """Prometheus text-format metrics for operational monitoring. No auth: it
    exposes only aggregate counters (no content, no identifiers), and should be
    reached over the private network / behind the reverse proxy, not published."""
    body = request.app.state.metrics.render(now=time.time())
    return PlainTextResponse(body, media_type="text/plain; version=0.0.4")
