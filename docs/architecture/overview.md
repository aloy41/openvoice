# Architecture overview

Status: kept in sync with shipped behavior. This document describes what
exists now and the intended shape; update it as features land.

## Systems

```
Browser client (React/TS/Vite, livekit-client)
        │  HTTPS (dev: Caddy on :8080)
        ▼
Caddy reverse proxy
        │  /api/* → FastAPI          │  static/dev server → Vite
        ▼
FastAPI control plane (Python 3.12, /api/v1, OpenAPI is the client contract)
        │            │
        ▼            ▼
PostgreSQL 16    Redis 7
(durable truth)  (ephemeral only — system must survive Redis loss)

Browser client ── WebSocket + WebRTC (DTLS-SRTP) ──► LiveKit SFU (Opus audio)
                                                        ▲
FastAPI ── issues short-lived, server-scoped room tokens ┘
```

- **Control plane** (`apps/api`): accounts (Argon2id passwords, HttpOnly
  cookie sessions with CSRF, per-device identity keys with device-bound
  sessions — ADR-0004/0007/0008), a deny-by-default capability authorization
  engine (ADR-0005), a durable per-community event log, and LiveKit token
  issuance. FastAPI + Pydantic + SQLAlchemy 2 + Alembic. Versioned REST under
  `/api/v1`. OpenAPI is authoritative; the TypeScript client in
  `packages/api-client` is generated from it and drift fails CI. A
  development-only shared-password login exists but is refused in production.
- **Media plane**: self-hosted LiveKit SFU (WebRTC + Opus). The API issues
  short-lived tokens *only* after checking the authenticated user, and derives
  room names and identities server-side — clients cannot choose privileged
  claims. TURN is deployed (LiveKit's embedded TURN over UDP, validated by the
  relay-only e2e test); TURN over TLS for the most restrictive networks is
  still future work.
- **Web client** (`apps/web`): React + TypeScript + Vite + Tailwind,
  `livekit-client` for the room session. TanStack Query owns server state;
  voice/session state lives in dedicated React contexts.

## Trust boundaries (current)

| Boundary | Crosses | Protection today |
| --- | --- | --- |
| Browser ↔ Caddy/API | credentials, session tokens, API calls | TLS (prod: Let's Encrypt; dev: localhost HTTP / internal CA). HttpOnly cookie sessions + double-submit CSRF; sessions can be bound to a proven device |
| Browser ↔ LiveKit | signaling (WS), media (WebRTC) | WSS + DTLS-SRTP transport encryption. Optional passphrase E2EE (SFrame) when enabled; without it **the SFU can access media** |
| API ↔ PostgreSQL/Redis | all durable/ephemeral state | private compose network; DB/Redis not published in the production stack |
| API ↔ LiveKit | shared API key/secret for token signing | secret via environment, never logged |

The threat model lives in `docs/security/threat-model.md`. E2EE is **opt-in**
today (voice passphrase, text AES-GCM envelopes); default-on group keying
(MLS) is designed in ADR-0009 but not yet implemented, and E2EE labeling does
not change until it lands and is reviewed.

## Key invariants

1. Deny by default: every LiveKit token request re-checks the authenticated
   user server-side; grants are audio-only, room fixed by the server, TTL ≤ 5
   minutes.
2. PostgreSQL is the source of truth; Redis contents are disposable.
3. All timestamps UTC/timezone-aware; identifiers are UUIDv7 (sortable).
4. Logs are structured JSON with request IDs and never contain tokens,
   passwords, key material, SDP, or message content.
5. Development-only code paths are guarded by configuration that the API
   refuses to accept in production mode (validated at startup, tested).

## Realtime

Presence via Redis (ephemeral, eventually consistent). Durable changes get a
monotonically ordered per-community event sequence; reconnecting clients catch
up from the durable log (WebSocket for live, REST for replay) without trusting
missed messages. Event delivery — over **both** the WebSocket and the REST
catch-up endpoint — is filtered by the subscriber's live `VIEW_CHANNELS`
permission (shared `event_visible`), and permission changes emit durable
events so a connected client's visibility recomputes mid-session. Open sockets
periodically re-validate their session, so revoking a session/device tears
down live delivery rather than waiting for reconnect.

## Decisions

See `docs/adr/` — notably ADR-0001 (stack), ADR-0002 (Python in Docker, npm
workspaces), ADR-0003 (dev auth + encryption labeling), ADR-0004 (cookie
sessions), ADR-0005 (permission model), ADR-0006 (voice passphrase E2EE),
ADR-0007 (device identity), ADR-0008 (device-bound sessions), ADR-0009 (MLS
group-key design).
