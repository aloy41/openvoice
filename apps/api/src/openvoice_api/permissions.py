"""Capability-based permissions (ADR-0005).

Explicit named capabilities stored as a bitfield. Deny by default: a
capability exists only if the resolution algorithm grants its bit. Never
compare role names anywhere — always resolve capabilities.

Bit assignments are append-only; never reuse a bit.
"""

from __future__ import annotations

from enum import IntFlag


class Capability(IntFlag):
    VIEW_CHANNELS = 1 << 0
    MANAGE_CHANNELS = 1 << 1
    MANAGE_ROLES = 1 << 2
    MANAGE_COMMUNITY = 1 << 3
    CREATE_INVITE = 1 << 4
    KICK_MEMBERS = 1 << 5
    BAN_MEMBERS = 1 << 6
    SEND_MESSAGES = 1 << 7
    CONNECT_VOICE = 1 << 8
    SPEAK = 1 << 9
    MUTE_MEMBERS = 1 << 10
    MANAGE_MESSAGES = 1 << 11
    VIEW_AUDIT_LOG = 1 << 12
    ADMINISTRATOR = 1 << 13


ALL_CAPABILITIES = 0
for _cap in Capability:
    ALL_CAPABILITIES |= int(_cap)

#: @everyone defaults for a new community: participate, but no management.
DEFAULT_EVERYONE_PERMISSIONS = int(
    Capability.VIEW_CHANNELS
    | Capability.SEND_MESSAGES
    | Capability.CONNECT_VOICE
    | Capability.SPEAK
    | Capability.CREATE_INVITE
)


def capability_names(bits: int) -> list[str]:
    return [cap.name for cap in Capability if cap.name and bits & int(cap)]


def combine_base_permissions(is_owner: bool, role_permission_sets: list[int]) -> int:
    """Steps 2-4 of the ADR-0005 algorithm: owner has everything; otherwise the
    union of all assigned roles (the @everyone role must be included by the
    caller); ADMINISTRATOR implies everything."""
    if is_owner:
        return ALL_CAPABILITIES
    base = 0
    for perms in role_permission_sets:
        base |= perms
    if base & Capability.ADMINISTRATOR:
        return ALL_CAPABILITIES
    return base


def apply_channel_overrides(
    base: int,
    everyone_override: tuple[int, int] | None,
    role_overrides: list[tuple[int, int]],
    member_override: tuple[int, int] | None,
) -> int:
    """Step 5: overrides in increasing specificity, deny before allow within
    each step. Tuples are (allow_bits, deny_bits). Owners/administrators must
    be short-circuited by the caller — overrides never apply to them."""
    perms = base
    if everyone_override is not None:
        allow, deny = everyone_override
        perms = (perms & ~deny) | allow
    if role_overrides:
        allow_union = 0
        deny_union = 0
        for allow, deny in role_overrides:
            allow_union |= allow
            deny_union |= deny
        perms = (perms & ~deny_union) | allow_union
    if member_override is not None:
        allow, deny = member_override
        perms = (perms & ~deny) | allow
    return perms


def resolve_channel_permissions(
    *,
    is_owner: bool,
    role_permission_sets: list[int],
    everyone_override: tuple[int, int] | None = None,
    role_overrides: list[tuple[int, int]] | None = None,
    member_override: tuple[int, int] | None = None,
) -> int:
    """Full ADR-0005 resolution for one member in one channel (pure)."""
    base = combine_base_permissions(is_owner, role_permission_sets)
    if base == ALL_CAPABILITIES:
        # Owner or administrator: overrides never restrict them.
        return base
    return apply_channel_overrides(base, everyone_override, role_overrides or [], member_override)
