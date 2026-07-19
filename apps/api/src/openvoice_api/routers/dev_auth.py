"""Development-only authentication (ADR-0003).

Enabled solely by OPENVOICE_DEV_AUTH_ENABLED, which Settings validation
refuses in production mode. Known dev-only limitation: no rate limiting —
this endpoint must never be exposed publicly.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..models import User
from ..security import issue_dev_session_token

router = APIRouter(tags=["dev"])


class DevSessionRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str


class DevSessionResponse(BaseModel):
    token: str
    expires_in: int
    user: UserOut


@router.post("/dev/session", response_model=DevSessionResponse)
async def create_dev_session(body: DevSessionRequest, request: Request) -> DevSessionResponse:
    settings = request.app.state.settings
    if not settings.dev_auth_enabled:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "dev_auth_disabled",
                "message": "Development authentication is disabled on this server.",
            },
        )

    expected = settings.dev_auth_password.get_secret_value()
    if not secrets.compare_digest(body.password.encode(), expected.encode()):
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_credentials", "message": "Invalid development password."},
        )

    username = body.username.lower()
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as session:
        user = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        if user is None:
            user = User(
                username=username,
                display_name=body.username,
                is_dev_user=True,
                last_login_at=now,
            )
            session.add(user)
        else:
            user.last_login_at = now
        await session.commit()
        token = issue_dev_session_token(settings, user.id)
        return DevSessionResponse(
            token=token,
            expires_in=settings.dev_session_max_age_seconds,
            user=UserOut(id=user.id, username=user.username, display_name=user.display_name),
        )
