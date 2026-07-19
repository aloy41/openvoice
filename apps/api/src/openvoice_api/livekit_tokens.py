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


def mint_voice_token(settings: Settings, user: User) -> dict[str, str | int]:
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
        "ws_url": settings.livekit_ws_url,
        "room": room,
        "identity": identity,
        "expires_in": settings.voice_token_ttl_seconds,
    }
