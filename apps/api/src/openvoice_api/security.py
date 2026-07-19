"""Authentication primitives.

- Dev-session tokens: HMAC-signed, time-limited (ADR-0003 dev-only flow).
- Production passwords: Argon2id via argon2-cffi (maintained library — never
  hand-rolled). Parameters are the library defaults; they must be reviewed
  for the deployment class before the public MVP (tracked in SECURITY.md).
- Cookie sessions: opaque random secrets; only a SHA-256 digest is stored
  server-side, so a database disclosure cannot mint valid sessions.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from itsdangerous import URLSafeTimedSerializer

from .config import Settings

_SALT = "openvoice-dev-session-v1"

_password_hasher = PasswordHasher()

# Verified against when the username doesn't exist so response timing does not
# reveal account existence. Structurally valid hash of an unguessable value.
_DUMMY_HASH = _password_hasher.hash(secrets.token_hex(32))


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    target = password_hash if password_hash is not None else _DUMMY_HASH
    try:
        return _password_hasher.verify(target, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError):
        return False


def new_session_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_session_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)


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
