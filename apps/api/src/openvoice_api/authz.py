"""Central authorization (ADR-0005). Deny by default.

Every community-scoped endpoint loads a CommunityAccess via this module and
checks capabilities through it — never role names, never client-provided
claims. Non-members receive 404 (community existence is not disclosed);
members lacking a capability receive 403 naming the missing capability.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    AuditEvent,
    Channel,
    Community,
    MemberRole,
    Membership,
    PermissionOverride,
    Role,
    User,
)
from .permissions import (
    ALL_CAPABILITIES,
    Capability,
    apply_channel_overrides,
    combine_base_permissions,
)


def not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "not_found", "message": "Not found."},
    )


def missing_capability(cap: Capability) -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "missing_permission",
            "message": f"You need the {cap.name} permission to do that.",
            "capability": cap.name,
        },
    )


@dataclass
class CommunityAccess:
    community: Community
    membership: Membership
    is_owner: bool
    role_ids: set[uuid.UUID] = field(default_factory=set)
    base_permissions: int = 0
    top_role_position: int = 0

    def has(self, cap: Capability) -> bool:
        return bool(self.base_permissions & int(cap))

    def require(self, cap: Capability) -> None:
        if not self.has(cap):
            raise missing_capability(cap)


async def load_access(db: AsyncSession, community_id: uuid.UUID, user: User) -> CommunityAccess:
    """Load the caller's access to a community. Raises 404 for unknown
    communities AND for communities the caller is not a member of."""
    community = (
        await db.execute(select(Community).where(Community.id == community_id))
    ).scalar_one_or_none()
    if community is None:
        raise not_found()
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.community_id == community_id, Membership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise not_found()

    is_owner = community.owner_id == user.id
    roles = (
        (
            await db.execute(
                select(Role)
                .join(
                    MemberRole,
                    (MemberRole.role_id == Role.id) & (MemberRole.membership_id == membership.id),
                    isouter=False,
                )
                .where(Role.community_id == community_id)
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
    role_list = list(roles)
    if everyone is not None and everyone.id not in {r.id for r in role_list}:
        role_list.append(everyone)

    return CommunityAccess(
        community=community,
        membership=membership,
        is_owner=is_owner,
        role_ids={r.id for r in role_list},
        base_permissions=combine_base_permissions(is_owner, [r.permissions for r in role_list]),
        top_role_position=max((r.position for r in role_list), default=0),
    )


async def load_channel(db: AsyncSession, access: CommunityAccess, channel_id: uuid.UUID) -> Channel:
    channel = (
        await db.execute(
            select(Channel).where(
                Channel.id == channel_id,
                Channel.community_id == access.community.id,
            )
        )
    ).scalar_one_or_none()
    if channel is None:
        raise not_found()
    return channel


async def resolve_channel_capabilities(
    db: AsyncSession, access: CommunityAccess, channel: Channel
) -> int:
    """ADR-0005 step 5 applied with this member's overrides for one channel."""
    if access.base_permissions == ALL_CAPABILITIES:
        return ALL_CAPABILITIES
    overrides = (
        (
            await db.execute(
                select(PermissionOverride).where(PermissionOverride.channel_id == channel.id)
            )
        )
        .scalars()
        .all()
    )
    everyone_role = (
        await db.execute(
            select(Role).where(Role.community_id == access.community.id, Role.is_everyone.is_(True))
        )
    ).scalar_one_or_none()
    everyone_override: tuple[int, int] | None = None
    role_overrides: list[tuple[int, int]] = []
    member_override: tuple[int, int] | None = None
    for ov in overrides:
        if ov.membership_id is not None:
            if ov.membership_id == access.membership.id:
                member_override = (ov.allow, ov.deny)
        elif everyone_role is not None and ov.role_id == everyone_role.id:
            everyone_override = (ov.allow, ov.deny)
        elif ov.role_id in access.role_ids:
            role_overrides.append((ov.allow, ov.deny))
    return apply_channel_overrides(
        access.base_permissions, everyone_override, role_overrides, member_override
    )


async def viewable_channel_ids(db: AsyncSession, access: CommunityAccess) -> set[uuid.UUID]:
    """The set of channel ids the member may VIEW. Used to filter realtime
    events so a subscriber never receives content for channels they cannot
    see (owners/administrators see everything)."""
    channels = (
        (await db.execute(select(Channel).where(Channel.community_id == access.community.id)))
        .scalars()
        .all()
    )
    result: set[uuid.UUID] = set()
    for channel in channels:
        if channel.kind == "category":
            continue
        caps = await resolve_channel_capabilities(db, access, channel)
        if caps & Capability.VIEW_CHANNELS:
            result.add(channel.id)
    return result


def record_audit(
    db: AsyncSession,
    *,
    community_id: uuid.UUID,
    actor: User,
    action: str,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    meta: dict[str, object] | None = None,
) -> None:
    """Queue an audit event on the current transaction. Metadata must be safe
    structured data only — no message content, no secrets."""
    db.add(
        AuditEvent(
            community_id=community_id,
            actor_user_id=actor.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            meta=meta,
        )
    )
