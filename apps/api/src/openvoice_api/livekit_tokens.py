"""LiveKit token minting.

Security invariants (ADR-0003, tested in tests/test_voice_token.py):
- Identity and room are derived server-side; clients cannot influence grants.
- Grants are audio-only room join + subscribe. No admin, no room creation,
  no data publishing.
- Tokens are short-lived (TTL bounded to <= 600 s by Settings validation).
"""

from __future__ import annotations

from datetime import timedelta

from livekit import api

from .config import Settings
from .models import User


def resolve_ws_url(settings: Settings, forwarded_proto: str | None, host: str | None) -> str:
    """Resolve the LiveKit URL clients should connect to.

    With the "origin" setting, voice signaling shares the page's origin (the
    reverse proxy routes /rtc* to LiveKit), so one port and one certificate
    cover everything.
    """
    if settings.livekit_ws_url != "origin":
        return settings.livekit_ws_url
    scheme = "wss" if forwarded_proto == "https" else "ws"
    return f"{scheme}://{host or 'localhost'}"


def mint_room_token(
    settings: Settings,
    user: User,
    *,
    room: str,
    can_publish: bool,
    ws_url: str | None = None,
) -> dict[str, str | int]:
    """Mint a short-lived audio token for a server-derived room. can_publish
    reflects the SPEAK capability; listeners without it can only subscribe."""
    identity = f"user-{user.id}"
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret.get_secret_value())
        .with_identity(identity)
        .with_name(user.display_name)
        .with_ttl(timedelta(seconds=settings.voice_token_ttl_seconds))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=can_publish,
                can_subscribe=True,
                can_publish_data=False,
            )
        )
        .to_jwt()
    )
    return {
        "token": token,
        "ws_url": ws_url if ws_url is not None else settings.livekit_ws_url,
        "room": room,
        "identity": identity,
        "expires_in": settings.voice_token_ttl_seconds,
    }


def mint_voice_token(
    settings: Settings, user: User, ws_url: str | None = None
) -> dict[str, str | int]:
    """Dev-room token (Milestone 1 flow; replaced by channel tokens)."""
    return mint_room_token(
        settings, user, room=settings.dev_voice_room, can_publish=True, ws_url=ws_url
    )
