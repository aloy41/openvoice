"""Table-driven tests for the ADR-0005 permission resolution algorithm.

These are the contract for permission precedence. Any change in outcome here
is a breaking authorization change and requires an ADR update.
"""

from __future__ import annotations

import pytest

from openvoice_api.permissions import (
    ALL_CAPABILITIES,
    resolve_channel_permissions,
)
from openvoice_api.permissions import (
    Capability as C,
)

VIEW = int(C.VIEW_CHANNELS)
SEND = int(C.SEND_MESSAGES)
CONNECT = int(C.CONNECT_VOICE)
SPEAK = int(C.SPEAK)
ADMIN = int(C.ADMINISTRATOR)
KICK = int(C.KICK_MEMBERS)

CASES: list[tuple[str, dict[str, object], int, int]] = [
    # (description, kwargs, must_have_bits, must_not_have_bits)
    (
        "deny by default: no roles grant nothing",
        {"is_owner": False, "role_permission_sets": []},
        0,
        VIEW | SEND | CONNECT | KICK,
    ),
    (
        "base comes from the union of roles",
        {"is_owner": False, "role_permission_sets": [VIEW, SEND | CONNECT]},
        VIEW | SEND | CONNECT,
        KICK | SPEAK,
    ),
    (
        "owner has everything with no roles",
        {"is_owner": True, "role_permission_sets": []},
        ALL_CAPABILITIES,
        0,
    ),
    (
        "administrator bit implies everything",
        {"is_owner": False, "role_permission_sets": [ADMIN]},
        ALL_CAPABILITIES,
        0,
    ),
    (
        "everyone-override deny removes a base capability",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW | SEND],
            "everyone_override": (0, SEND),
        },
        VIEW,
        SEND,
    ),
    (
        "everyone-override allow adds a capability",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW],
            "everyone_override": (CONNECT, 0),
        },
        VIEW | CONNECT,
        SEND,
    ),
    (
        "role override allow beats everyone-override deny (more specific step wins)",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW | SEND],
            "everyone_override": (0, SEND),
            "role_overrides": [(SEND, 0)],
        },
        SEND,
        0,
    ),
    (
        "role override deny beats everyone-override allow",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW],
            "everyone_override": (CONNECT, 0),
            "role_overrides": [(0, CONNECT)],
        },
        VIEW,
        CONNECT,
    ),
    (
        "within the role step, an allow from any role wins over a deny from another",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW | CONNECT],
            "role_overrides": [(0, CONNECT), (CONNECT, 0)],
        },
        CONNECT,
        0,
    ),
    (
        "member override deny beats role-override allow",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW | SPEAK],
            "role_overrides": [(SPEAK, 0)],
            "member_override": (0, SPEAK),
        },
        VIEW,
        SPEAK,
    ),
    (
        "member override allow beats role-override deny",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW],
            "role_overrides": [(0, CONNECT)],
            "member_override": (CONNECT, 0),
        },
        VIEW | CONNECT,
        0,
    ),
    (
        "administrators ignore channel overrides entirely",
        {
            "is_owner": False,
            "role_permission_sets": [ADMIN],
            "everyone_override": (0, ALL_CAPABILITIES),
            "member_override": (0, ALL_CAPABILITIES),
        },
        ALL_CAPABILITIES,
        0,
    ),
    (
        "owners ignore channel overrides entirely",
        {
            "is_owner": True,
            "role_permission_sets": [],
            "member_override": (0, ALL_CAPABILITIES),
        },
        ALL_CAPABILITIES,
        0,
    ),
    (
        "deny of one capability leaves the others intact",
        {
            "is_owner": False,
            "role_permission_sets": [VIEW | SEND | CONNECT | SPEAK],
            "everyone_override": (0, SPEAK),
        },
        VIEW | SEND | CONNECT,
        SPEAK,
    ),
]


@pytest.mark.parametrize(
    ("description", "kwargs", "must_have", "must_not_have"),
    CASES,
    ids=[c[0] for c in CASES],
)
def test_permission_precedence(
    description: str, kwargs: dict[str, object], must_have: int, must_not_have: int
) -> None:
    result = resolve_channel_permissions(**kwargs)  # type: ignore[arg-type]
    assert result & must_have == must_have, f"missing bits in: {description}"
    assert result & must_not_have == 0, f"unexpected bits in: {description}"
