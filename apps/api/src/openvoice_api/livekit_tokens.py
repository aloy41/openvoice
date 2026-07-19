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


def mint_voice_token(
    settings: Settings, user: User, ws_url: str | None = None
) -> dict[str, str | int]:
    identity = f"user-{user.id}"
    room = settings.dev_voice_room
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret.get_secret_value())
        .with_identity(identity)
        .with_name(user.display_name)
        .with_ttl(timedelta(seconds=settings.voice_token_ttl_seconds))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
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
