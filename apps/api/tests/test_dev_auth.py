"""Development-login behavior: gating, credential checks, user upsert."""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from openvoice_api.main import create_app
from tests.conftest import TEST_DEV_PASSWORD, login, make_settings, requires_db

pytestmark = requires_db


async def test_login_rejected_when_dev_auth_disabled() -> None:
    app = create_app(make_settings(dev_auth_enabled=False, dev_auth_password=None))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post(
            "/api/v1/dev/session", json={"username": "alice", "password": "whatever-pw"}
        )
    assert resp.status_code == 403
    assert resp.json()["code"] == "dev_auth_disabled"


async def test_login_wrong_password(client: AsyncClient, clean_db: None) -> None:
    resp = await client.post(
        "/api/v1/dev/session", json={"username": "alice", "password": "wrong-password"}
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "invalid_credentials"


async def test_login_success_returns_token_and_user(client: AsyncClient, clean_db: None) -> None:
    resp = await client.post(
        "/api/v1/dev/session", json={"username": "Alice", "password": TEST_DEV_PASSWORD}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token"]
    assert body["expires_in"] > 0
    assert body["user"]["username"] == "alice"  # normalized
    assert body["user"]["display_name"] == "Alice"


async def test_login_is_idempotent_per_username(client: AsyncClient, clean_db: None) -> None:
    first = await client.post(
        "/api/v1/dev/session", json={"username": "bob", "password": TEST_DEV_PASSWORD}
    )
    second = await client.post(
        "/api/v1/dev/session", json={"username": "BOB", "password": TEST_DEV_PASSWORD}
    )
    assert first.json()["user"]["id"] == second.json()["user"]["id"]


async def test_login_rejects_invalid_username(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/dev/session", json={"username": "no spaces!", "password": TEST_DEV_PASSWORD}
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


async def test_error_body_shape(client: AsyncClient, clean_db: None) -> None:
    resp = await client.post(
        "/api/v1/dev/session", json={"username": "alice", "password": "wrong-password"}
    )
    body = resp.json()
    assert set(body) >= {"code", "message", "request_id"}
    # never echo credentials back
    assert "wrong-password" not in resp.text


async def test_token_works_and_tampered_token_rejected(client: AsyncClient, clean_db: None) -> None:
    token = await login(client)
    ok = await client.post("/api/v1/dev/voice-token", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200

    tampered = token[:-2] + ("AA" if not token.endswith("AA") else "BB")
    bad = await client.post(
        "/api/v1/dev/voice-token", headers={"Authorization": f"Bearer {tampered}"}
    )
    assert bad.status_code == 401
    assert bad.json()["code"] == "session_invalid"
