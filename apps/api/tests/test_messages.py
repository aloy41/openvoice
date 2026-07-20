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


async def test_delete_scrubs_content_from_durable_event_log(app: FastAPI, clean_db: None) -> None:
    """A deleted message's content must not survive inside the event log:
    otherwise a reconnecting client would replay message.created and recover
    the 'deleted' text. The stored event keeps its envelope but empty content."""
    from sqlalchemy import select

    from openvoice_api.models import Event

    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await text_channel_of(owner, cid)
        msg = await send(owner, channel_id, "delete-me-secret-body")

        # Sanity: the content is in the durable log before deletion.
        async with app.state.sessionmaker() as db:
            rows = (
                (await db.execute(select(Event).where(Event.type == "message.created")))
                .scalars()
                .all()
            )
        assert any("delete-me-secret-body" in (r.payload["message"]["content"]) for r in rows)

        assert (await owner.delete(f"/api/v1/messages/{msg['id']}")).status_code == 200

        # After deletion the content is gone from every event row for this id.
        async with app.state.sessionmaker() as db:
            rows = (
                (
                    await db.execute(
                        select(Event).where(Event.type.in_(("message.created", "message.updated")))
                    )
                )
                .scalars()
                .all()
            )
        for r in rows:
            message = r.payload.get("message")
            if message and message.get("id") == msg["id"]:
                assert message["content"] == ""
                assert message.get("scrubbed") is True


async def test_events_endpoint_does_not_leak_hidden_channel_content(
    app: FastAPI, clean_db: None
) -> None:
    """GET /communities/{id}/events must apply the same VIEW_CHANNELS filter as
    the WebSocket, so the reconnect/replay path cannot leak a hidden channel's
    message content to a member who cannot see it."""
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        general = await text_channel_of(owner, cid)
        # A hidden channel: deny VIEW_CHANNELS to @everyone.
        secret = (
            await owner.post(
                f"/api/v1/communities/{cid}/channels",
                json={"name": "secret", "kind": "text"},
            )
        ).json()["id"]
        roles = (await owner.get(f"/api/v1/communities/{cid}/roles")).json()["roles"]
        everyone = next(r for r in roles if r["is_everyone"])["id"]
        assert (
            await owner.put(
                f"/api/v1/channels/{secret}/overrides",
                json={"role_id": everyone, "allow": 0, "deny": 1 << 0},  # VIEW_CHANNELS
            )
        ).status_code == 200
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200

        await send(owner, secret, "TOP-SECRET-REST-LEAK")
        await send(owner, general, "public-rest-hello")

        events = (await member.get(f"/api/v1/communities/{cid}/events?after_seq=0")).json()
        contents = [
            (e.get("payload", {}).get("message") or {}).get("content", "") for e in events["events"]
        ]
        assert "public-rest-hello" in contents
        assert not any("TOP-SECRET-REST-LEAK" in c for c in contents)


async def test_retention_prunes_events_older_than_window(app: FastAPI, clean_db: None) -> None:
    """Old events are pruned so content cannot linger past the retention
    window; recent events are kept for reconnect catch-up."""
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import func, select

    from openvoice_api.events import prune_all_communities
    from openvoice_api.models import Event

    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await text_channel_of(owner, cid)
        await send(owner, channel_id, "old message")

        # Backdate every existing event well past the window.
        from sqlalchemy import update as sql_update

        async with app.state.sessionmaker() as db:
            await db.execute(
                sql_update(Event).values(created_at=datetime.now(tz=UTC) - timedelta(days=40))
            )
            await db.commit()

        await send(owner, channel_id, "fresh message")

        async with app.state.sessionmaker() as db:
            removed = await prune_all_communities(db, keep_seconds=14 * 24 * 60 * 60)
            await db.commit()
        assert removed >= 1

        async with app.state.sessionmaker() as db:
            remaining = (await db.execute(select(func.count()).select_from(Event))).scalar_one()
            fresh = (
                (await db.execute(select(Event).where(Event.type == "message.created")))
                .scalars()
                .all()
            )
        assert remaining >= 1
        assert any("fresh message" in r.payload["message"]["content"] for r in fresh)
        assert not any("old message" in r.payload["message"]["content"] for r in fresh)


