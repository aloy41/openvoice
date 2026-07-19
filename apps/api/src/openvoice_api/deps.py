"""Request authentication shared across routers.

Two mechanisms during the transition period (dev auth is removed once the web
client fully migrates to cookie sessions):
- production: HttpOnly cookie session (hashed opaque secret in the sessions
  table), with double-submit CSRF enforcement on state-changing requests;
- development: signed bearer token (only when dev auth is enabled, which
  production configuration refuses at startup).
"""

from __future__ import annotations

import secrets as _secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired
from sqlalchemy import select

from .models import User, UserSession
from .security import hash_session_secret, verify_dev_session_token

AuthMethod = Literal["cookie", "dev_bearer"]


@dataclass(frozen=True)
class AuthContext:
    user: User
    method: AuthMethod
    session_id: uuid.UUID | None  # set for cookie auth


def _unauthenticated() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "not_authenticated", "message": "Authentication required."},
    )


def require_csrf(request: Request) -> None:
    """Double-submit CSRF check for cookie-authenticated unsafe requests."""
    settings = request.app.state.settings
    cookie = request.cookies.get(settings.csrf_cookie_name)
    header = request.headers.get(settings.csrf_header_name)
    if not cookie or not header or not _secrets.compare_digest(cookie, header):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "csrf_failed",
                "message": "Missing or invalid CSRF token.",
            },
        )


async def _cookie_auth(request: Request) -> AuthContext | None:
    settings = request.app.state.settings
    secret = request.cookies.get(settings.session_cookie_name)
    if not secret:
        return None
    token_hash = hash_session_secret(secret)
    now = datetime.now(tz=UTC)
    async with request.app.state.sessionmaker() as db:
        result = await db.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(UserSession.token_hash == token_hash)
        )
        row = result.first()
        if row is None:
            return None
        session, user = row
        if session.revoked_at is not None or session.expires_at <= now:
            return None
        session.last_seen_at = now
        await db.commit()
    return AuthContext(user=user, method="cookie", session_id=session.id)


async def _dev_bearer_auth(request: Request) -> AuthContext | None:
    settings = request.app.state.settings
    if not settings.dev_auth_enabled:
        return None
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    try:
        user_id = verify_dev_session_token(settings, token)
    except SignatureExpired as exc:
        raise HTTPException(
            status_code=401,
            detail={"code": "session_expired", "message": "Session expired; sign in again."},
        ) from exc
    except (BadSignature, ValueError, KeyError) as exc:
        raise HTTPException(
            status_code=401,
            detail={"code": "session_invalid", "message": "Invalid session token."},
        ) from exc
    async with request.app.state.sessionmaker() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "session_invalid", "message": "Invalid session token."},
        )
    return AuthContext(user=user, method="dev_bearer", session_id=None)


async def authenticate(request: Request) -> AuthContext:
    """Resolve the caller. Cookie sessions win over dev bearer tokens."""
    ctx = await _cookie_auth(request)
    if ctx is None:
        ctx = await _dev_bearer_auth(request)
    if ctx is None:
        raise _unauthenticated()
    return ctx


async def authenticate_unsafe(request: Request) -> AuthContext:
    """Authenticate a state-changing request. Cookie-authenticated callers
    must pass the CSRF check; bearer callers are exempt (no ambient cookie
    authority to abuse)."""
    ctx = await authenticate(request)
    if ctx.method == "cookie":
        require_csrf(request)
    return ctx
