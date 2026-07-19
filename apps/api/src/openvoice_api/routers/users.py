"""User profiles: view/edit your own, view others' public cards."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..authz import not_found
from ..deps import authenticate, authenticate_unsafe
from ..models import User

router = APIRouter(tags=["users"])

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class ProfileOut(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    accent_color: str | None
    pronouns: str | None
    bio: str | None


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    accent_color: str | None = Field(default=None, max_length=7)
    pronouns: str | None = Field(default=None, max_length=40)
    bio: str | None = Field(default=None, max_length=280)


def _out(u: User) -> ProfileOut:
    return ProfileOut(
        id=u.id,
        username=u.username,
        display_name=u.display_name,
        accent_color=u.accent_color,
        pronouns=u.pronouns,
        bio=u.bio,
    )


def _clean_color(value: str | None) -> str | None:
    import re

    if value is None or value == "":
        return None
    return value if re.match(HEX_COLOR, value) else None


@router.get("/users/me", response_model=ProfileOut)
async def get_me(request: Request) -> ProfileOut:
    ctx = await authenticate(request)
    return _out(ctx.user)


@router.patch("/users/me", response_model=ProfileOut)
async def update_me(body: ProfilePatch, request: Request) -> ProfileOut:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        user = (await db.execute(select(User).where(User.id == ctx.user.id))).scalar_one()
        fields = body.model_dump(exclude_unset=True)
        if fields.get("display_name"):
            user.display_name = fields["display_name"].strip()
        if "accent_color" in fields:
            user.accent_color = _clean_color(fields["accent_color"])
        if "pronouns" in fields:
            user.pronouns = (fields["pronouns"] or "").strip() or None
        if "bio" in fields:
            user.bio = (fields["bio"] or "").strip() or None
        await db.commit()
        await db.refresh(user)
        return _out(user)


@router.get("/users/{user_id}", response_model=ProfileOut)
async def get_user(user_id: uuid.UUID, request: Request) -> ProfileOut:
    await authenticate(request)
    async with request.app.state.sessionmaker() as db:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise not_found()
    return _out(user)
