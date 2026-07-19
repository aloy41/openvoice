"""User profiles: view/edit self, colour validation, public cards."""

from __future__ import annotations

from fastapi import FastAPI

from tests.conftest import requires_db, uname, user_client

pytestmark = requires_db


async def test_edit_and_read_own_profile(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("me")) as c:
        me = await c.get("/api/v1/users/me")
        assert me.status_code == 200
        assert me.json()["accent_color"] is None

        patched = await c.patch(
            "/api/v1/users/me",
            json={
                "display_name": "Ada L.",
                "accent_color": "#3b82f6",
                "pronouns": "she/her",
                "bio": "Countess of computing.",
            },
        )
        assert patched.status_code == 200
        body = patched.json()
        assert body["display_name"] == "Ada L."
        assert body["accent_color"] == "#3b82f6"
        assert body["pronouns"] == "she/her"
        assert body["bio"] == "Countess of computing."

        # the session response now carries the accent color
        session = await c.get("/api/v1/auth/session")
        assert session.json()["user"]["accent_color"] == "#3b82f6"


async def test_invalid_color_is_dropped_not_stored(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("me")) as c:
        # length-valid but not a hex colour → silently dropped to null
        resp = await c.patch("/api/v1/users/me", json={"accent_color": "purple"})
        assert resp.status_code == 200
        assert resp.json()["accent_color"] is None
        # over-length is rejected outright
        assert (
            await c.patch("/api/v1/users/me", json={"accent_color": "#toolongvalue"})
        ).status_code == 422


async def test_public_profile_card_visible_to_others(app: FastAPI, clean_db: None) -> None:
    async with (
        user_client(app, uname("alice")) as alice,
        user_client(app, uname("bob")) as bob,
    ):
        await alice.patch("/api/v1/users/me", json={"bio": "hi there", "pronouns": "they/them"})
        alice_id = (await alice.get("/api/v1/users/me")).json()["id"]
        card = await bob.get(f"/api/v1/users/{alice_id}")
        assert card.status_code == 200
        assert card.json()["bio"] == "hi there"
        assert card.json()["pronouns"] == "they/them"


async def test_profile_edit_requires_csrf(app: FastAPI, clean_db: None) -> None:
    async with user_client(app, uname("me")) as c:
        c.headers.pop("x-csrf-token", None)
        resp = await c.patch("/api/v1/users/me", json={"bio": "x"})
        assert resp.status_code == 403


async def test_members_and_messages_include_accent_color(app: FastAPI, clean_db: None) -> None:
    from tests.test_communities import create_community
    from tests.test_messages import text_channel_of

    async with user_client(app, uname("owner")) as owner:
        await owner.patch("/api/v1/users/me", json={"accent_color": "#ef4444"})
        detail = await create_community(owner)
        cid = detail["community"]["id"]
        members = await owner.get(f"/api/v1/communities/{cid}/members")
        assert members.json()["members"][0]["accent_color"] == "#ef4444"

        channel_id = await text_channel_of(owner, cid)
        await owner.post(f"/api/v1/channels/{channel_id}/messages", json={"content": "hi"})
        msgs = await owner.get(f"/api/v1/channels/{channel_id}/messages")
        assert msgs.json()["messages"][0]["author_color"] == "#ef4444"
