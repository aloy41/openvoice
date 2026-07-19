"""Kick, ban, unban, owner/self protection, and audit access control."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import requires_db, uname, user_client
from tests.test_communities import create_community, make_invite

pytestmark = requires_db

KICK_MEMBERS = 1 << 5


async def user_id_of(client: AsyncClient) -> str:
    return str((await client.get("/api/v1/auth/session")).json()["user"]["id"])


async def test_kick_flow(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        member_id = await user_id_of(member)

        # a plain member cannot kick
        owner_id = await user_id_of(owner)
        resp = await member.delete(f"/api/v1/communities/{cid}/members/{owner_id}")
        assert resp.status_code == 403

        # the owner kicks the member: access disappears immediately
        assert (
            await owner.delete(f"/api/v1/communities/{cid}/members/{member_id}")
        ).status_code == 200
        assert (await member.get(f"/api/v1/communities/{cid}")).status_code == 404

        # kicked (not banned) members can rejoin through an invite
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        assert (await member.get(f"/api/v1/communities/{cid}")).status_code == 200


async def test_ban_and_unban_flow(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("target")) as target,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await target.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        target_id = await user_id_of(target)

        ban = await owner.post(
            f"/api/v1/communities/{cid}/bans",
            json={"user_id": target_id, "reason": "spamming"},
        )
        assert ban.status_code == 200
        # membership gone, rejoin blocked
        assert (await target.get(f"/api/v1/communities/{cid}")).status_code == 404
        assert (await target.post("/api/v1/invites/redeem", json={"code": code})).status_code == 404

        listing = await owner.get(f"/api/v1/communities/{cid}/bans")
        assert [b["reason"] for b in listing.json()["bans"]] == ["spamming"]

        assert (
            await owner.delete(f"/api/v1/communities/{cid}/bans/{target_id}")
        ).status_code == 200
        assert (await target.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200


async def test_owner_and_self_protection(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("mod")) as mod,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await mod.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        mod_id = await user_id_of(mod)
        owner_id = await user_id_of(owner)

        role = await owner.post(
            f"/api/v1/communities/{cid}/roles",
            json={"name": "mods", "permissions": KICK_MEMBERS},
        )
        assert (
            await owner.put(f"/api/v1/communities/{cid}/members/{mod_id}/roles/{role.json()['id']}")
        ).status_code == 200

        # a moderator cannot kick the owner…
        resp = await mod.delete(f"/api/v1/communities/{cid}/members/{owner_id}")
        assert resp.status_code == 403
        assert resp.json()["code"] == "cannot_target_owner"
        # …or themselves
        resp = await mod.delete(f"/api/v1/communities/{cid}/members/{mod_id}")
        assert resp.status_code == 403
        assert resp.json()["code"] == "cannot_target_self"


async def test_audit_log_requires_capability(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200

        resp = await member.get(f"/api/v1/communities/{cid}/audit")
        assert resp.status_code == 403
        assert resp.json()["capability"] == "VIEW_AUDIT_LOG"

        events = await owner.get(f"/api/v1/communities/{cid}/audit")
        assert events.status_code == 200
        actions = [e["action"] for e in events.json()["events"]]
        assert "membership.joined" in actions
