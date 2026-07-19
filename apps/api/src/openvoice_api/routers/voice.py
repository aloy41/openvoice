"""Voice-token issuance for the development room.

Every request re-authenticates the caller (cookie session or dev bearer) and
mints a fresh short-lived, audio-only LiveKit token with server-derived
identity and room (ADR-0003). The request body is intentionally empty —
clients cannot request rooms, identities, or grants.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from ..authz import load_access, not_found, resolve_channel_capabilities
from ..deps import authenticate_unsafe
from ..livekit_tokens import mint_room_token, mint_voice_token, resolve_ws_url
from ..models import Channel
from ..permissions import Capability

router = APIRouter(tags=["voice"])


class VoiceTokenResponse(BaseModel):
    token: str
    ws_url: str
    room: str
    identity: str
    expires_in: int


def _request_ws_url(request: Request) -> str:
    return resolve_ws_url(
        request.app.state.settings,
        request.headers.get("x-forwarded-proto") or request.url.scheme,
        request.headers.get("host"),
    )


@router.post("/dev/voice-token", response_model=VoiceTokenResponse)
async def issue_voice_token(request: Request) -> VoiceTokenResponse:
    ctx = await authenticate_unsafe(request)
    payload = mint_voice_token(request.app.state.settings, ctx.user, _request_ws_url(request))
    return VoiceTokenResponse(**payload)  # type: ignore[arg-type]


@router.post("/channels/{channel_id}/voice-token", response_model=VoiceTokenResponse)
async def issue_channel_voice_token(channel_id: uuid.UUID, request: Request) -> VoiceTokenResponse:
    """Authorized voice-channel join (ADR-0005): requires membership and the
    CONNECT_VOICE capability on this specific channel; SPEAK controls whether
    the token can publish. Room name and identity are derived server-side."""
    ctx = await authenticate_unsafe(request)
    async with request.app.state.sessionmaker() as db:
        channel = (
            await db.execute(select(Channel).where(Channel.id == channel_id))
        ).scalar_one_or_none()
        if channel is None:
            raise not_found()
        access = await load_access(db, channel.community_id, ctx.user)
        if channel.kind != "voice":
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "not_a_voice_channel",
                    "message": "Only voice channels can be joined.",
                },
            )
        caps = await resolve_channel_capabilities(db, access, channel)
    if not caps & Capability.CONNECT_VOICE:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "missing_permission",
                "message": "You need the CONNECT_VOICE permission to join this channel.",
                "capability": "CONNECT_VOICE",
            },
        )
    payload = mint_room_token(
        request.app.state.settings,
        ctx.user,
        room=f"channel-{channel_id}",
        can_publish=bool(caps & Capability.SPEAK),
        ws_url=_request_ws_url(request),
    )
    return VoiceTokenResponse(**payload)  # type: ignore[arg-type]
