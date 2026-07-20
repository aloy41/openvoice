"""custom user status (emoji + text)

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("status_emoji", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("status_text", sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "status_text")
    op.drop_column("users", "status_emoji")
