"""Liveness and readiness endpoints.

/api/healthz — process is up (no dependency checks).
/api/readyz  — PostgreSQL and Redis are reachable; 503 names the failing
dependency so operators can diagnose without reading code.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
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
