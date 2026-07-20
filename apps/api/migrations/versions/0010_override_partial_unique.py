"""fix permission-override uniqueness with NULL targets

The old UNIQUE(channel_id, role_id, membership_id) is ineffective: exactly one
of role_id/membership_id is always NULL (CHECK constraint), and Postgres treats
NULLs as distinct, so duplicate overrides for the same (channel, role) or
(channel, member) could be inserted under a race. Replace it with two partial
unique indexes that actually enforce one override per target.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-20
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_OLD_UNIQUE = "permission_overrides_channel_id_role_id_membership_id_key"


def upgrade() -> None:
    op.drop_constraint(_OLD_UNIQUE, "permission_overrides", type_="unique")
    op.create_index(
        "uq_override_channel_role",
        "permission_overrides",
        ["channel_id", "role_id"],
        unique=True,
        postgresql_where=text("membership_id IS NULL"),
    )
    op.create_index(
        "uq_override_channel_member",
        "permission_overrides",
        ["channel_id", "membership_id"],
        unique=True,
        postgresql_where=text("role_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_override_channel_member", table_name="permission_overrides")
    op.drop_index("uq_override_channel_role", table_name="permission_overrides")
    op.create_unique_constraint(
        _OLD_UNIQUE,
        "permission_overrides",
        ["channel_id", "role_id", "membership_id"],
    )
