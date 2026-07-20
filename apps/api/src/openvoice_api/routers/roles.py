"""Roles, role assignment, and channel permission overrides (ADR-0005).

Slice scope recorded in the ADR: role create/edit/delete/assign requires
ADMINISTRATOR (or ownership); the finer MANAGE_ROLES hierarchy rules land
later. Channel overrides require MANAGE_CHANNELS, and non-administrators
cannot grant or deny capabilities they do not themselves hold.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..authz import CommunityAccess, load_access, not_found, record_audit
from ..deps import authenticate_unsafe
from ..events import append_event, publish_event
from ..models import Channel, MemberRole, Membership, PermissionOverride, Role
from ..permissions import ALL_CAPABILITIES, Capability, capability_names

router = APIRouter(tags=["roles"])


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    permissions: int = Field(default=0, ge=0, le=ALL_CAPABILITIES)


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    permissions: int | None = Field(default=None, ge=0, le=ALL_CAPABILITIES)


class RoleOut(BaseModel):
    id: uuid.UUID
    name: str
    position: int
    permissions: int
    capability_names: list[str]
    is_everyone: bool


class RoleListOut(BaseModel):
    roles: list[RoleOut]


class OverrideSet(BaseModel):
    role_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    allow: int = Field(default=0, ge=0, le=ALL_CAPABILITIES)
    deny: int = Field(default=0, ge=0, le=ALL_CAPABILITIES)


def _require_admin(access: CommunityAccess) -> None:
    if not (access.is_owner or access.has(Capability.ADMINISTRATOR)):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "missing_permission",
                "message": "Role management requires the ADMINISTRATOR permission.",
                "capability": "ADMINISTRATOR",
            },
        )


def _role_out(role: Role) -> RoleOut:
    return RoleOut(
        id=role.id,
        name=role.name,
        position=role.position,
        permissions=role.permissions,
        capability_names=capability_names(role.permissions),
        is_everyone=role.is_everyone,
    )


@router.get("/communities/{community_id}/roles", response_model=RoleListOut)
async def list_roles(community_id: uuid.UUID, request: Request) -> RoleListOut:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        await load_access(db, community_id, ctx.user)
        roles = (
            (
                await db.execute(
                    select(Role)
                    .where(Role.community_id == community_id)
                    .order_by(Role.position.desc(), Role.name)
                )
            )
            .scalars()
            .all()
        )
    return RoleListOut(roles=[_role_out(r) for r in roles])


@router.post("/communities/{community_id}/roles", response_model=RoleOut)
async def create_role(community_id: uuid.UUID, body: RoleCreate, request: Request) -> RoleOut:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        _require_admin(access)
        top = (
            await db.execute(
                select(Role.position)
                .where(Role.community_id == community_id)
                .order_by(Role.position.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        role = Role(
            community_id=community_id,
            name=body.name,
            permissions=body.permissions,
            position=(top or 0) + 1,
        )
        db.add(role)
        await db.flush()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="role.created",
            target_type="role",
            target_id=role.id,
            meta={"name": body.name, "permissions": body.permissions},
        )
        # Durable event so connected clients recompute permissions live.
        envelope = await append_event(db, community_id, "role.created", {"role_id": str(role.id)})
        await db.commit()
        out = _role_out(role)
    await publish_event(request.app.state.redis, envelope)
    return out


async def _load_role(request: Request, role_id: uuid.UUID) -> uuid.UUID:
    async with request.app.state.sessionmaker() as db:
        row = (await db.execute(select(Role.community_id).where(Role.id == role_id))).first()
    if row is None:
        raise not_found()
    community_id: uuid.UUID = row[0]
    return community_id


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(role_id: uuid.UUID, body: RolePatch, request: Request) -> RoleOut:
    ctx = await authenticate_unsafe(request)
    community_id = await _load_role(request, role_id)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        _require_admin(access)
        role = (await db.execute(select(Role).where(Role.id == role_id))).scalar_one()
        meta: dict[str, object] = {}
        if body.name is not None and not role.is_everyone:
            meta["name"] = {"from": role.name, "to": body.name}
            role.name = body.name
        if body.permissions is not None:
            meta["permissions"] = {"from": role.permissions, "to": body.permissions}
            role.permissions = body.permissions
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="role.updated",
            target_type="role",
            target_id=role.id,
            meta=meta or None,
        )
        envelope = await append_event(db, community_id, "role.updated", {"role_id": str(role.id)})
        await db.commit()
        out = _role_out(role)
    await publish_event(request.app.state.redis, envelope)
    return out


@router.delete("/roles/{role_id}")
async def delete_role(role_id: uuid.UUID, request: Request) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    community_id = await _load_role(request, role_id)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        _require_admin(access)
        role = (await db.execute(select(Role).where(Role.id == role_id))).scalar_one()
        if role.is_everyone:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "cannot_delete_everyone",
                    "message": "The @everyone role cannot be deleted.",
                },
            )
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="role.deleted",
            target_type="role",
            target_id=role.id,
            meta={"name": role.name},
        )
        envelope = await append_event(db, community_id, "role.deleted", {"role_id": str(role.id)})
        await db.delete(role)
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return {"status": "deleted"}


@router.put("/communities/{community_id}/members/{user_id}/roles/{role_id}")
async def assign_role(
    community_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, request: Request
) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        _require_admin(access)
        role = (
            await db.execute(
                select(Role).where(Role.id == role_id, Role.community_id == community_id)
            )
        ).scalar_one_or_none()
        membership = (
            await db.execute(
                select(Membership).where(
                    Membership.community_id == community_id, Membership.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        if role is None or membership is None or role.is_everyone:
            raise not_found()
        existing = (
            await db.execute(
                select(MemberRole).where(
                    MemberRole.membership_id == membership.id, MemberRole.role_id == role.id
                )
            )
        ).scalar_one_or_none()
        envelope = None
        if existing is None:
            db.add(MemberRole(membership_id=membership.id, role_id=role.id))
            record_audit(
                db,
                community_id=community_id,
                actor=ctx.user,
                action="role.assigned",
                target_type="user",
                target_id=user_id,
                meta={"role_id": str(role.id), "role_name": role.name},
            )
            envelope = await append_event(
                db,
                community_id,
                "role.assigned",
                {"role_id": str(role.id), "user_id": str(user_id)},
            )
            await db.commit()
    if envelope is not None:
        await publish_event(request.app.state.redis, envelope)
    return {"status": "assigned"}


@router.delete("/communities/{community_id}/members/{user_id}/roles/{role_id}")
async def unassign_role(
    community_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, request: Request
) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        _require_admin(access)
        membership = (
            await db.execute(
                select(Membership).where(
                    Membership.community_id == community_id, Membership.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            raise not_found()
        assignment = (
            await db.execute(
                select(MemberRole).where(
                    MemberRole.membership_id == membership.id, MemberRole.role_id == role_id
                )
            )
        ).scalar_one_or_none()
        if assignment is None:
            raise not_found()
        record_audit(
            db,
            community_id=community_id,
            actor=ctx.user,
            action="role.unassigned",
            target_type="user",
            target_id=user_id,
            meta={"role_id": str(role_id)},
        )
        envelope = await append_event(
            db,
            community_id,
            "role.unassigned",
            {"role_id": str(role_id), "user_id": str(user_id)},
        )
        await db.delete(assignment)
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return {"status": "unassigned"}


@router.put("/channels/{channel_id}/overrides")
async def set_override(
    channel_id: uuid.UUID, body: OverrideSet, request: Request
) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    if (body.role_id is None) == (body.user_id is None):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_override_target",
                "message": "Provide exactly one of role_id or user_id.",
            },
        )
    async with request.app.state.sessionmaker() as db:
        row = (
            await db.execute(select(Channel).where(Channel.id == channel_id))
        ).scalar_one_or_none()
        if row is None:
            raise not_found()
        access = await load_access(db, row.community_id, ctx.user)
        access.require(Capability.MANAGE_CHANNELS)
        touched = body.allow | body.deny
        if not (access.is_owner or access.has(Capability.ADMINISTRATOR)):
            if touched & ~access.base_permissions:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "cannot_grant_unheld",
                        "message": "You cannot set overrides for capabilities you do not hold.",
                    },
                )
        membership_id: uuid.UUID | None = None
        if body.user_id is not None:
            target_membership = (
                await db.execute(
                    select(Membership).where(
                        Membership.community_id == row.community_id,
                        Membership.user_id == body.user_id,
                    )
                )
            ).scalar_one_or_none()
            if target_membership is None:
                raise not_found()
            membership_id = target_membership.id
        if body.role_id is not None:
            role = (
                await db.execute(
                    select(Role).where(
                        Role.id == body.role_id, Role.community_id == row.community_id
                    )
                )
            ).scalar_one_or_none()
            if role is None:
                raise not_found()
        existing = (
            await db.execute(
                select(PermissionOverride).where(
                    PermissionOverride.channel_id == channel_id,
                    PermissionOverride.role_id == body.role_id,
                    PermissionOverride.membership_id == membership_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                PermissionOverride(
                    channel_id=channel_id,
                    role_id=body.role_id,
                    membership_id=membership_id,
                    allow=body.allow,
                    deny=body.deny,
                )
            )
        else:
            existing.allow = body.allow
            existing.deny = body.deny
        record_audit(
            db,
            community_id=row.community_id,
            actor=ctx.user,
            action="channel.override_set",
            target_type="channel",
            target_id=channel_id,
            meta={
                "role_id": str(body.role_id) if body.role_id else None,
                "user_id": str(body.user_id) if body.user_id else None,
                "allow": body.allow,
                "deny": body.deny,
            },
        )
        # Minimal payload: enough to trigger a live permission recompute for
        # the affected channel without broadcasting the allow/deny bits.
        envelope = await append_event(
            db, row.community_id, "channel.override_set", {"channel_id": str(channel_id)}
        )
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return {"status": "set"}
