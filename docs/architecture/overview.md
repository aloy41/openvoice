# Architecture overview

Status: Milestone 0/1 (voice technology spike). This document describes what
exists now and the intended shape; it is updated as milestones land.

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

- **Control plane** (`apps/api`): accounts (dev-only for now), authorization,
  and LiveKit token issuance. FastAPI + Pydantic + SQLAlchemy 2 + Alembic.
  Versioned REST under `/api/v1`. OpenAPI is authoritative; the TypeScript
  client in `packages/api-client` is generated from it and drift fails CI.
- **Media plane**: self-hosted LiveKit SFU (WebRTC + Opus). The API issues
  short-lived tokens *only* after checking the authenticated user, and derives
  room names and identities server-side — clients cannot choose privileged
  claims. TURN is not yet deployed (Milestone 1 exit requirement).
- **Web client** (`apps/web`): React + TypeScript + Vite + Tailwind,
  `livekit-client` for the room session. TanStack Query will own server state
  as the control plane grows; voice/session state lives in a small dedicated
  React context (`packages/ui` will host shared primitives later).

## Trust boundaries (current)

| Boundary | Crosses | Protection today |
| --- | --- | --- |
| Browser ↔ Caddy/API | credentials, session tokens, API calls | TLS in real deployments (dev: localhost HTTP), HttpOnly cookie policy planned for production auth; dev token is bearer, held in memory |
| Browser ↔ LiveKit | signaling (WS), media (WebRTC) | WSS + DTLS-SRTP transport encryption. **The SFU can access media. This is NOT E2EE.** |
| API ↔ PostgreSQL/Redis | all durable/ephemeral state | compose-internal network; least-privilege DB accounts before production |
| API ↔ LiveKit | shared API key/secret for token signing | secret via environment, never logged |

The full threat model skeleton lives in `docs/security/threat-model.md` and
must be completed before any E2EE claim (Milestone 3 gate).

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

## Realtime (planned, Milestone 2)

Presence via Redis (ephemeral, eventually consistent). Durable changes get a
monotonically ordered per-community event sequence with an outbox pattern so
reconnecting clients catch up without trusting missed WebSocket messages.

## Decisions

See `docs/adr/` — notably ADR-0001 (stack), ADR-0002 (Python in Docker,
npm workspaces), ADR-0003 (dev auth + encryption labeling).
