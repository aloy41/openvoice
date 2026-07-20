"""Kick, ban, unban, owner/self protection, and audit access control."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import requires_db, uname, user_client
from tests.test_communities import create_community, make_invite

pytestmark = requires_db

VIEW_CHANNELS = 1 << 0
KICK_MEMBERS = 1 << 5
BAN_MEMBERS = 1 << 6


async def user_id_of(client: AsyncClient) -> str:
    return str((await client.get("/api/v1/auth/session")).json()["user"]["id"])


async def _make_role(client: AsyncClient, cid: str, name: str, permissions: int) -> str:
    resp = await client.post(
        f"/api/v1/communities/{cid}/roles", json={"name": name, "permissions": permissions}
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["id"])


async def _assign(client: AsyncClient, cid: str, user_id: str, role_id: str) -> None:
    resp = await client.put(f"/api/v1/communities/{cid}/members/{user_id}/roles/{role_id}")
    assert resp.status_code == 200, resp.text


async def test_moderation_respects_role_hierarchy(app: FastAPI, clean_db: None) -> None:
    """A moderator may not kick/ban a member whose top role is equal or higher;
    only the owner (or someone strictly above) can."""
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("mod")) as mod,
        user_client(app, uname("senior")) as senior,
        user_client(app, uname("plain")) as plain,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        for c in (mod, senior, plain):
            assert (await c.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200

        # "mod" role (position 1) can kick/ban; "senior" role (position 2) is higher.
        mod_role = await _make_role(owner, cid, "mod", VIEW_CHANNELS | KICK_MEMBERS | BAN_MEMBERS)
        senior_role = await _make_role(owner, cid, "senior", VIEW_CHANNELS)
        mod_id = await user_id_of(mod)
        senior_id = await user_id_of(senior)
        plain_id = await user_id_of(plain)
        await _assign(owner, cid, mod_id, mod_role)
        await _assign(owner, cid, senior_id, senior_role)

        # mod cannot kick or ban the higher-ranked senior.
        r = await mod.delete(f"/api/v1/communities/{cid}/members/{senior_id}")
        assert r.status_code == 403 and r.json()["code"] == "insufficient_role"
        r = await mod.post(f"/api/v1/communities/{cid}/bans", json={"user_id": senior_id})
        assert r.status_code == 403 and r.json()["code"] == "insufficient_role"

        # mod CAN kick the plain member (no roles → lower rank).
        assert (
            await mod.delete(f"/api/v1/communities/{cid}/members/{plain_id}")
        ).status_code == 200


async def test_reban_after_ban_expires(app: FastAPI, clean_db: None) -> None:
    """An expired ban must not block re-banning (409 already_banned) — it is
    refreshed in place instead."""
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update as sql_update

    from openvoice_api.models import Ban

    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("target")) as target,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await target.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        target_id = await user_id_of(target)

        assert (
            await owner.post(
                f"/api/v1/communities/{cid}/bans",
                json={"user_id": target_id, "expires_in_hours": 1},
            )
        ).status_code == 200
        # A still-active ban is a conflict.
        assert (
            await owner.post(f"/api/v1/communities/{cid}/bans", json={"user_id": target_id})
        ).status_code == 409

        # Expire the ban in the DB, then re-banning must succeed.
        async with app.state.sessionmaker() as db:
            await db.execute(
                sql_update(Ban)
                .where(Ban.user_id == target_id)
                .values(expires_at=datetime.now(tz=UTC) - timedelta(hours=1))
            )
            await db.commit()
        assert (
            await owner.post(f"/api/v1/communities/{cid}/bans", json={"user_id": target_id})
        ).status_code == 200


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
