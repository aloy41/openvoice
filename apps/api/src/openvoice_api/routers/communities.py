"""Communities and channels (ADR-0005).

Authorization goes through authz.load_access / resolve_channel_capabilities
exclusively. Non-members always see 404.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..authz import load_access, not_found, record_audit
from ..deps import authenticate, authenticate_unsafe
from ..models import Channel, Community, Membership, PermissionOverride, Role
from ..permissions import (
    ALL_CAPABILITIES,
    DEFAULT_EVERYONE_PERMISSIONS,
    Capability,
    apply_channel_overrides,
    capability_names,
)

router = APIRouter(tags=["communities"])

CHANNEL_KINDS = ("category", "text", "voice")


class CommunityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class CommunityOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    created_at: datetime


class ChannelOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    position: int
    parent_id: uuid.UUID | None
    capabilities: list[str]


class CommunityDetail(BaseModel):
    community: CommunityOut
    channels: list[ChannelOut]
    my_capabilities: list[str]


class CommunityListOut(BaseModel):
    communities: list[CommunityOut]


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    kind: str = Field(pattern="^(category|text|voice)$")
    parent_id: uuid.UUID | None = None


class ChannelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    position: int | None = Field(default=None, ge=0, le=10_000)


def _community_out(c: Community) -> CommunityOut:
    return CommunityOut(id=c.id, name=c.name, owner_id=c.owner_id, created_at=c.created_at)


@router.post("/communities", response_model=CommunityDetail)
async def create_community(body: CommunityCreate, request: Request) -> CommunityDetail:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        community = Community(name=body.name, owner_id=ctx.user.id)
        db.add(community)
        await db.flush()
        db.add(Membership(community_id=community.id, user_id=ctx.user.id))
        db.add(
            Role(
                community_id=community.id,
                name="@everyone",
                position=0,
                permissions=DEFAULT_EVERYONE_PERMISSIONS,
                is_everyone=True,
            )
        )
        category = Channel(community_id=community.id, kind="category", name="General", position=0)
        db.add(category)
        await db.flush()
        db.add(
            Channel(
                community_id=community.id,
                kind="text",
                name="general",
                position=0,
                parent_id=category.id,
            )
        )
        db.add(
            Channel(
                community_id=community.id,
                kind="voice",
                name="General",
                position=1,
                parent_id=category.id,
            )
        )
        record_audit(
            db,
            community_id=community.id,
            actor=ctx.user,
            action="community.created",
            target_type="community",
            target_id=community.id,
            meta={"name": body.name},
        )
        await db.commit()
        return await _detail(request, community.id)


@router.get("/communities", response_model=CommunityListOut)
async def list_my_communities(request: Request) -> CommunityListOut:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        rows = (
            (
                await db.execute(
                    select(Community)
                    .join(Membership, Membership.community_id == Community.id)
                    .where(Membership.user_id == ctx.user.id)
                    .order_by(Community.created_at)
                )
            )
            .scalars()
            .all()
        )
    return CommunityListOut(communities=[_community_out(c) for c in rows])


async def _detail(request: Request, community_id: uuid.UUID) -> CommunityDetail:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        channels = (
            (
                await db.execute(
                    select(Channel)
                    .where(Channel.community_id == community_id)
                    .order_by(Channel.position, Channel.created_at)
                )
            )
            .scalars()
            .all()
        )
        everyone = (
            await db.execute(
                select(Role).where(Role.community_id == community_id, Role.is_everyone.is_(True))
            )
        ).scalar_one_or_none()
        overrides = (
            (
                await db.execute(
                    select(PermissionOverride).where(
                        PermissionOverride.channel_id.in_([c.id for c in channels])
                    )
                )
            )
            .scalars()
            .all()
        )
        out: list[ChannelOut] = []
        for channel in channels:
            if access.base_permissions == ALL_CAPABILITIES:
                caps = ALL_CAPABILITIES
            else:
                everyone_ov: tuple[int, int] | None = None
                role_ovs: list[tuple[int, int]] = []
                member_ov: tuple[int, int] | None = None
                for ov in overrides:
                    if ov.channel_id != channel.id:
                        continue
                    if ov.membership_id is not None:
                        if ov.membership_id == access.membership.id:
                            member_ov = (ov.allow, ov.deny)
                    elif everyone is not None and ov.role_id == everyone.id:
                        everyone_ov = (ov.allow, ov.deny)
                    elif ov.role_id in access.role_ids:
                        role_ovs.append((ov.allow, ov.deny))
                caps = apply_channel_overrides(
                    access.base_permissions, everyone_ov, role_ovs, member_ov
                )
            if not caps & Capability.VIEW_CHANNELS:
                continue  # hidden channels are simply absent
            out.append(
                ChannelOut(
                    id=channel.id,
                    kind=channel.kind,
                    name=channel.name,
                    position=channel.position,
                    parent_id=channel.parent_id,
                    capabilities=capability_names(caps),
                )
            )
        return CommunityDetail(
            community=_community_out(access.community),
            channels=out,
            my_capabilities=capability_names(access.base_permissions),
        )


@router.get("/communities/{community_id}", response_model=CommunityDetail)
async def community_detail(community_id: uuid.UUID, request: Request) -> CommunityDetail:
    return await _detail(request, community_id)


class PresenceOut(BaseModel):
    online: list[uuid.UUID]


@router.get("/communities/{community_id}/presence", response_model=PresenceOut)
async def community_presence(community_id: uuid.UUID, request: Request) -> PresenceOut:
    from ..presence import online_user_ids

    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        await load_access(db, community_id, ctx.user)
    ids = await online_user_ids(request.app.state.redis, str(community_id))
    parsed: list[uuid.UUID] = []
    for i in ids:
        try:
            parsed.append(uuid.UUID(i))
        except ValueError:
            continue
    return PresenceOut(online=parsed)


@router.delete("/communities/{community_id}")
async def delete_community(community_id: uuid.UUID, request: Request) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        if not access.is_owner:
            # Only the owner may delete a community — even administrators.
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "owner_only",
                    "message": "Only the community owner can delete a community.",
                },
            )
        await db.delete(access.community)
        await db.commit()
    return {"status": "deleted"}


@router.post("/communities/{community_id}/channels", response_model=ChannelOut)
async def create_channel(
    community_id: uuid.UUID, body: ChannelCreate, request: Request
) -> ChannelOut:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.MANAGE_CHANNELS)
        if body.parent_id is not None:
            parent = (
                await db.execute(
                    select(Channel).where(
                        Channel.id == body.parent_id,
                        Channel.community_id == community_id,
                        Channel.kind == "category",
                    )
                )
            ).scalar_one_or_none()
            if parent is None:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "invalid_parent",
                        "message": "parent_id must be a category channel in this community.",
                    },
                )
        channel = Channel(
            community_id=community_id,
            kind=body.kind,
            name=body.name,
            parent_id=body.parent_id,
        )
        db.add(channel)
        await db.flush()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="channel.created",
            target_type="channel",
            target_id=channel.id,
            meta={"name": body.name, "kind": body.kind},
        )
        await db.commit()
        return ChannelOut(
            id=channel.id,
            kind=channel.kind,
            name=channel.name,
            position=channel.position,
            parent_id=channel.parent_id,
            capabilities=capability_names(access.base_permissions),
        )


async def _load_channel_globally(request: Request, channel_id: uuid.UUID) -> tuple[uuid.UUID, str]:
    """Resolve a channel id to its community without leaking existence."""
    async with request.app.state.sessionmaker() as db:
        row = (
            await db.execute(select(Channel.community_id).where(Channel.id == channel_id))
        ).first()
    if row is None:
        raise not_found()
    return row[0], ""


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(channel_id: uuid.UUID, body: ChannelPatch, request: Request) -> ChannelOut:
    ctx = await authenticate_unsafe(request)
    community_id, _ = await _load_channel_globally(request, channel_id)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.MANAGE_CHANNELS)
        channel = (await db.execute(select(Channel).where(Channel.id == channel_id))).scalar_one()
        changes: dict[str, object] = {}
        if body.name is not None:
            changes["name"] = {"from": channel.name, "to": body.name}
            channel.name = body.name
        if body.position is not None:
            channel.position = body.position
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="channel.updated",
            target_type="channel",
            target_id=channel.id,
            meta=changes or None,
        )
        await db.commit()
        return ChannelOut(
            id=channel.id,
            kind=channel.kind,
            name=channel.name,
            position=channel.position,
            parent_id=channel.parent_id,
            capabilities=capability_names(access.base_permissions),
        )


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: uuid.UUID, request: Request) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    community_id, _ = await _load_channel_globally(request, channel_id)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        access.require(Capability.MANAGE_CHANNELS)
        channel = (await db.execute(select(Channel).where(Channel.id == channel_id))).scalar_one()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="channel.deleted",
            target_type="channel",
            target_id=channel.id,
            meta={"name": channel.name, "kind": channel.kind},
        )
        await db.delete(channel)
        await db.commit()
    return {"status": "deleted"}
