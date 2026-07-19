"""Voice-token issuance for the development room.

Every request re-authenticates the caller (cookie session or dev bearer) and
mints a fresh short-lived, audio-only LiveKit token with server-derived
identity and room (ADR-0003). The request body is intentionally empty —
clients cannot request rooms, identities, or grants.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..deps import authenticate_unsafe
from ..livekit_tokens import mint_voice_token, resolve_ws_url

router = APIRouter(tags=["voice"])


class VoiceTokenResponse(BaseModel):
    token: str
    ws_url: str
    room: str
    identity: str
    expires_in: int


@router.post("/dev/voice-token", response_model=VoiceTokenResponse)
async def issue_voice_token(request: Request) -> VoiceTokenResponse:
    ctx = await authenticate_unsafe(request)
    settings = request.app.state.settings
    ws_url = resolve_ws_url(
        settings,
        request.headers.get("x-forwarded-proto") or request.url.scheme,
        request.headers.get("host"),
    )
    payload = mint_voice_token(settings, ctx.user, ws_url)
    return VoiceTokenResponse(**payload)  # type: ignore[arg-type]
