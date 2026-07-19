"""Moderation: kick, ban, unban, member list, audit log (ADR-0005).

Constraints enforced here: the owner can never be kicked or banned; nobody
can kick or ban themselves. Ban reasons are staff-visible only.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..authz import load_access, not_found, record_audit
from ..deps import authenticate, authenticate_unsafe
from ..events import append_event, publish_event
from ..models import Ban, Membership, User
from ..permissions import Capability

router = APIRouter(tags=["moderation"])


class MemberOut(BaseModel):
    user_id: uuid.UUID
    username: str
    display_name: str
    accent_color: str | None
    pronouns: str | None
    joined_at: datetime
    is_owner: bool


class MemberListOut(BaseModel):
    members: list[MemberOut]


class BanCreate(BaseModel):
    user_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=512)
    expires_in_hours: int | None = Field(default=None, ge=1, le=24 * 365)


class BanOut(BaseModel):
    user_id: uuid.UUID
    username: str
    reason: str | None
    created_at: datetime
    expires_at: datetime | None


class BanListOut(BaseModel):
    bans: list[BanOut]


class AuditEntryOut(BaseModel):
    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    action: str
    target_type: str | None
    target_id: uuid.UUID | None
    meta: dict[str, object] | None
    created_at: datetime


class AuditListOut(BaseModel):
    events: list[AuditEntryOut]


def _protect_target(access_owner_id: uuid.UUID, actor_id: uuid.UUID, target_id: uuid.UUID) -> None:
    if target_id == access_owner_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "cannot_target_owner", "message": "The owner cannot be removed."},
        )
    if target_id == actor_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "cannot_target_self", "message": "You cannot do that to yourself."},
        )


@router.get("/communities/{community_id}/members", response_model=MemberListOut)
async def list_members(community_id: uuid.UUID, request: Request) -> MemberListOut:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        rows = (
            await db.execute(
                select(Membership, User)
                .join(User, User.id == Membership.user_id)
                .where(Membership.community_id == community_id)
                .order_by(Membership.created_at)
            )
        ).all()
    return MemberListOut(
        members=[
            MemberOut(
                user_id=user.id,
                username=user.username,
                display_name=user.display_name,
                accent_color=user.accent_color,
                pronouns=user.pronouns,
                joined_at=membership.created_at,
                is_owner=user.id == access.community.owner_id,
            )
            for membership, user in rows
        ]
    )


@router.delete("/communities/{community_id}/members/{user_id}")
async def kick_member(
    community_id: uuid.UUID, user_id: uuid.UUID, request: Request
) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.KICK_MEMBERS)
        _protect_target(access.community.owner_id, ctx.user.id, user_id)
        membership = (
            await db.execute(
                select(Membership).where(
                    Membership.community_id == community_id, Membership.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            raise not_found()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="membership.kicked",
            target_type="user",
            target_id=user_id,
        )
        await db.delete(membership)
        envelope = await append_event(
            db, community_id, "membership.removed", {"user_id": str(user_id), "kind": "kicked"}
        )
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return {"status": "kicked"}


@router.post("/communities/{community_id}/bans", response_model=BanOut)
async def ban_member(community_id: uuid.UUID, body: BanCreate, request: Request) -> BanOut:
    ctx = await authenticate_unsafe(request)
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.BAN_MEMBERS)
        _protect_target(access.community.owner_id, ctx.user.id, body.user_id)
        target = (
            await db.execute(select(User).where(User.id == body.user_id))
        ).scalar_one_or_none()
        if target is None:
            raise not_found()
        existing_ban = (
            await db.execute(
                select(Ban).where(Ban.community_id == community_id, Ban.user_id == body.user_id)
            )
        ).scalar_one_or_none()
        if existing_ban is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "already_banned", "message": "That user is already banned."},
            )
        expires_at = now + timedelta(hours=body.expires_in_hours) if body.expires_in_hours else None
        ban = Ban(
            community_id=community_id,
            user_id=body.user_id,
            actor_user_id=ctx.user.id,
            reason=body.reason,
            expires_at=expires_at,
        )
        db.add(ban)
        membership = (
            await db.execute(
                select(Membership).where(
                    Membership.community_id == community_id, Membership.user_id == body.user_id
                )
            )
        ).scalar_one_or_none()
        if membership is not None:
            await db.delete(membership)
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="membership.banned",
            target_type="user",
            target_id=body.user_id,
            meta={"expires_at": expires_at.isoformat() if expires_at else None},
        )
        envelope = await append_event(
            db,
            community_id,
            "membership.removed",
            {"user_id": str(body.user_id), "kind": "banned"},
        )
        await db.commit()
        await publish_event(request.app.state.redis, envelope)
        return BanOut(
            user_id=target.id,
            username=target.username,
            reason=ban.reason,
            created_at=ban.created_at,
            expires_at=ban.expires_at,
        )


@router.get("/communities/{community_id}/bans", response_model=BanListOut)
async def list_bans(community_id: uuid.UUID, request: Request) -> BanListOut:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.BAN_MEMBERS)
        rows = (
            await db.execute(
                select(Ban, User)
                .join(User, User.id == Ban.user_id)
                .where(Ban.community_id == community_id)
                .order_by(Ban.created_at.desc())
            )
        ).all()
    return BanListOut(
        bans=[
            BanOut(
                user_id=user.id,
                username=user.username,
                reason=ban.reason,
                created_at=ban.created_at,
                expires_at=ban.expires_at,
            )
            for ban, user in rows
        ]
    )


@router.delete("/communities/{community_id}/bans/{user_id}")
async def unban_member(
    community_id: uuid.UUID, user_id: uuid.UUID, request: Request
) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.BAN_MEMBERS)
        ban = (
            await db.execute(
                select(Ban).where(Ban.community_id == community_id, Ban.user_id == user_id)
            )
        ).scalar_one_or_none()
        if ban is None:
            raise not_found()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="membership.unbanned",
            target_type="user",
            target_id=user_id,
        )
        await db.delete(ban)
        envelope = await append_event(
            db, community_id, "membership.unbanned", {"user_id": str(user_id)}
        )
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return {"status": "unbanned"}


@router.get("/communities/{community_id}/audit", response_model=AuditListOut)
async def audit_log(community_id: uuid.UUID, request: Request) -> AuditListOut:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.VIEW_AUDIT_LOG)
        from ..models import AuditEvent

        rows = (
            (
                await db.execute(
                    select(AuditEvent)
                    .where(AuditEvent.community_id == community_id)
                    .order_by(AuditEvent.created_at.desc())
                    .limit(100)
                )
            )
            .scalars()
            .all()
        )
    return AuditListOut(
        events=[
            AuditEntryOut(
                id=e.id,
                actor_user_id=e.actor_user_id,
                action=e.action,
                target_type=e.target_type,
                target_id=e.target_id,
                meta=e.meta,
                created_at=e.created_at,
            )
            for e in rows
        ]
    )
