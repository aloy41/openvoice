"""Authorized voice-channel tokens (ADR-0005): capability checks, override
effects, SPEAK→can_publish mapping, and immediate loss of access on kick."""

from __future__ import annotations

import jwt
from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import TEST_LIVEKIT_SECRET, requires_db, uname, user_client
from tests.test_communities import create_community, make_invite

pytestmark = requires_db

CONNECT_VOICE = 1 << 8
SPEAK = 1 << 9


def decode(token: str) -> dict:
    return dict(
        jwt.decode(token, TEST_LIVEKIT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
    )


async def voice_channel_of(client: AsyncClient, cid: str) -> str:
    detail = (await client.get(f"/api/v1/communities/{cid}")).json()
    return str(next(c for c in detail["channels"] if c["kind"] == "voice")["id"])


async def test_channel_token_scoped_to_channel_room(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await voice_channel_of(owner, cid)

        resp = await owner.post(f"/api/v1/channels/{channel_id}/voice-token")
        assert resp.status_code == 200
        body = resp.json()
        assert body["room"] == f"channel-{channel_id}"
        claims = decode(body["token"])
        assert claims["video"]["room"] == f"channel-{channel_id}"
        assert claims["video"]["canPublish"] is True
        assert not claims["video"].get("roomAdmin")


async def test_member_token_and_speak_override(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await voice_channel_of(member, cid)

        # default @everyone: connect + speak
        first = await member.post(f"/api/v1/channels/{channel_id}/voice-token")
        assert first.status_code == 200
        assert decode(first.json()["token"])["video"]["canPublish"] is True

        # deny SPEAK on this channel for @everyone → listen-only token
        roles = (await owner.get(f"/api/v1/communities/{cid}/roles")).json()["roles"]
        everyone = next(r for r in roles if r["is_everyone"])
        set_ov = await owner.put(
            f"/api/v1/channels/{channel_id}/overrides",
            json={"role_id": everyone["id"], "allow": 0, "deny": SPEAK},
        )
        assert set_ov.status_code == 200
        muted = await member.post(f"/api/v1/channels/{channel_id}/voice-token")
        assert muted.status_code == 200
        assert decode(muted.json()["token"])["video"]["canPublish"] is False

        # deny CONNECT_VOICE entirely → no token at all
        set_ov = await owner.put(
            f"/api/v1/channels/{channel_id}/overrides",
            json={"role_id": everyone["id"], "allow": 0, "deny": SPEAK | CONNECT_VOICE},
        )
        assert set_ov.status_code == 200
        refused = await member.post(f"/api/v1/channels/{channel_id}/voice-token")
        assert refused.status_code == 403
        assert refused.json()["capability"] == "CONNECT_VOICE"

        # …but a member-specific allow re-admits this member (precedence)
        member_id = (await member.get("/api/v1/auth/session")).json()["user"]["id"]
        set_ov = await owner.put(
            f"/api/v1/channels/{channel_id}/overrides",
            json={"user_id": member_id, "allow": CONNECT_VOICE, "deny": 0},
        )
        assert set_ov.status_code == 200
        readmitted = await member.post(f"/api/v1/channels/{channel_id}/voice-token")
        assert readmitted.status_code == 200

        # the owner is untouched by all of it
        owner_token = await owner.post(f"/api/v1/channels/{channel_id}/voice-token")
        assert owner_token.status_code == 200
        assert decode(owner_token.json()["token"])["video"]["canPublish"] is True


async def test_non_members_and_wrong_kinds_refused(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("stranger")) as stranger,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        voice_id = await voice_channel_of(owner, cid)
        text_id = next(c for c in detail["channels"] if c["kind"] == "text")["id"]

        assert (await stranger.post(f"/api/v1/channels/{voice_id}/voice-token")).status_code == 404
        wrong_kind = await owner.post(f"/api/v1/channels/{text_id}/voice-token")
        assert wrong_kind.status_code == 422
        assert wrong_kind.json()["code"] == "not_a_voice_channel"


async def test_kicked_member_loses_tokens_immediately(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await voice_channel_of(member, cid)
        assert (await member.post(f"/api/v1/channels/{channel_id}/voice-token")).status_code == 200

        member_id = (await member.get("/api/v1/auth/session")).json()["user"]["id"]
        assert (
            await owner.delete(f"/api/v1/communities/{cid}/members/{member_id}")
        ).status_code == 200

        assert (await member.post(f"/api/v1/channels/{channel_id}/voice-token")).status_code == 404
