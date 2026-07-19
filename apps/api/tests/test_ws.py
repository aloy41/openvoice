"""WebSocket event stream: auth, subscribe/replay, and the security rule
that a kicked member's open stream terminates immediately.

Uses a single TestClient (one event loop): async pools (asyncpg, redis)
must not be shared across loops. The second user is driven with explicit
Cookie headers instead of the client's jar.
"""

from __future__ import annotations

import contextlib
import uuid as uuidlib
from typing import Any

from starlette.testclient import TestClient

from openvoice_api.main import create_app
from tests.conftest import TEST_USER_PASSWORD, make_settings, requires_db, uname

pytestmark = requires_db


def test_ws_requires_authentication(clean_db: None) -> None:
    app = create_app(make_settings())
    with TestClient(app) as client:
        # Depending on the client version the immediate close surfaces either
        # as a close frame or as an exception — both mean "refused".
        with contextlib.suppress(Exception), client.websocket_connect("/api/v1/ws") as ws:
            data = ws.receive()
            assert data["type"] == "websocket.close"
            assert data.get("code") == 4401


def test_ws_replay_and_kick_termination(clean_db: None) -> None:
    app = create_app(make_settings())
    with TestClient(app) as client:
        client.get("/api/healthz")
        csrf = client.cookies.get("ov_csrf")
        assert csrf

        # Owner registers via explicit cookies so the jar stays free for the
        # member (whose cookies the websocket handshake will use).
        owner_reg = client.post(
            "/api/v1/auth/register",
            json={"username": uname("wsowner"), "password": TEST_USER_PASSWORD},
            headers={"x-csrf-token": csrf},
        )
        assert owner_reg.status_code == 200, owner_reg.text
        owner_session = owner_reg.cookies.get("ov_session")
        assert owner_session
        client.cookies.delete("ov_session")

        def as_owner(extra: dict[str, str] | None = None) -> dict[str, str]:
            return {
                "x-csrf-token": csrf,
                "cookie": f"ov_session={owner_session}; ov_csrf={csrf}",
                **(extra or {}),
            }

        community = client.post(
            "/api/v1/communities", json={"name": "WS Test"}, headers=as_owner()
        ).json()
        cid = community["community"]["id"]
        text_channel = next(c for c in community["channels"] if c["kind"] == "text")["id"]
        code = client.post(
            f"/api/v1/communities/{cid}/invites",
            json={"expires_in_hours": 1},
            headers=as_owner(),
        ).json()["code"]

        # Member registers into the jar (websocket_connect uses jar cookies).
        member_reg = client.post(
            "/api/v1/auth/register",
            json={"username": uname("wsmember"), "password": TEST_USER_PASSWORD},
            headers={"x-csrf-token": csrf},
        )
        assert member_reg.status_code == 200, member_reg.text
        member_id = member_reg.json()["user"]["id"]
        assert (
            client.post(
                "/api/v1/invites/redeem",
                json={"code": code},
                headers={"x-csrf-token": csrf},
            ).status_code
            == 200
        )
        pre_subscribe = client.post(
            f"/api/v1/channels/{text_channel}/messages",
            json={"content": "before-subscribe"},
            headers=as_owner(),
        )
        assert pre_subscribe.status_code == 200

        with client.websocket_connect("/api/v1/ws") as ws:
            ws.send_json({"type": "subscribe", "community_id": cid, "after_seq": 0})
            ack = ws.receive_json()
            assert ack["type"] == "subscribed"
            assert ack["latest_seq"] >= 2  # membership.joined + message.created

            # replay must contain everything sent before we subscribed
            replayed: list[dict[str, Any]] = []
            while len(replayed) < ack["latest_seq"]:
                msg = ws.receive_json()
                assert msg["type"] == "event"
                replayed.append(msg["event"])
            types = [e["type"] for e in replayed]
            assert "message.created" in types
            assert "membership.joined" in types
            seqs = [e["seq"] for e in replayed]
            assert seqs == sorted(seqs)

            # non-member subscription attempt is refused
            ws.send_json(
                {"type": "subscribe", "community_id": str(uuidlib.uuid4()), "after_seq": 0}
            )
            err = ws.receive_json()
            assert err == {"type": "error", "code": "not_found"}

            # resubscribe, then get kicked: the stream must terminate with an
            # explicit notice instead of leaking further events
            ws.send_json({"type": "subscribe", "community_id": cid, "after_seq": ack["latest_seq"]})
            ack2 = ws.receive_json()
            assert ack2["type"] == "subscribed"

            kicked = client.delete(
                f"/api/v1/communities/{cid}/members/{member_id}", headers=as_owner()
            )
            assert kicked.status_code == 200, kicked.text

            notice = ws.receive_json()
            assert notice["type"] == "unsubscribed"
            assert notice["code"] == "membership_removed"

            # messages sent after the kick must NOT arrive on this socket;
            # a fresh subscribe attempt is refused outright.
            client.post(
                f"/api/v1/channels/{text_channel}/messages",
                json={"content": "secret"},
                headers=as_owner(),
            )
            ws.send_json({"type": "subscribe", "community_id": cid, "after_seq": 0})
            refused = ws.receive_json()
            assert refused == {"type": "error", "code": "not_found"}


VIEW_CHANNELS = 1 << 0


