"""Per-device identity: registration idempotency, revoked-key rejection,
listing, revocation, CSRF, and cross-user isolation."""

from __future__ import annotations

from fastapi import FastAPI

from tests.conftest import requires_db, uname, user_client

pytestmark = requires_db

PK1 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-device-one-public-key-b64"
PK2 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-device-two-public-key-b64"


async def test_register_is_idempotent_per_key(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        first = await c.post("/api/v1/devices", json={"public_key": PK1, "name": "Laptop"})
        assert first.status_code == 200, first.text
        second = await c.post("/api/v1/devices", json={"public_key": PK1, "name": "Laptop"})
        assert second.status_code == 200
        assert first.json()["device"]["id"] == second.json()["device"]["id"]

        listing = await c.get("/api/v1/devices")
        assert len(listing.json()["devices"]) == 1


async def test_multiple_devices_and_revocation(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        d1 = (await c.post("/api/v1/devices", json={"public_key": PK1})).json()["device"]
        await c.post("/api/v1/devices", json={"public_key": PK2})
        assert len(((await c.get("/api/v1/devices")).json())["devices"]) == 2

        revoke = await c.delete(f"/api/v1/devices/{d1['id']}")
        assert revoke.status_code == 200
        remaining = (await c.get("/api/v1/devices")).json()["devices"]
        assert [d["id"] for d in remaining] == [d["id"] for d in remaining if d["id"] != d1["id"]]
        assert d1["id"] not in [d["id"] for d in remaining]

        # a revoked key cannot be re-registered
        again = await c.post("/api/v1/devices", json={"public_key": PK1})
        assert again.status_code == 403
        assert again.json()["code"] == "device_revoked"


async def test_revoke_requires_csrf(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        d = (await c.post("/api/v1/devices", json={"public_key": PK1})).json()["device"]
        # drop the CSRF header the fixture attached
        c.headers.pop("x-csrf-token", None)
        resp = await c.delete(f"/api/v1/devices/{d['id']}")
        assert resp.status_code == 403
        assert resp.json()["code"] == "csrf_failed"


async def test_cannot_touch_another_users_device(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("alice")) as alice,
        user_client(app, uname("bob")) as bob,
    ):
        d = (await alice.post("/api/v1/devices", json={"public_key": PK1})).json()["device"]
        # bob cannot see alice's device…
        assert (await bob.get("/api/v1/devices")).json()["devices"] == []
        # …nor revoke it
        assert (await bob.delete(f"/api/v1/devices/{d['id']}")).status_code == 404


async def test_register_requires_auth(app: FastAPI, clean_db: None) -> None:
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        await anon.get("/api/healthz")
        csrf = anon.cookies.get("ov_csrf")
        resp = await anon.post(
            "/api/v1/devices",
            json={"public_key": PK1},
            headers={"x-csrf-token": csrf or ""},
        )
        assert resp.status_code == 401
