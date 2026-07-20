"""LiveKit token scoping (ADR-0003).

Issued tokens are decoded and their grants asserted exactly: audio-only join
to the server-chosen dev room, short TTL, no admin/create/data grants.
"""

from __future__ import annotations

import jwt
from httpx import AsyncClient

from tests.conftest import TEST_LIVEKIT_SECRET, login, requires_db

pytestmark = requires_db


async def test_voice_token_requires_authentication(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/dev/voice-token")
    assert resp.status_code == 401
    assert resp.json()["code"] == "not_authenticated"


async def test_voice_token_grants_are_tightly_scoped(client: AsyncClient, clean_db: None) -> None:
    token = await login(client, "carol")
    resp = await client.post(
        "/api/v1/dev/voice-token", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["room"] == "dev-lobby"
    assert body["ws_url"].startswith("ws")
    assert body["identity"].startswith("user-")
    assert body["expires_in"] <= 300

    claims = jwt.decode(
        body["token"],
        TEST_LIVEKIT_SECRET,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )
    assert claims["sub"] == body["identity"]
    video = claims["video"]
    assert video["roomJoin"] is True
    assert video["room"] == "dev-lobby"
    assert video["canPublish"] is True
    assert video["canSubscribe"] is True
    # Publishing is restricted to a microphone track — no camera/screen share.
    assert video.get("canPublishSources") == ["microphone"]
    # privileged grants must be absent or false
    assert not video.get("roomAdmin")
    assert not video.get("roomCreate")
    assert not video.get("roomList")
    assert not video.get("canPublishData")
    assert not video.get("recorder")
    assert not video.get("ingressAdmin")

    # short-lived: exp within TTL of issuance (allow small clock skew)
    issued_at = claims.get("nbf") or claims.get("iat")
    assert issued_at is not None, f"token has neither nbf nor iat: {sorted(claims)}"
    assert claims["exp"] - issued_at <= 310


async def test_voice_token_ignores_client_supplied_body(
    client: AsyncClient, clean_db: None
) -> None:
    token = await login(client, "mallory")
    resp = await client.post(
        "/api/v1/dev/voice-token",
        headers={"Authorization": f"Bearer {token}"},
        json={"room": "someone-elses-room", "identity": "admin", "roomAdmin": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["room"] == "dev-lobby"
    assert body["identity"] != "admin"

    claims = jwt.decode(
        body["token"],
        TEST_LIVEKIT_SECRET,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )
    assert claims["video"]["room"] == "dev-lobby"
    assert not claims["video"].get("roomAdmin")


async def test_ws_url_derives_from_request_origin(clean_db: None) -> None:
    from openvoice_api.main import create_app
    from tests.conftest import make_settings

    app = create_app(make_settings(livekit_ws_url="origin"))
    from httpx import ASGITransport

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await login(c, "originuser")
        plain = await c.post(
            "/api/v1/dev/voice-token", headers={"Authorization": f"Bearer {token}"}
        )
        assert plain.json()["ws_url"] == "ws://test"

        forwarded = await c.post(
            "/api/v1/dev/voice-token",
            headers={
                "Authorization": f"Bearer {token}",
                "x-forwarded-proto": "https",
                "host": "voice.example.com:8443",
            },
        )
        assert forwarded.json()["ws_url"] == "wss://voice.example.com:8443"


async def test_two_users_get_distinct_identities(client: AsyncClient, clean_db: None) -> None:
    token_a = await login(client, "alice")
    token_b = await login(client, "bob")
    resp_a = await client.post(
        "/api/v1/dev/voice-token", headers={"Authorization": f"Bearer {token_a}"}
    )
    resp_b = await client.post(
        "/api/v1/dev/voice-token", headers={"Authorization": f"Bearer {token_b}"}
    )
    assert resp_a.json()["identity"] != resp_b.json()["identity"]
