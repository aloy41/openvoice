"""Invite lifecycle: creation, redemption, expiry, use limits, bans."""

from __future__ import annotations

import os

from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import requires_db, uname, user_client
from tests.test_communities import create_community, make_invite

pytestmark = requires_db


async def test_invite_redeem_and_idempotency(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("joiner")) as joiner,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)

        first = await joiner.post("/api/v1/invites/redeem", json={"code": code})
        assert first.status_code == 200
        assert first.json()["community_id"] == cid

        # redeeming again while already a member changes nothing
        again = await joiner.post("/api/v1/invites/redeem", json={"code": code})
        assert again.status_code == 200

        members = await owner.get(f"/api/v1/communities/{cid}/members")
        assert len(members.json()["members"]) == 2


async def test_unknown_code_rejected(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("joiner")) as joiner:
        resp = await joiner.post("/api/v1/invites/redeem", json={"code": "definitely-not-a-code"})
        assert resp.status_code == 404
        assert resp.json()["code"] == "invalid_invite"


async def test_max_uses_enforced(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("first")) as first,
        user_client(app, uname("second")) as second,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        resp = await owner.post(f"/api/v1/communities/{cid}/invites", json={"max_uses": 1})
        code = resp.json()["code"]

        assert (await first.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        exhausted = await second.post("/api/v1/invites/redeem", json={"code": code})
        assert exhausted.status_code == 404


async def test_expired_invite_rejected(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("late")) as late,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)

        engine = create_async_engine(os.environ["OPENVOICE_TEST_DATABASE_URL"])
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE invites SET expires_at = now() - interval '1 hour'"))
        await engine.dispose()

        resp = await late.post("/api/v1/invites/redeem", json={"code": code})
        assert resp.status_code == 404


async def test_banned_user_cannot_redeem(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("banned")) as banned,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await banned.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200

        banned_id = (await banned.get("/api/v1/auth/session")).json()["user"]["id"]
        ban = await owner.post(f"/api/v1/communities/{cid}/bans", json={"user_id": banned_id})
        assert ban.status_code == 200

        resp = await banned.post("/api/v1/invites/redeem", json={"code": code})
        assert resp.status_code == 404


async def test_create_invite_requires_capability(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200

        # strip CREATE_INVITE from @everyone
        roles = (await owner.get(f"/api/v1/communities/{cid}/roles")).json()["roles"]
        everyone = next(r for r in roles if r["is_everyone"])
        new_perms = everyone["permissions"] & ~(1 << 4)  # CREATE_INVITE
        patched = await owner.patch(
            f"/api/v1/roles/{everyone['id']}", json={"permissions": new_perms}
        )
        assert patched.status_code == 200

        resp = await member.post(f"/api/v1/communities/{cid}/invites", json={})
        assert resp.status_code == 403
        assert resp.json()["capability"] == "CREATE_INVITE"
