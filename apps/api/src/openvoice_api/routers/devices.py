"""Per-device identity (ADR-0007). The server stores only public keys and
never receives private key material. Revocation is soft and permanent for a
given key — a revoked key cannot be re-registered (a returning revoked key is
suspicious; the client must generate a fresh one)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import authenticate, authenticate_unsafe
from ..models import Device

router = APIRouter(tags=["devices"])


class DeviceRegister(BaseModel):
    public_key: str = Field(min_length=1, max_length=512)
    key_type: str = Field(default="ecdsa-p256", pattern="^[a-z0-9-]+$", max_length=32)
    name: str | None = Field(default=None, max_length=100)


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


@router.post("/devices", response_model=DeviceRegistered)
async def register_device(body: DeviceRegister, request: Request) -> DeviceRegistered:
    ctx = await authenticate_unsafe(request)
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
        device.revoked_at = datetime.now(tz=UTC)
        await db.commit()
    return {"status": "revoked"}
