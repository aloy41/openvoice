"""Per-device identity with proof of possession + session binding (ADR-0007,
ADR-0008). The server stores only public keys and never receives private key
material. Registering a device now REQUIRES a signature over a server-issued
challenge, so a public key cannot be registered by anyone who does not hold the
matching private key. A session can then be bound to a proven device; revoking
the device revokes every session bound to it.

Revocation is soft and permanent for a given key — a revoked key cannot be
re-registered (a returning revoked key is suspicious; the client must generate
a fresh one)."""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from ..deps import authenticate, authenticate_unsafe
from ..device_crypto import verify_device_signature
from ..models import Device, UserSession
from ..security import (
    issue_device_challenge,
    new_device_nonce,
    verify_device_challenge,
)

router = APIRouter(tags=["devices"])


class DeviceChallengeOut(BaseModel):
    # Opaque signed token the client echoes back with its signature.
    challenge: str
    # Base64 nonce the client must sign (with the device private key) after
    # base64-decoding it to raw bytes.
    nonce: str


class DeviceRegister(BaseModel):
    public_key: str = Field(min_length=1, max_length=512)
    key_type: str = Field(default="ecdsa-p256", pattern="^[a-z0-9-]+$", max_length=32)
    name: str | None = Field(default=None, max_length=100)
    # Proof of possession: the challenge token from POST /devices/challenge and
    # the base64 raw ECDSA-P256 signature over the challenge nonce.
    challenge: str = Field(min_length=1, max_length=1024)
    signature: str = Field(min_length=1, max_length=256)


class DeviceProof(BaseModel):
    challenge: str = Field(min_length=1, max_length=1024)
    signature: str = Field(min_length=1, max_length=256)


class DeviceOut(BaseModel):
    id: uuid.UUID
    name: str | None
    key_type: str
    created_at: datetime
    last_seen_at: datetime | None


class DeviceRegistered(BaseModel):
    device: DeviceOut


class DeviceListOut(BaseModel):
    devices: list[DeviceOut]


def _out(d: Device) -> DeviceOut:
    return DeviceOut(
        id=d.id,
        name=d.name,
        key_type=d.key_type,
        created_at=d.created_at,
        last_seen_at=d.last_seen_at,
    )


def _bad_proof() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "invalid_device_proof",
            "message": "The device challenge signature was missing, expired, or invalid.",
        },
    )


def _verify_proof(request: Request, public_key: str, challenge: str, signature: str) -> None:
    """Raise 400 unless `signature` is a valid signature over the challenge's
    nonce under `public_key`. The challenge is a signed, time-limited token so
    a replayed or forged challenge is rejected before any key check."""
    settings = request.app.state.settings
    try:
        nonce_b64 = verify_device_challenge(
            settings, challenge, settings.device_challenge_ttl_seconds
        )
    except (SignatureExpired, BadSignature, KeyError, ValueError) as exc:
        raise _bad_proof() from exc
    try:
        message = base64.b64decode(nonce_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise _bad_proof() from exc
    if not verify_device_signature(public_key, message, signature):
        raise _bad_proof()


@router.post("/devices/challenge", response_model=DeviceChallengeOut)
async def device_challenge(request: Request) -> DeviceChallengeOut:
    # Must be authenticated, but this only issues a random nonce — no state.
    await authenticate(request)
    nonce = new_device_nonce()
    return DeviceChallengeOut(
        challenge=issue_device_challenge(request.app.state.settings, nonce), nonce=nonce
    )


@router.post("/devices", response_model=DeviceRegistered)
async def register_device(body: DeviceRegister, request: Request) -> DeviceRegistered:
    ctx = await authenticate_unsafe(request)
    # Proof of possession BEFORE any database write.
    _verify_proof(request, body.public_key, body.challenge, body.signature)
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        existing = (
            await db.execute(
                select(Device).where(
                    Device.user_id == ctx.user.id, Device.public_key == body.public_key
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.revoked_at is not None:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "device_revoked",
                        "message": "This device key was revoked. Generate a new one.",
                    },
                )
            existing.last_seen_at = now
            if body.name:
                existing.name = body.name
            await db.commit()
            return DeviceRegistered(device=_out(existing))
        device = Device(
            user_id=ctx.user.id,
            public_key=body.public_key,
            key_type=body.key_type,
            name=body.name,
            last_seen_at=now,
        )
        db.add(device)
        await db.commit()
        await db.refresh(device)
        return DeviceRegistered(device=_out(device))


@router.post("/devices/{device_id}/bind-session")
async def bind_session(device_id: uuid.UUID, body: DeviceProof, request: Request) -> dict[str, str]:
    """Bind the CURRENT cookie session to a proven device. Requires a fresh
    proof of possession, so a stolen cookie alone cannot claim a device it
    cannot sign for. After binding, revoking the device revokes this session."""
    ctx = await authenticate_unsafe(request)
    if ctx.session_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "no_cookie_session",
                "message": "Session binding requires a cookie session.",
            },
        )
    async with request.app.state.sessionmaker() as db:
        device = (
            await db.execute(
                select(Device).where(
                    Device.id == device_id,
                    Device.user_id == ctx.user.id,
                    Device.revoked_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if device is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "device_not_found", "message": "No such active device."},
            )
        _verify_proof(request, device.public_key, body.challenge, body.signature)
        await db.execute(
            update(UserSession).where(UserSession.id == ctx.session_id).values(device_id=device.id)
        )
        await db.commit()
    return {"status": "bound"}


@router.get("/devices", response_model=DeviceListOut)
async def list_devices(request: Request) -> DeviceListOut:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        rows = (
            (
                await db.execute(
                    select(Device)
                    .where(Device.user_id == ctx.user.id, Device.revoked_at.is_(None))
                    .order_by(Device.created_at)
                )
            )
            .scalars()
            .all()
        )
    return DeviceListOut(devices=[_out(d) for d in rows])


@router.delete("/devices/{device_id}")
async def revoke_device(device_id: uuid.UUID, request: Request) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        device = (
            await db.execute(
                select(Device).where(Device.id == device_id, Device.user_id == ctx.user.id)
            )
        ).scalar_one_or_none()
        if device is None or device.revoked_at is not None:
            raise HTTPException(
                status_code=404,
                detail={"code": "device_not_found", "message": "No such active device."},
            )
        device.revoked_at = now
        # SECURITY: revoking a device revokes every session bound to it, so a
        # lost/compromised device cannot keep an authenticated session alive.
        await db.execute(
            update(UserSession)
            .where(UserSession.device_id == device.id, UserSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await db.commit()
    return {"status": "revoked"}
