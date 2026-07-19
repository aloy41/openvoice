"""Voice-token issuance for the development room.

Every request re-authenticates the caller and mints a fresh short-lived,
audio-only LiveKit token with server-derived identity and room (ADR-0003).
The request body is intentionally empty — clients cannot request rooms,
identities, or grants.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from itsdangerous import BadSignature, SignatureExpired
from pydantic import BaseModel
from sqlalchemy import select

from ..livekit_tokens import mint_voice_token
from ..models import User
from ..security import verify_dev_session_token

router = APIRouter(tags=["voice"])

_bearer = HTTPBearer(auto_error=False)


async def current_dev_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    settings = request.app.state.settings
    if not settings.dev_auth_enabled:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "dev_auth_disabled",
                "message": "Development authentication is disabled on this server.",
            },
        )
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "not_authenticated", "message": "Authentication required."},
        )
    try:
        user_id = verify_dev_session_token(settings, credentials.credentials)
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

    async with request.app.state.sessionmaker() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "session_invalid", "message": "Invalid session token."},
        )
    return user


class VoiceTokenResponse(BaseModel):
    token: str
    ws_url: str
    room: str
    identity: str
    expires_in: int


@router.post("/dev/voice-token", response_model=VoiceTokenResponse)
async def issue_voice_token(
    request: Request, user: Annotated[User, Depends(current_dev_user)]
) -> VoiceTokenResponse:
    payload = mint_voice_token(request.app.state.settings, user)
    return VoiceTokenResponse(**payload)  # type: ignore[arg-type]
