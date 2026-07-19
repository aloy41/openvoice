"""Development-session token signing (ADR-0003).

These are HMAC-signed, time-limited opaque tokens for the dev-only login flow.
Production authentication (Milestone 2) replaces this with HttpOnly cookie
sessions + CSRF protection and hashed rotating refresh tokens.
"""

from __future__ import annotations

import uuid

from itsdangerous import URLSafeTimedSerializer

from .config import Settings

_SALT = "openvoice-dev-session-v1"


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key.get_secret_value(), salt=_SALT)


def issue_dev_session_token(settings: Settings, user_id: uuid.UUID) -> str:
    return _serializer(settings).dumps({"uid": str(user_id)})


def verify_dev_session_token(settings: Settings, token: str) -> uuid.UUID:
    """Return the user id for a valid token.

    Raises itsdangerous.SignatureExpired / BadSignature on failure; callers
    map those to 401 responses without leaking details.
    """
    payload = _serializer(settings).loads(token, max_age=settings.dev_session_max_age_seconds)
    return uuid.UUID(payload["uid"])
