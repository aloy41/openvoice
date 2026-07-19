"""Production authentication: register, login, logout, session management.

Design (master prompt "Authentication and session security"):
- Argon2id password hashes (argon2-cffi).
- HttpOnly, SameSite=Lax session cookies backed by hashed opaque secrets.
- Double-submit CSRF on every state-changing cookie-authenticated request.
- Rate limiting on sign-in/sign-up (Redis fixed window, operator-tunable).
- Login failures never distinguish unknown-user from wrong-password, and a
  dummy Argon2 verification keeps timing comparable.
- Per-device session viewing and revocation.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import Settings
from ..deps import AuthContext, authenticate, authenticate_unsafe, require_csrf
from ..models import User, UserSession
from ..rate_limit import check_rate_limit
from ..security import (
    hash_password,
    hash_session_secret,
    new_session_secret,
    verify_password,
)

log = logging.getLogger("openvoice.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

USERNAME_PATTERN = r"^[A-Za-z0-9_-]+$"


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=USERNAME_PATTERN)
    # Length-based policy (NIST-style): no composition rules, no maximum that
    # breaks passphrases.
    password: str = Field(min_length=10, max_length=128)
    display_name: str | None = Field(default=None, min_length=1, max_length=64)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=USERNAME_PATTERN)
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str


class SessionInfo(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime | None
    expires_at: datetime
    user_agent: str | None
    current: bool


class AuthStateResponse(BaseModel):
    user: UserOut
    session_expires_at: datetime | None


class SessionListResponse(BaseModel):
    sessions: list[SessionInfo]


def _client_key(request: Request, username: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"auth:{host}:{username.lower()}"


async def _enforce_auth_rate_limit(request: Request, username: str) -> None:
    settings: Settings = request.app.state.settings
    allowed = await check_rate_limit(
        request.app.state.redis,
        _client_key(request, username),
        settings.auth_rate_limit_attempts,
        settings.auth_rate_limit_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "rate_limited",
                "message": "Too many attempts. Try again in a few minutes.",
            },
        )


def _set_session_cookie(response: Response, settings: Settings, secret: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        secret,
        max_age=settings.session_max_age_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.effective_cookie_secure,
        path="/",
    )


def _clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")


async def _create_session(request: Request, response: Response, user: User) -> datetime:
    settings: Settings = request.app.state.settings
    secret = new_session_secret()
    now = datetime.now(tz=UTC)
    expires_at = now + timedelta(seconds=settings.session_max_age_seconds)
    user_agent = (request.headers.get("user-agent") or "")[:256] or None
    async with request.app.state.sessionmaker() as db:
        db.add(
            UserSession(
                user_id=user.id,
                token_hash=hash_session_secret(secret),
                expires_at=expires_at,
                last_seen_at=now,
                user_agent=user_agent,
            )
        )
        await db.commit()
    _set_session_cookie(response, settings, secret)
    return expires_at


@router.post("/register", response_model=AuthStateResponse)
async def register(
    body: RegisterRequest, request: Request, response: Response
) -> AuthStateResponse:
    # Login-CSRF protection: even anonymous auth endpoints require the
    # double-submit header (any prior response set the CSRF cookie).
    require_csrf(request)
    await _enforce_auth_rate_limit(request, body.username)
    username = body.username.lower()
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        existing = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "username_taken", "message": "That username is taken."},
            )
        user = User(
            username=username,
            display_name=body.display_name or body.username,
            is_dev_user=False,
            password_hash=hash_password(body.password),
            last_login_at=now,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    expires_at = await _create_session(request, response, user)
    log.info("account created", extra={"extra_fields": {"user_id": str(user.id)}})
    return AuthStateResponse(
        user=UserOut(id=user.id, username=user.username, display_name=user.display_name),
        session_expires_at=expires_at,
    )


@router.post("/login", response_model=AuthStateResponse)
async def login(body: LoginRequest, request: Request, response: Response) -> AuthStateResponse:
    require_csrf(request)
    await _enforce_auth_rate_limit(request, body.username)
    username = body.username.lower()
    async with request.app.state.sessionmaker() as db:
        user = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        # Dev accounts have no password and can never log in here.
        password_hash = user.password_hash if user is not None else None
        if not verify_password(password_hash, body.password):
            raise HTTPException(
                status_code=401,
                detail={"code": "invalid_credentials", "message": "Invalid username or password."},
            )
        assert user is not None  # verify_password is False for missing users
        user.last_login_at = datetime.now(tz=UTC)
        await db.commit()
        await db.refresh(user)
    expires_at = await _create_session(request, response, user)
    return AuthStateResponse(
        user=UserOut(id=user.id, username=user.username, display_name=user.display_name),
        session_expires_at=expires_at,
    )


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, str]:
    ctx: AuthContext = await authenticate_unsafe(request)
    if ctx.session_id is not None:
        async with request.app.state.sessionmaker() as db:
            session = (
                await db.execute(select(UserSession).where(UserSession.id == ctx.session_id))
            ).scalar_one_or_none()
            if session is not None:
                session.revoked_at = datetime.now(tz=UTC)
                await db.commit()
    _clear_session_cookie(response, request.app.state.settings)
    return {"status": "signed_out"}


@router.get("/session", response_model=AuthStateResponse)
async def current_session(request: Request) -> AuthStateResponse:
    ctx = await authenticate(request)
    expires_at: datetime | None = None
    if ctx.session_id is not None:
        async with request.app.state.sessionmaker() as db:
            session = (
                await db.execute(select(UserSession).where(UserSession.id == ctx.session_id))
            ).scalar_one_or_none()
            if session is not None:
                expires_at = session.expires_at
    return AuthStateResponse(
        user=UserOut(
            id=ctx.user.id, username=ctx.user.username, display_name=ctx.user.display_name
        ),
        session_expires_at=expires_at,
    )


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(request: Request) -> SessionListResponse:
    ctx = await authenticate(request)
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        result = await db.execute(
            select(UserSession)
            .where(
                UserSession.user_id == ctx.user.id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
            .order_by(UserSession.created_at.desc())
        )
        sessions = result.scalars().all()
    return SessionListResponse(
        sessions=[
            SessionInfo(
                id=s.id,
                created_at=s.created_at,
                last_seen_at=s.last_seen_at,
                expires_at=s.expires_at,
                user_agent=s.user_agent,
                current=s.id == ctx.session_id,
            )
            for s in sessions
        ]
    )


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: uuid.UUID, request: Request) -> dict[str, str]:
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        session = (
            await db.execute(
                select(UserSession).where(
                    UserSession.id == session_id, UserSession.user_id == ctx.user.id
                )
            )
        ).scalar_one_or_none()
        if session is None or session.revoked_at is not None:
            raise HTTPException(
                status_code=404,
                detail={"code": "session_not_found", "message": "No such active session."},
            )
        session.revoked_at = datetime.now(tz=UTC)
        await db.commit()
    return {"status": "revoked"}
