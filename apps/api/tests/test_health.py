"""Health and readiness endpoint behavior."""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from openvoice_api.main import create_app
from tests.conftest import make_settings, requires_db


async def test_healthz_ok(client: AsyncClient) -> None:
    resp = await client.get("/api/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_healthz_has_request_id_header(client: AsyncClient) -> None:
    resp = await client.get("/api/healthz")
    assert resp.headers.get("x-request-id")


@requires_db
async def test_readyz_ok_with_real_dependencies(client: AsyncClient) -> None:
    resp = await client.get("/api/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["checks"] == {"postgres": "ok", "redis": "ok"}


@requires_db
async def test_readyz_degraded_when_redis_unavailable() -> None:
    app = create_app(make_settings(redis_url="redis://localhost:1/0"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get("/api/readyz")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["checks"]["redis"] == "unavailable"
    assert body["checks"]["postgres"] == "ok"
