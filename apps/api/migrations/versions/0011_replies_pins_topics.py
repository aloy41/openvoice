"""message replies + pins and channel topics

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("channels", sa.Column("topic", sa.String(1024), nullable=True))
    op.add_column(
        "messages",
        sa.Column("reply_to_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("messages", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "messages",
        sa.Column("pinned_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_messages_reply_to_id",
        "messages",
        "messages",
        ["reply_to_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_messages_pinned_by",
        "messages",
        "users",
        ["pinned_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_messages_reply_to_id", "messages", ["reply_to_id"])
    # Fast "pinned messages in this channel" lookups.
    op.create_index(
        "ix_messages_channel_pinned",
        "messages",
        ["channel_id"],
        postgresql_where=sa.text("pinned_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_messages_channel_pinned", table_name="messages")
    op.drop_index("ix_messages_reply_to_id", table_name="messages")
    op.drop_constraint("fk_messages_pinned_by", "messages", type_="foreignkey")
    op.drop_constraint("fk_messages_reply_to_id", "messages", type_="foreignkey")
    op.drop_column("messages", "pinned_by")
    op.drop_column("messages", "pinned_at")
    op.drop_column("messages", "reply_to_id")
    op.drop_column("channels", "topic")