async def test_reply_to_message(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        channel_id = await text_channel_of(owner, cid)
        parent = await send(owner, channel_id, "the original")

        reply = await owner.post(
            f"/api/v1/channels/{channel_id}/messages",
            json={"content": "a reply", "reply_to_id": parent["id"]},
        )
        assert reply.status_code == 200, reply.text
        body = reply.json()
        assert body["reply_to"]["id"] == parent["id"]
        assert body["reply_to"]["content"] == "the original"
        assert body["reply_to"]["deleted"] is False

        # the reply preview also comes back when listing.
        listing = (await owner.get(f"/api/v1/channels/{channel_id}/messages")).json()
        replied = next(m for m in listing["messages"] if m["id"] == body["id"])
        assert replied["reply_to"]["id"] == parent["id"]

        # replying to a non-existent message is refused.
        import uuid as _uuid

        bad = await owner.post(
            f"/api/v1/channels/{channel_id}/messages",
            json={"content": "x", "reply_to_id": str(_uuid.uuid4())},
        )
        assert bad.status_code == 422 and bad.json()["code"] == "invalid_reply_target"


async def test_reply_target_must_be_same_channel(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        chan_a = await text_channel_of(owner, cid)
        chan_b = (
            await owner.post(
                f"/api/v1/communities/{cid}/channels", json={"name": "other", "kind": "text"}
            )
        ).json()["id"]
        msg_a = await send(owner, chan_a, "in A")
        cross = await owner.post(
            f"/api/v1/channels/{chan_b}/messages",
            json={"content": "reply from B", "reply_to_id": msg_a["id"]},
        )
        assert cross.status_code == 422 and cross.json()["code"] == "invalid_reply_target"


async def test_pin_and_unpin(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("owner")) as owner,
        user_client(app, uname("member")) as member,
    ):
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        code = await make_invite(owner, cid)
        assert (await member.post("/api/v1/invites/redeem", json={"code": code})).status_code == 200
        channel_id = await text_channel_of(owner, cid)
        msg = await send(owner, channel_id, "pin me")

        # a plain member (no MANAGE_MESSAGES) cannot pin.
        denied = await member.put(f"/api/v1/messages/{msg['id']}/pin")
        assert denied.status_code == 403 and denied.json()["capability"] == "MANAGE_MESSAGES"

        pinned = await owner.put(f"/api/v1/messages/{msg['id']}/pin")
        assert pinned.status_code == 200 and pinned.json()["pinned"] is True

        pins = (await member.get(f"/api/v1/channels/{channel_id}/pins")).json()["messages"]
        assert [m["id"] for m in pins] == [msg["id"]]

        unpinned = await owner.delete(f"/api/v1/messages/{msg['id']}/pin")
        assert unpinned.status_code == 200 and unpinned.json()["pinned"] is False
        assert (await owner.get(f"/api/v1/channels/{channel_id}/pins")).json()["messages"] == []


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


async def test_encrypted_scheme_stored_verbatim_and_opaque(app: FastAPI, clean_db: None) -> None:
    import os

    from sqlalchemy import text as sql_text
    from sqlalchemy.ext.asyncio import create_async_engine

    async with user_client(app, uname("owner")) as owner:
        detail = await create_community(owner)
        channel_id = await text_channel_of(owner, detail["community"]["id"])
        # The client would send a real AES-GCM envelope; the server treats it
        # as opaque, so any base64-ish blob exercises the same path.
        envelope = "eyJ2IjoxLCJhbGciOiJBRVMtR0NNIiwiY3QiOiJZbXhoWWc9PSJ9"
        resp = await owner.post(
            f"/api/v1/channels/{channel_id}/messages",
            json={"content": envelope, "scheme": "passphrase-v1"},
        )
        assert resp.status_code == 200
        assert resp.json()["scheme"] == "passphrase-v1"
        assert resp.json()["content"] == envelope

        # The stored row is exactly the ciphertext — no plaintext column.
        engine = create_async_engine(os.environ["OPENVOICE_TEST_DATABASE_URL"])
        async with engine.connect() as conn:
            row = (
                await conn.execute(
                    sql_text("SELECT scheme, content FROM messages ORDER BY id DESC LIMIT 1")
                )
            ).first()
        await engine.dispose()
        assert row is not None
        assert row[0] == "passphrase-v1"
        assert row[1] == envelope

    # An unknown scheme is rejected (the enum is the contract).
    async with user_client(app, uname("owner2")) as owner2:
        detail = await create_community(owner2)
        channel_id = await text_channel_of(owner2, detail["community"]["id"])
        bad = await owner2.post(
            f"/api/v1/channels/{channel_id}/messages",
            json={"content": "x", "scheme": "rot13"},
        )
        assert bad.status_code == 422


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
