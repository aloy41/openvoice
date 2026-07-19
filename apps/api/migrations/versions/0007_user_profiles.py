"""user profile fields: accent color, pronouns, bio

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("accent_color", sa.String(7), nullable=True))
    op.add_column("users", sa.Column("pronouns", sa.String(40), nullable=True))
    op.add_column("users", sa.Column("bio", sa.String(280), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "bio")
    op.drop_column("users", "pronouns")
    op.drop_column("users", "accent_color")
