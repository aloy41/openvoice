"""Emoji reactions: toggle semantics, per-message aggregation, authz, events."""

from __future__ import annotations

from fastapi import FastAPI

from tests.conftest import requires_db, uname, user_client
from tests.test_communities import create_community, make_invite
from tests.test_messages import text_channel_of

pytestmark = requires_db


async def test_toggle_and_aggregate(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await text_channel_of(owner, cid)
        msg = (
            await owner.post(f"/api/v1/channels/{channel_id}/messages", json={"content": "gm"})
        ).json()
        mid = msg["id"]
        owner_id = (await owner.get("/api/v1/users/me")).json()["id"]
        member_id = (await member.get("/api/v1/users/me")).json()["id"]

        # owner adds 👍
        r1 = await owner.post(f"/api/v1/messages/{mid}/reactions", json={"emoji": "👍"})
        assert r1.status_code == 200
        assert r1.json() == [{"emoji": "👍", "user_ids": [owner_id]}]

        # member adds 👍 (aggregates) and 🎉
        await member.post(f"/api/v1/messages/{mid}/reactions", json={"emoji": "👍"})
        await member.post(f"/api/v1/messages/{mid}/reactions", json={"emoji": "🎉"})

        listing = (await member.get(f"/api/v1/channels/{channel_id}/messages")).json()
        reactions = {r["emoji"]: r["user_ids"] for r in listing["messages"][0]["reactions"]}
        assert set(reactions["👍"]) == {owner_id, member_id}
        assert reactions["🎉"] == [member_id]

        # owner toggles 👍 off
        r2 = await owner.post(f"/api/v1/messages/{mid}/reactions", json={"emoji": "👍"})
        assert r2.json() == [{"emoji": "👍", "user_ids": [member_id]}] or {
            r["emoji"]: r["user_ids"] for r in r2.json()
        }["👍"] == [member_id]


async def test_reaction_requires_send_permission(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await text_channel_of(owner, cid)
        msg = (
            await owner.post(f"/api/v1/channels/{channel_id}/messages", json={"content": "hi"})
        ).json()

        # deny SEND_MESSAGES to @everyone on this channel
        roles = (await owner.get(f"/api/v1/communities/{cid}/roles")).json()["roles"]
        everyone = next(r for r in roles if r["is_everyone"])
        await owner.put(
            f"/api/v1/channels/{channel_id}/overrides",
            json={"role_id": everyone["id"], "allow": 0, "deny": 1 << 7},
        )
        resp = await member.post(f"/api/v1/messages/{msg['id']}/reactions", json={"emoji": "👍"})
        assert resp.status_code == 403
        assert resp.json()["capability"] == "SEND_MESSAGES"


async def test_reaction_emits_event(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await text_channel_of(owner, cid)
        msg = (
            await owner.post(f"/api/v1/channels/{channel_id}/messages", json={"content": "x"})
        ).json()
        await owner.post(f"/api/v1/messages/{msg['id']}/reactions", json={"emoji": "🔥"})
        events = (await owner.get(f"/api/v1/communities/{cid}/events")).json()["events"]
        react = [e for e in events if e["type"] == "message.reaction_updated"]
        assert react and react[-1]["payload"]["message_id"] == msg["id"]
        assert react[-1]["payload"]["reactions"][0]["emoji"] == "🔥"