def _owner_and_member(client: TestClient) -> tuple[str, str, dict[str, str], str]:
    """Register an owner (explicit cookies) + a member (jar, used by the WS),
    return (csrf, owner_session, owner_headers-builder-inputs, member_id)."""
    client.get("/api/healthz")
    csrf = client.cookies.get("ov_csrf")
    assert csrf
    owner_reg = client.post(
        "/api/v1/auth/register",
        json={"username": uname("wsown"), "password": TEST_USER_PASSWORD},
        headers={"x-csrf-token": csrf},
    )
    owner_session = owner_reg.cookies.get("ov_session")
    assert owner_session
    client.cookies.delete("ov_session")
    member_reg = client.post(
        "/api/v1/auth/register",
        json={"username": uname("wsmem"), "password": TEST_USER_PASSWORD},
        headers={"x-csrf-token": csrf},
    )
    return csrf, owner_session, {}, member_reg.json()["user"]["id"]


def test_ws_does_not_leak_events_for_hidden_channels(clean_db: None) -> None:
    app = create_app(make_settings())
    with TestClient(app) as client:
        csrf, owner_session, _, _member_id = _owner_and_member(client)

        def owner(extra: dict[str, str] | None = None) -> dict[str, str]:
            return {
                "x-csrf-token": csrf,
                "cookie": f"ov_session={owner_session}; ov_csrf={csrf}",
                **(extra or {}),
            }

        community = client.post("/api/v1/communities", json={"name": "Vis"}, headers=owner()).json()
        cid = community["community"]["id"]
        general = next(c for c in community["channels"] if c["kind"] == "text")["id"]
        # A second, hidden text channel: deny VIEW_CHANNELS to @everyone.
        secret = client.post(
            f"/api/v1/communities/{cid}/channels",
            json={"name": "secret", "kind": "text"},
            headers=owner(),
        ).json()["id"]
        roles = client.get(f"/api/v1/communities/{cid}/roles", headers=owner()).json()["roles"]
        everyone = next(r for r in roles if r["is_everyone"])["id"]
        assert (
            client.put(
                f"/api/v1/channels/{secret}/overrides",
                json={"role_id": everyone, "allow": 0, "deny": VIEW_CHANNELS},
                headers=owner(),
            ).status_code
            == 200
        )
        code = client.post(
            f"/api/v1/communities/{cid}/invites",
            json={"expires_in_hours": 1},
            headers=owner(),
        ).json()["code"]
        assert (
            client.post(
                "/api/v1/invites/redeem", json={"code": code}, headers={"x-csrf-token": csrf}
            ).status_code
            == 200
        )

        with client.websocket_connect("/api/v1/ws") as ws:  # member (jar cookies)
            ws.send_json({"type": "subscribe", "community_id": cid, "after_seq": 0})
            assert ws.receive_json()["type"] == "subscribed"

            # Post in the HIDDEN channel first, then the VISIBLE one.
            client.post(
                f"/api/v1/channels/{secret}/messages",
                json={"content": "TOP-SECRET-LEAK"},
                headers=owner(),
            )
            client.post(
                f"/api/v1/channels/{general}/messages",
                json={"content": "public-hello"},
                headers=owner(),
            )

            # Drain live events until we see the public message; the secret
            # message must NEVER appear on this member's socket.
            seen_public = False
            for _ in range(30):
                msg = ws.receive_json()
                if msg.get("type") == "event":
                    payload = msg["event"].get("payload", {})
                    content = (payload.get("message") or {}).get("content", "")
                    assert "TOP-SECRET-LEAK" not in content
                    if content == "public-hello":
                        seen_public = True
                        break
            assert seen_public, "the visible message should have been delivered"


def test_ws_replay_paginates_beyond_one_page(clean_db: None, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import openvoice_api.routers.ws as ws_mod

    monkeypatch.setattr(ws_mod, "REPLAY_PAGE", 2)  # tiny pages to force pagination
    app = create_app(make_settings())
    with TestClient(app) as client:
        csrf, owner_session, _, _ = _owner_and_member(client)

        def owner() -> dict[str, str]:
            return {"x-csrf-token": csrf, "cookie": f"ov_session={owner_session}; ov_csrf={csrf}"}

        community = client.post(
            "/api/v1/communities", json={"name": "Pages"}, headers=owner()
        ).json()
        cid = community["community"]["id"]
        channel = next(c for c in community["channels"] if c["kind"] == "text")["id"]
        code = client.post(
            f"/api/v1/communities/{cid}/invites", json={"expires_in_hours": 1}, headers=owner()
        ).json()["code"]
        client.post("/api/v1/invites/redeem", json={"code": code}, headers={"x-csrf-token": csrf})
        # 6 messages → 3+ replay pages at REPLAY_PAGE=2.
        for i in range(6):
            client.post(
                f"/api/v1/channels/{channel}/messages",
                json={"content": f"m{i}"},
                headers=owner(),
            )

        with client.websocket_connect("/api/v1/ws") as ws:
            ws.send_json({"type": "subscribe", "community_id": cid, "after_seq": 0})
            assert ws.receive_json()["type"] == "subscribed"
            contents: list[str] = []
            # Read enough events to cover all 6 messages + structural events.
            for _ in range(12):
                msg = ws.receive_json()
                if msg.get("type") == "event":
                    c = (msg["event"].get("payload", {}).get("message") or {}).get("content")
                    if c:
                        contents.append(c)
                if len([c for c in contents if c.startswith("m")]) == 6:
                    break
            assert [f"m{i}" for i in range(6)] == [c for c in contents if c.startswith("m")]
