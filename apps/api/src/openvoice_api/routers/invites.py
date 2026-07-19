"""Invites (ADR-0005): hashed codes, expiry, use limits, ban-aware redeem.

The plaintext code is returned exactly once at creation; only its SHA-256 is
stored. Redemption takes the code in the request BODY — invite secrets never
appear in URLs or logs.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..authz import load_access, record_audit
from ..deps import authenticate_unsafe
from ..events import append_event, publish_event
from ..models import Ban, Community, Invite, Membership
from ..permissions import Capability
from ..rate_limit import check_rate_limit

router = APIRouter(tags=["invites"])

INVITE_CODE_BYTES = 9  # 12 urlsafe chars — shareable, 72 bits of entropy


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


class InviteCreate(BaseModel):
    # Operator-protective bounds; no artificial product limits.
    expires_in_hours: int | None = Field(default=24 * 7, ge=1, le=24 * 365)
    max_uses: int | None = Field(default=None, ge=1, le=10_000)


class InviteCreated(BaseModel):
    code: str
    community_id: uuid.UUID
    expires_at: datetime | None
    max_uses: int | None


class InviteRedeem(BaseModel):
    code: str = Field(min_length=6, max_length=64)


class InviteRedeemed(BaseModel):
    community_id: uuid.UUID
    community_name: str


def _invalid_invite() -> HTTPException:
    # One error for unknown/expired/exhausted/revoked codes and for banned
    # users: a probing client learns nothing about which case it hit.
    return HTTPException(
        status_code=404,
        detail={"code": "invalid_invite", "message": "That invite is not valid."},
    )


@router.post("/communities/{community_id}/invites", response_model=InviteCreated)
async def create_invite(
    community_id: uuid.UUID, body: InviteCreate, request: Request
) -> InviteCreated:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.CREATE_INVITE)
        code = secrets.token_urlsafe(INVITE_CODE_BYTES)
        expires_at = (
            datetime.now(tz=UTC) + timedelta(hours=body.expires_in_hours)
            if body.expires_in_hours is not None
            else None
        )
        invite = Invite(
            community_id=community_id,
            code_hash=_hash_code(code),
            created_by=ctx.user.id,
            expires_at=expires_at,
            max_uses=body.max_uses,
        )
        db.add(invite)
        await db.flush()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="invite.created",
            target_type="invite",
            target_id=invite.id,
            meta={
                "max_uses": body.max_uses,
                "expires_at": expires_at.isoformat() if expires_at else None,
            },
        )
        await db.commit()
    return InviteCreated(
        code=code, community_id=community_id, expires_at=expires_at, max_uses=body.max_uses
    )


@router.post("/invites/redeem", response_model=InviteRedeemed)
async def redeem_invite(body: InviteRedeem, request: Request) -> InviteRedeemed:
    ctx = await authenticate_unsafe(request)
    settings = request.app.state.settings
    # Per-account limiting (the endpoint is authenticated): guessing invite
    # codes is throttled per user, not per shared NAT address.
    allowed = await check_rate_limit(
        request.app.state.redis,
        f"invite:{ctx.user.id}",
        settings.auth_rate_limit_attempts,
        settings.auth_rate_limit_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Too many attempts. Try again later."},
        )

    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        invite = (
            await db.execute(select(Invite).where(Invite.code_hash == _hash_code(body.code)))
        ).scalar_one_or_none()
        if (
            invite is None
            or invite.revoked_at is not None
            or (invite.expires_at is not None and invite.expires_at <= now)
            or (invite.max_uses is not None and invite.uses >= invite.max_uses)
        ):
            raise _invalid_invite()

        ban = (
            await db.execute(
                select(Ban).where(
                    Ban.community_id == invite.community_id,
                    Ban.user_id == ctx.user.id,
                )
            )
        ).scalar_one_or_none()
        if ban is not None and (ban.expires_at is None or ban.expires_at > now):
            raise _invalid_invite()

        community = (
            await db.execute(select(Community).where(Community.id == invite.community_id))
        ).scalar_one()
        existing = (
            await db.execute(
                select(Membership).where(
                    Membership.community_id == invite.community_id,
                    Membership.user_id == ctx.user.id,
                )
            )
        ).scalar_one_or_none()
        envelope = None
        if existing is None:
            invite.uses += 1
            db.add(Membership(community_id=invite.community_id, user_id=ctx.user.id))
            record_audit(
                db,
                community_id=invite.community_id,
                actor=ctx.user,
                action="membership.joined",
                target_type="user",
                target_id=ctx.user.id,
                meta={"invite_id": str(invite.id)},
            )
            envelope = await append_event(
                db,
                invite.community_id,
                "membership.joined",
                {"user_id": str(ctx.user.id), "display_name": ctx.user.display_name},
            )
            await db.commit()
    if envelope is not None:
        await publish_event(request.app.state.redis, envelope)
    return InviteRedeemed(community_id=community.id, community_name=community.name)
