"""Per-device identity with proof of possession (ADR-0008): registration
requires a real ECDSA-P256 signature over a server challenge, sessions bind to
a proven device, and revoking a device revokes its sessions. Also covers
idempotency, revoked-key rejection, listing, CSRF, and cross-user isolation.

The signing helpers here reproduce the browser's wire formats exactly (SPKI
public key, raw IEEE-P1363 signature — see apps/web/src/crypto/device.ts) so
the tests exercise the same verification path a real client hits."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import requires_db, uname, user_client

pytestmark = requires_db


def _new_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _public_key_b64(key: ec.EllipticCurvePrivateKey) -> str:
    spki = key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return base64.b64encode(spki).decode()


def _sign_nonce(key: ec.EllipticCurvePrivateKey, nonce_b64: str) -> str:
    """Sign the challenge nonce the way Web Crypto does: raw r||s, not DER."""
    message = base64.b64decode(nonce_b64)
    der = key.sign(message, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(raw).decode()


async def _challenge(c: AsyncClient) -> dict:
    resp = await c.post("/api/v1/devices/challenge")
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _register(
    c: AsyncClient, key: ec.EllipticCurvePrivateKey, name: str | None = None
) -> dict:
    """Full proof-of-possession registration; returns the device JSON."""
    ch = await _challenge(c)
    body = {
        "public_key": _public_key_b64(key),
        "challenge": ch["challenge"],
        "signature": _sign_nonce(key, ch["nonce"]),
    }
    if name:
        body["name"] = name
    resp = await c.post("/api/v1/devices", json=body)
    assert resp.status_code == 200, resp.text
    return dict(resp.json()["device"])


async def test_register_requires_valid_proof(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        key = _new_key()
        ch = await _challenge(c)
        # Wrong signature (signing a different, unrelated nonce) is rejected.
        wrong = base64.b64encode(b"x" * 64).decode()
        bad = await c.post(
            "/api/v1/devices",
            json={
                "public_key": _public_key_b64(key),
                "challenge": ch["challenge"],
                "signature": wrong,
            },
        )
        assert bad.status_code == 400
        assert bad.json()["code"] == "invalid_device_proof"

        # A signature by a DIFFERENT key than the registered public key fails.
        other = _new_key()
        mism = await c.post(
            "/api/v1/devices",
            json={
                "public_key": _public_key_b64(key),
                "challenge": ch["challenge"],
                "signature": _sign_nonce(other, ch["nonce"]),
            },
        )
        assert mism.status_code == 400

        # A forged challenge token (not server-signed) is rejected.
        forged = await c.post(
            "/api/v1/devices",
            json={
                "public_key": _public_key_b64(key),
                "challenge": "not-a-real-challenge-token",
                "signature": _sign_nonce(key, ch["nonce"]),
            },
        )
        assert forged.status_code == 400

        # The correct proof succeeds.
        device = await _register(c, key, name="Laptop")
        assert device["name"] == "Laptop"


async def test_register_is_idempotent_per_key(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        key = _new_key()
        first = await _register(c, key, name="Laptop")
        second = await _register(c, key, name="Laptop")
        assert first["id"] == second["id"]
        listing = await c.get("/api/v1/devices")
        assert len(listing.json()["devices"]) == 1


async def test_multiple_devices_and_revocation(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        key1, key2 = _new_key(), _new_key()
        d1 = await _register(c, key1)
        await _register(c, key2)
        assert len(((await c.get("/api/v1/devices")).json())["devices"]) == 2

        revoke = await c.delete(f"/api/v1/devices/{d1['id']}")
        assert revoke.status_code == 200
        remaining = (await c.get("/api/v1/devices")).json()["devices"]
        assert d1["id"] not in [d["id"] for d in remaining]

        # a revoked key cannot be re-registered
        ch = await _challenge(c)
        again = await c.post(
            "/api/v1/devices",
            json={
                "public_key": _public_key_b64(key1),
                "challenge": ch["challenge"],
                "signature": _sign_nonce(key1, ch["nonce"]),
            },
        )
        assert again.status_code == 403
        assert again.json()["code"] == "device_revoked"


async def test_bind_session_and_device_revocation_revokes_session(
    app: FastAPI, clean_db: None
) -> None:
    async with user_client(app, uname("dev")) as c:
        key = _new_key()
        device = await _register(c, key)

        # Bind the current session to the device with a fresh proof.
        ch = await _challenge(c)
        bound = await c.post(
            f"/api/v1/devices/{device['id']}/bind-session",
            json={"challenge": ch["challenge"], "signature": _sign_nonce(key, ch["nonce"])},
        )
        assert bound.status_code == 200, bound.text
        # The session still works after binding.
        assert (await c.get("/api/v1/devices")).status_code == 200

        # Revoking the bound device must terminate the session it was bound to.
        assert (await c.delete(f"/api/v1/devices/{device['id']}")).status_code == 200
        after = await c.get("/api/v1/devices")
        assert after.status_code == 401


async def test_bind_session_rejects_wrong_proof(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        key = _new_key()
        device = await _register(c, key)
        ch = await _challenge(c)
        # Sign with the wrong key → binding refused, session untouched.
        other = _new_key()
        resp = await c.post(
            f"/api/v1/devices/{device['id']}/bind-session",
            json={"challenge": ch["challenge"], "signature": _sign_nonce(other, ch["nonce"])},
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "invalid_device_proof"
        assert (await c.get("/api/v1/devices")).status_code == 200


async def test_revoke_requires_csrf(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("dev")) as c:
        device = await _register(c, _new_key())
        c.headers.pop("x-csrf-token", None)
        resp = await c.delete(f"/api/v1/devices/{device['id']}")
        assert resp.status_code == 403
        assert resp.json()["code"] == "csrf_failed"


async def test_cannot_touch_another_users_device(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("alice")) as alice,
        user_client(app, uname("bob")) as bob,
    ):
        device = await _register(alice, _new_key())
        # bob cannot see alice's device…
        assert (await bob.get("/api/v1/devices")).json()["devices"] == []
        # …nor revoke it
        assert (await bob.delete(f"/api/v1/devices/{device['id']}")).status_code == 404


async def test_challenge_requires_auth(app: FastAPI, clean_db: None) -> None:
    from httpx import ASGITransport
    from httpx import AsyncClient as RawClient

    async with RawClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        await anon.get("/api/healthz")
        csrf = anon.cookies.get("ov_csrf")
        resp = await anon.post("/api/v1/devices/challenge", headers={"x-csrf-token": csrf or ""})
        assert resp.status_code == 401
