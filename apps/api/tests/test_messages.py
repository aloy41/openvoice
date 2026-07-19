"""Messages: send/list/edit/delete authz, tombstones, pagination, and the
per-community event log (monotonic seq + catch-up replay)."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import requires_db, uname, user_client
from tests.test_communities import create_community, make_invite

pytestmark = requires_db


async def text_channel_of(client: AsyncClient, cid: str) -> str:
    detail = (await client.get(f"/api/v1/communities/{cid}")).json()
    return str(next(c for c in detail["channels"] if c["kind"] == "text")["id"])


async def send(client: AsyncClient, channel_id: str, content: str) -> dict:
    resp = await client.post(f"/api/v1/channels/{channel_id}/messages", json={"content": content})
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def test_send_list_edit_delete_flow(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await text_channel_of(owner, cid)

        first = await send(owner, channel_id, "hello world")
        await send(member, channel_id, "hi!")

        listing = (await member.get(f"/api/v1/channels/{channel_id}/messages")).json()
        assert [m["content"] for m in listing["messages"]] == ["hello world", "hi!"]
        assert listing["messages"][0]["author_name"]

        # author edits
        edited = await owner.patch(
            f"/api/v1/messages/{first['id']}", json={"content": "hello (edited)"}
        )
        assert edited.status_code == 200
        assert edited.json()["edited_at"] is not None

        # a member cannot edit someone else's message
        stolen = await member.patch(f"/api/v1/messages/{first['id']}", json={"content": "hijack"})
        assert stolen.status_code == 403
        assert stolen.json()["code"] == "not_message_author"

        # author deletes → tombstone
        assert (await owner.delete(f"/api/v1/messages/{first['id']}")).status_code == 200
        after = (await member.get(f"/api/v1/channels/{channel_id}/messages")).json()
        tomb = after["messages"][0]
        assert tomb["deleted"] is True and tomb["content"] == ""
        # a tombstone cannot be edited or re-deleted
        assert (
            await owner.patch(f"/api/v1/messages/{first['id']}", json={"content": "x"})
        ).status_code == 404


async def test_manage_messages_moderator_delete(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await text_channel_of(owner, cid)

        msg = await send(member, channel_id, "delete me")
        # member cannot delete the owner's message, but the owner (all caps)
        # can delete the member's.
        owner_msg = await send(owner, channel_id, "owner message")
        refused = await member.delete(f"/api/v1/messages/{owner_msg['id']}")
        assert refused.status_code == 403
        assert refused.json()["capability"] == "MANAGE_MESSAGES"
        assert (await owner.delete(f"/api/v1/messages/{msg['id']}")).status_code == 200


async def test_send_requires_capability_and_membership(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("stranger")) as stranger,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await text_channel_of(owner, cid)

        # non-member: 404, no existence leak
        assert (
            await stranger.post(f"/api/v1/channels/{channel_id}/messages", json={"content": "hi"})
        ).status_code == 404

        # member with SEND_MESSAGES denied on the channel: 403
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        roles = (await owner.get(f"/api/v1/communities/{cid}/roles")).json()["roles"]
        everyone = next(r for r in roles if r["is_everyone"])
        assert (
            await owner.put(
                f"/api/v1/channels/{channel_id}/overrides",
                json={"role_id": everyone["id"], "allow": 0, "deny": 1 << 7},
            )
        ).status_code == 200
        refused = await member.post(
            f"/api/v1/channels/{channel_id}/messages", json={"content": "hi"}
        )
        assert refused.status_code == 403
        assert refused.json()["capability"] == "SEND_MESSAGES"


async def test_voice_channel_rejects_messages(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        voice_id = next(c for c in detail["channels"] if c["kind"] == "voice")["id"]
        resp = await owner.post(f"/api/v1/channels/{voice_id}/messages", json={"content": "hi"})
        assert resp.status_code == 422
        assert resp.json()["code"] == "not_a_text_channel"


async def test_pagination_cursor(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        channel_id = await text_channel_of(owner, detail["community"]["id"])
        for i in range(55):
            await send(owner, channel_id, f"m{i}")
        page1 = (await owner.get(f"/api/v1/channels/{channel_id}/messages")).json()
        assert len(page1["messages"]) == 50
        assert page1["messages"][-1]["content"] == "m54"
        assert page1["next_cursor"] is not None
        page2 = (
            await owner.get(f"/api/v1/channels/{channel_id}/messages?before={page1['next_cursor']}")
        ).json()
        assert [m["content"] for m in page2["messages"]] == [f"m{i}" for i in range(5)]
        assert page2["next_cursor"] is None


async def test_event_log_is_monotonic_and_replayable(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await text_channel_of(owner, cid)

        sent = await send(owner, channel_id, "one")
        await send(owner, channel_id, "two")
        await owner.patch(f"/api/v1/messages/{sent['id']}", json={"content": "one!"})
        await owner.delete(f"/api/v1/messages/{sent['id']}")

        log = (await owner.get(f"/api/v1/communities/{cid}/events")).json()
        seqs = [e["seq"] for e in log["events"]]
        assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
        types = [e["type"] for e in log["events"]]
        assert types.count("message.created") == 2
        assert "message.updated" in types and "message.deleted" in types
        assert log["latest_seq"] == max(seqs)

        # catch-up from the middle replays only the tail
        partial = (await owner.get(f"/api/v1/communities/{cid}/events?after_seq={seqs[1]}")).json()
        assert [e["seq"] for e in partial["events"]] == seqs[2:]

        # non-members cannot read the log
        async with user_client(app, uname("stranger")) as stranger:
            assert (await stranger.get(f"/api/v1/communities/{cid}/events")).status_code == 404
