"""message encryption scheme marker + widened content for ciphertext

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("scheme", sa.String(24), nullable=False, server_default=sa.text("'plaintext'")),
    )
    op.alter_column(
        "messages",
        "content",
        existing_type=sa.String(4000),
        type_=sa.String(8000),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Truncate any oversized ciphertext to fit the narrower column.
    op.execute("UPDATE messages SET content = left(content, 4000)")
    op.alter_column(
        "messages",
        "content",
        existing_type=sa.String(8000),
        type_=sa.String(4000),
        existing_nullable=False,
    )
    op.drop_column("messages", "scheme")
