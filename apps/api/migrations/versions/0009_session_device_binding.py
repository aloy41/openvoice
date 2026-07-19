"""bind sessions to proven devices (ADR-0008)

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_sessions_device_id",
        "sessions",
        "devices",
        ["device_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_sessions_device_id", "sessions", ["device_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_device_id", table_name="sessions")
    op.drop_constraint("fk_sessions_device_id", "sessions", type_="foreignkey")
    op.drop_column("sessions", "device_id")
