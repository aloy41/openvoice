# Rules for coding agents working in this repository

Read this file, the README, and the relevant ADRs in `docs/adr/` before editing.

## Project intent

Self-hostable, open-source voice/community platform. Security honesty is a hard
requirement: **never label anything end-to-end encrypted unless the control
plane, SFU, database, and operator provably cannot decrypt it.** The current
milestone is transport-encrypted only and the UI must say so.

## Hard rules

1. Do not invent cryptography, media transports, codecs, or wire protocols.
   Use WebRTC, Opus, LiveKit's maintained SDKs, Web Crypto, and (later) an
   audited MLS implementation.
2. Never weaken authorization, validation, tests, or production defaults to
   make a demo pass. Development bypasses must be impossible to enable in
   production (see `Settings` validation in `apps/api`).
3. Never commit secrets. Dev-only placeholder credentials live only in
   `docker-compose.dev.yml` / `.env.example` and must be conspicuously fake.
4. All schema changes go through Alembic migrations. All API contract changes
   require regenerating `apps/api/openapi.json` and `packages/api-client`
   (CI enforces drift).
5. Every behavior change ships with tests at the appropriate layer.
   Database integration tests run against real PostgreSQL, never SQLite.
6. Do not push, publish, deploy, or perform destructive repo operations
   without explicit authorization from the project owner.
7. Record non-obvious decisions as ADRs in `docs/adr/`. Update the threat
   model when trust boundaries move.
8. Timestamps are UTC and timezone-aware. Identifiers are UUIDv7.
9. Logs and metrics never contain message bodies, tokens, keys, invite
   secrets, SDP, ICE credentials, or passwords.

## Development workflow

- Full stack: `docker compose -f docker-compose.dev.yml up --build`
- API tests: `docker compose -f docker-compose.dev.yml run --rm api pytest`
- API lint/type: `docker compose -f docker-compose.dev.yml run --rm api sh -c "ruff check . && ruff format --check . && mypy src"`
- Web: `npm run test -w apps/web`, `npm run typecheck -w apps/web`,
  `npm run lint -w apps/web`, `npm run build -w apps/web`
- E2E: `npm run test:e2e` (needs the full stack up; includes the axe
  accessibility scan). Gated extras: `RUN_CHAOS=1` (SFU-restart recovery,
  controls Docker) and `SOAK_MINUTES=N` (4-client stability soak). Do not run
  other e2e specs while a soak is running — they share the dev-lobby room and
  will break its participant-count assertions.

The API runs in Docker on Python 3.12 (host Python may be older — do not
develop against a host interpreter below 3.12; see ADR-0002).

## Current milestone state

Milestone 0 + first Milestone 1 slice complete: dev login → LiveKit token →
two-client voice room with device selection, mute, deafen, speaking
indicators, reconnect states. Next highest-value work is tracked in the
README's known-limitations list and the milestone plan in the master build
prompt (TURN validation, then Milestone 2 control plane).
