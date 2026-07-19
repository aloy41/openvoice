"""Text messages (Milestone 2). Content is transport-encrypted only for now —
the UI says so — and Milestone 3 replaces storage with ciphertext envelopes.

Rules: SEND_MESSAGES on the channel to post; authors edit their own messages;
delete requires authorship or MANAGE_MESSAGES; deletion tombstones. Every
change appends to the community event log in the same transaction.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..authz import load_access, not_found, resolve_channel_capabilities
from ..deps import authenticate, authenticate_unsafe
from ..events import append_event, event_envelope_from_row, publish_event
from ..models import Channel, Event, Message, User
from ..permissions import Capability
from ..rate_limit import check_rate_limit

router = APIRouter(tags=["messages"])

PAGE_SIZE = 50


# "plaintext": content is the message text (transport-encrypted only).
# "passphrase-v1": content is an opaque client-produced ciphertext envelope
# (base64 AES-GCM); the server stores and returns it verbatim and can never
# read it. New schemes append here; the server treats content as opaque.
MESSAGE_SCHEMES = ("plaintext", "passphrase-v1")
CONTENT_MAX = 8000


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=CONTENT_MAX)
    scheme: str = Field(default="plaintext", pattern="^(plaintext|passphrase-v1)$")


class MessagePatch(BaseModel):
    content: str = Field(min_length=1, max_length=CONTENT_MAX)
    scheme: str = Field(default="plaintext", pattern="^(plaintext|passphrase-v1)$")


class MessageOut(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    author_id: uuid.UUID
    author_name: str
    author_color: str | None
    scheme: str
    content: str
    created_at: datetime
    edited_at: datetime | None
    deleted: bool


class MessageListOut(BaseModel):
    messages: list[MessageOut]
    # Pass as ?before=<id> to fetch the previous page (UUIDv7 ids are
    # time-ordered). Null when there is no older history.
    next_cursor: uuid.UUID | None


class EventListOut(BaseModel):
    events: list[dict[str, Any]]
    latest_seq: int


def _message_out(message: Message, author_name: str, author_color: str | None) -> MessageOut:
    deleted = message.deleted_at is not None
    return MessageOut(
        id=message.id,
        channel_id=message.channel_id,
        author_id=message.author_id,
        author_name=author_name,
        author_color=author_color,
        scheme="plaintext" if deleted else message.scheme,
        content="" if deleted else message.content,
        created_at=message.created_at,
        edited_at=message.edited_at,
        deleted=deleted,
    )


async def _load_text_channel(db: AsyncSession, request: Request, channel_id: uuid.UUID) -> Channel:
    channel = (
        await db.execute(select(Channel).where(Channel.id == channel_id))
    ).scalar_one_or_none()
    if channel is None:
        raise not_found()
    if channel.kind != "text":
        raise HTTPException(
            status_code=422,
            detail={"code": "not_a_text_channel", "message": "Not a text channel."},
        )
    return channel


@router.get("/channels/{channel_id}/messages", response_model=MessageListOut)
async def list_messages(
    channel_id: uuid.UUID, request: Request, before: uuid.UUID | None = None
) -> MessageListOut:
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        channel = await _load_text_channel(db, request, channel_id)
        access = await load_access(db, channel.community_id, ctx.user)
        caps = await resolve_channel_capabilities(db, access, channel)
        if not caps & Capability.VIEW_CHANNELS:
            raise not_found()
        query = (
            select(Message, User.display_name, User.accent_color)
            .join(User, User.id == Message.author_id)
            .where(Message.channel_id == channel_id)
        )
        if before is not None:
            query = query.where(Message.id < before)
        rows = (await db.execute(query.order_by(Message.id.desc()).limit(PAGE_SIZE + 1))).all()
    has_more = len(rows) > PAGE_SIZE
    rows = rows[:PAGE_SIZE]
    messages = [_message_out(m, name, color) for m, name, color in reversed(rows)]
    return MessageListOut(
        messages=messages,
        next_cursor=rows[-1][0].id if has_more and rows else None,
    )


@router.post("/channels/{channel_id}/messages", response_model=MessageOut)
async def send_message(channel_id: uuid.UUID, body: MessageCreate, request: Request) -> MessageOut:
    ctx = await authenticate_unsafe(request)
    settings = request.app.state.settings
    allowed = await check_rate_limit(
        request.app.state.redis,
        f"msg:{ctx.user.id}",
        settings.message_rate_limit_per_minute,
        60,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "You are sending messages too fast."},
        )
    async with request.app.state.sessionmaker() as db:
        channel = await _load_text_channel(db, request, channel_id)
        access = await load_access(db, channel.community_id, ctx.user)
        caps = await resolve_channel_capabilities(db, access, channel)
        if not caps & Capability.SEND_MESSAGES:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "missing_permission",
                    "message": "You need the SEND_MESSAGES permission in this channel.",
                    "capability": "SEND_MESSAGES",
                },
            )
        message = Message(
            channel_id=channel_id,
            author_id=ctx.user.id,
            content=body.content,
            scheme=body.scheme,
        )
        db.add(message)
        await db.flush()
        out = _message_out(message, ctx.user.display_name, ctx.user.accent_color)
        envelope = await append_event(
            db,
            channel.community_id,
            "message.created",
            {"message": out.model_dump(mode="json")},
        )
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return out


async def _load_own_or_privileged(
    db: AsyncSession, request: Request, ctx_user: User, message_id: uuid.UUID, need_manage: bool
) -> tuple[Message, Channel, Any]:
    message = (
        await db.execute(select(Message).where(Message.id == message_id))
    ).scalar_one_or_none()
    if message is None or message.deleted_at is not None:
        raise not_found()
    channel = (
        await db.execute(select(Channel).where(Channel.id == message.channel_id))
    ).scalar_one()
    access = await load_access(db, channel.community_id, ctx_user)
    if message.author_id != ctx_user.id:
        if not need_manage:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "not_message_author",
                    "message": "You can only edit your own messages.",
                },
            )
        caps = await resolve_channel_capabilities(db, access, channel)
        if not caps & Capability.MANAGE_MESSAGES:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "missing_permission",
                    "message": "You need the MANAGE_MESSAGES permission to delete this message.",
                    "capability": "MANAGE_MESSAGES",
                },
            )
    return message, channel, access


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(message_id: uuid.UUID, body: MessagePatch, request: Request) -> MessageOut:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        message, channel, _ = await _load_own_or_privileged(
            db, request, ctx.user, message_id, need_manage=False
        )
        message.content = body.content
        message.scheme = body.scheme
        message.edited_at = datetime.now(tz=UTC)
        out = _message_out(message, ctx.user.display_name, ctx.user.accent_color)
        envelope = await append_event(
            db,
            channel.community_id,
            "message.updated",
            {"message": out.model_dump(mode="json")},
        )
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return out


@router.delete("/messages/{message_id}")
async def delete_message(message_id: uuid.UUID, request: Request) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        message, channel, _ = await _load_own_or_privileged(
            db, request, ctx.user, message_id, need_manage=True
        )
        message.deleted_at = datetime.now(tz=UTC)
        message.content = ""  # tombstone: the body is gone, not hidden
        envelope = await append_event(
            db,
            channel.community_id,
            "message.deleted",
            {"message_id": str(message.id), "channel_id": str(channel.id)},
        )
        await db.commit()
    await publish_event(request.app.state.redis, envelope)
    return {"status": "deleted"}


@router.get("/communities/{community_id}/events", response_model=EventListOut)
async def catch_up_events(
    community_id: uuid.UUID, request: Request, after_seq: int = 0
) -> EventListOut:
    """Replay the durable event log after `after_seq` — the reconnect path.
    Bounded to 500 events per call; clients page by advancing after_seq."""
    ctx = await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        access = await load_access(db, community_id, ctx.user)
        rows = (
            (
                await db.execute(
                    select(Event)
                    .where(Event.community_id == community_id, Event.seq > after_seq)
                    .order_by(Event.seq)
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        latest = access.community.event_seq
    return EventListOut(events=[event_envelope_from_row(e) for e in rows], latest_seq=latest)
