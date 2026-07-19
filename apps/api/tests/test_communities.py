"""Community/channel CRUD, authorization, and IDOR behavior."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import requires_db, uname, user_client

pytestmark = requires_db


async def create_community(client: AsyncClient, name: str = "My Community") -> dict:
    resp = await client.post("/api/v1/communities", json={"name": name})
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def make_invite(client: AsyncClient, community_id: str) -> str:
    resp = await client.post(f"/api/v1/communities/{community_id}/invites", json={})
    assert resp.status_code == 200, resp.text
    return str(resp.json()["code"])


async def test_create_community_provisions_defaults(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        kinds = sorted(ch["kind"] for ch in detail["channels"])
        assert kinds == ["category", "text", "voice"]
        # owner resolves to every capability
        assert "ADMINISTRATOR" in detail["my_capabilities"]
        assert "CONNECT_VOICE" in detail["my_capabilities"]

        listing = await owner.get("/api/v1/communities")
        assert len(listing.json()["communities"]) == 1


async def test_non_members_get_404_for_everything(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("stranger")) as stranger,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]

        assert (await stranger.get(f"/api/v1/communities/{cid}")).status_code == 404
        assert (
            await stranger.post(
                f"/api/v1/communities/{cid}/channels", json={"name": "x", "kind": "text"}
            )
        ).status_code == 404
        assert (await stranger.get(f"/api/v1/communities/{cid}/members")).status_code == 404
        assert (await stranger.delete(f"/api/v1/communities/{cid}")).status_code == 404
        # and their community list stays empty
        assert stranger and (await stranger.get("/api/v1/communities")).json()["communities"] == []


async def test_plain_member_cannot_manage_channels(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        joined = await member.post("/api/v1/invites/redeem", json={"code": code})
        assert joined.status_code == 200

        # member can see the community…
        assert (await member.get(f"/api/v1/communities/{cid}")).status_code == 200
        # …but cannot manage channels
        resp = await member.post(
            f"/api/v1/communities/{cid}/channels", json={"name": "nope", "kind": "text"}
        )
        assert resp.status_code == 403
        assert resp.json()["capability"] == "MANAGE_CHANNELS"


async def test_owner_channel_crud_and_audit(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]

        created = await owner.post(
            f"/api/v1/communities/{cid}/channels", json={"name": "planning", "kind": "voice"}
        )
        assert created.status_code == 200
        channel_id = created.json()["id"]

        renamed = await owner.patch(f"/api/v1/channels/{channel_id}", json={"name": "plans"})
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "plans"

        deleted = await owner.delete(f"/api/v1/channels/{channel_id}")
        assert deleted.status_code == 200

        audit = await owner.get(f"/api/v1/communities/{cid}/audit")
        actions = [e["action"] for e in audit.json()["events"]]
        for expected in (
            "community.created",
            "channel.created",
            "channel.updated",
            "channel.deleted",
        ):
            assert expected in actions


async def test_only_owner_deletes_community(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("admin")) as admin,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await admin.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200

        # grant ADMINISTRATOR via a role
        role = await owner.post(
            f"/api/v1/communities/{cid}/roles",
            json={"name": "admins", "permissions": 1 << 13},
        )
        assert role.status_code == 200
        admin_id = (await admin.get("/api/v1/auth/session")).json()["user"]["id"]
        assigned = await owner.put(
            f"/api/v1/communities/{cid}/members/{admin_id}/roles/{role.json()['id']}"
        )
        assert assigned.status_code == 200

        # administrator still cannot delete the community
        resp = await admin.delete(f"/api/v1/communities/{cid}")
        assert resp.status_code == 403
        assert resp.json()["code"] == "owner_only"

        assert (await owner.delete(f"/api/v1/communities/{cid}")).status_code == 200
        assert (await owner.get("/api/v1/communities")).json()["communities"] == []


async def test_invalid_channel_parent_rejected(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        text_channel = next(c for c in detail["channels"] if c["kind"] == "text")
        resp = await owner.post(
            f"/api/v1/communities/{cid}/channels",
            json={"name": "x", "kind": "text", "parent_id": text_channel["id"]},
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "invalid_parent"
