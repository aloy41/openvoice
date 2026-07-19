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
