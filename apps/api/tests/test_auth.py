"""Production authentication: registration, login, cookie sessions, CSRF,
rate limiting, and session revocation. All against real PostgreSQL/Redis."""

from __future__ import annotations

import uuid as uuidlib

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from openvoice_api.main import create_app
from tests.conftest import make_settings, requires_db

pytestmark = requires_db

PASSWORD = "correct-horse-battery"


def csrf_headers(client: AsyncClient) -> dict[str, str]:
    token = client.cookies.get("ov_csrf")
    assert token, "csrf cookie should have been set by middleware"
    return {"x-csrf-token": token}


async def prime_csrf(client: AsyncClient) -> dict[str, str]:
    """Any request causes the middleware to set the CSRF cookie."""
    await client.get("/api/healthz")
    return csrf_headers(client)


async def register(client: AsyncClient, username: str = "alice") -> dict:
    headers = await prime_csrf(client)
    resp = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": PASSWORD},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def test_register_sets_secure_session_cookie(client: AsyncClient, clean_db: None) -> None:
    headers = await prime_csrf(client)
    resp = await client.post(
        "/api/v1/auth/register",
        json={"username": "Alice", "password": PASSWORD},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["username"] == "alice"
    set_cookie = ";".join(resp.headers.get_list("set-cookie"))
    assert "ov_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()
    # password material must never be echoed
    assert PASSWORD not in resp.text


async def test_register_requires_csrf_header(client: AsyncClient, clean_db: None) -> None:
    resp = await client.post(
        "/api/v1/auth/register", json={"username": "noheader", "password": PASSWORD}
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "csrf_failed"


async def test_password_is_stored_as_argon2id(client: AsyncClient, clean_db: None) -> None:
    import os

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    await register(client, "bob")
    engine = create_async_engine(os.environ["OPENVOICE_TEST_DATABASE_URL"])
    async with engine.connect() as conn:
        row = (
            await conn.execute(text("SELECT password_hash FROM users WHERE username='bob'"))
        ).first()
    await engine.dispose()
    assert row is not None and row[0].startswith("$argon2id$")


async def test_register_duplicate_username(client: AsyncClient, clean_db: None) -> None:
    await register(client, "carol")
    resp = await client.post(
        "/api/v1/auth/register",
        json={"username": "CAROL", "password": PASSWORD},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "username_taken"


async def test_register_rejects_short_password(client: AsyncClient, clean_db: None) -> None:
    headers = await prime_csrf(client)
    resp = await client.post(
        "/api/v1/auth/register",
        json={"username": "dave", "password": "short"},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_login_flow_and_session_endpoint(app: FastAPI, clean_db: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c1:
        await register(c1, "erin")
    async with AsyncClient(transport=transport, base_url="http://test") as c2:
        headers = await prime_csrf(c2)
        resp = await c2.post(
            "/api/v1/auth/login",
            json={"username": "erin", "password": PASSWORD},
            headers=headers,
        )
        assert resp.status_code == 200
        me = await c2.get("/api/v1/auth/session")
        assert me.status_code == 200
        assert me.json()["user"]["username"] == "erin"


async def test_login_wrong_password_and_unknown_user_look_identical(
    app: FastAPI, clean_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        await register(c, "frank")
    async with AsyncClient(transport=transport, base_url="http://test") as fresh:
        headers = await prime_csrf(fresh)
        wrong = await fresh.post(
            "/api/v1/auth/login",
            json={"username": "frank", "password": "wrong-password-1"},
            headers=headers,
        )
        unknown = await fresh.post(
            "/api/v1/auth/login",
            json={"username": "nobody", "password": "wrong-password-1"},
            headers=headers,
        )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["code"] == unknown.json()["code"] == "invalid_credentials"


async def test_dev_account_cannot_password_login(client: AsyncClient, clean_db: None) -> None:
    # dev login creates a passwordless account
    resp = await client.post(
        "/api/v1/dev/session", json={"username": "devuser", "password": "test-dev-password"}
    )
    assert resp.status_code == 200
    headers = await prime_csrf(client)
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "devuser", "password": "test-dev-password"},
        headers=headers,
    )
    assert login.status_code == 401


async def test_logout_requires_csrf_and_revokes(client: AsyncClient, clean_db: None) -> None:
    await register(client, "grace")
    no_csrf = await client.post("/api/v1/auth/logout")
    assert no_csrf.status_code == 403
    assert no_csrf.json()["code"] == "csrf_failed"

    ok = await client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    assert ok.status_code == 200
    me = await client.get("/api/v1/auth/session")
    assert me.status_code == 401


async def test_session_list_and_cross_device_revocation(app: FastAPI, clean_db: None) -> None:
    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as device_a,
        AsyncClient(transport=transport, base_url="http://test") as device_b,
    ):
        await register(device_a, "heidi")
        headers_b = await prime_csrf(device_b)
        resp = await device_b.post(
            "/api/v1/auth/login",
            json={"username": "heidi", "password": PASSWORD},
            headers=headers_b,
        )
        assert resp.status_code == 200

        listing = await device_a.get("/api/v1/auth/sessions")
        sessions = listing.json()["sessions"]
        assert len(sessions) == 2
        other = next(s for s in sessions if not s["current"])

        revoke = await device_a.delete(
            f"/api/v1/auth/sessions/{other['id']}", headers=csrf_headers(device_a)
        )
        assert revoke.status_code == 200

        # device B's session is dead immediately
        me_b = await device_b.get("/api/v1/auth/session")
        assert me_b.status_code == 401
        # device A still works
        me_a = await device_a.get("/api/v1/auth/session")
        assert me_a.status_code == 200


async def test_login_rate_limited(clean_db: None) -> None:
    app = create_app(make_settings(auth_rate_limit_attempts=3))
    # unique username per run: rate windows in Redis outlive a test session
    username = f"rate-{uuidlib.uuid4().hex[:10]}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        headers = await prime_csrf(c)
        statuses = []
        for _ in range(4):
            resp = await c.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "wrong-password-1"},
                headers=headers,
            )
            statuses.append(resp.status_code)
    assert statuses[:3] == [401, 401, 401]
    assert statuses[3] == 429


async def test_voice_token_works_with_cookie_and_enforces_csrf(
    client: AsyncClient, clean_db: None
) -> None:
    body = await register(client, "ivan")
    no_csrf = await client.post("/api/v1/dev/voice-token")
    assert no_csrf.status_code == 403

    ok = await client.post("/api/v1/dev/voice-token", headers=csrf_headers(client))
    assert ok.status_code == 200
    assert ok.json()["room"] == "dev-lobby"
    assert ok.json()["identity"] == f"user-{body['user']['id']}"
