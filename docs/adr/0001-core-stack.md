# ADR-0001: Core technology stack

- Status: accepted
- Date: 2026-07-18

## Context

The master build prompt mandates boring, maintainable technology, mature
media/crypto standards, and a self-hostable single-host reference deployment.

## Decision

- **API**: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async, asyncpg),
  Alembic, PostgreSQL 16, Redis 7. Ruff (lint+format) and mypy strict.
- **Media**: self-hosted LiveKit SFU (WebRTC, Opus). No custom transport.
  Tokens minted server-side with the official `livekit-api` Python package.
- **Web**: React 19, TypeScript strict, Vite, Tailwind CSS v4,
  `livekit-client`. Vitest + React Testing Library; Playwright for E2E.
  TanStack Query will be introduced with the first real server-state surface
  (Milestone 2); the current slice has one fetch flow and does not need it yet.
- **API contract**: OpenAPI exported from FastAPI is authoritative;
  `packages/api-client` holds types generated with `openapi-typescript` and a
  typed `openapi-fetch` client. CI fails on drift.
- **Reverse proxy**: Caddy (automatic TLS in production guidance, trivial
  WebSocket support).
- **Identifiers**: UUIDv7 via the `uuid6` library (Python) until stdlib
  support lands. Sortable, standard, no custom scheme.

## Consequences

- Exact versions are pinned by lockfiles (`package-lock.json`, pinned Python
  requirements); significant upgrades are documented, not chased mid-feature.
- Kubernetes is explicitly out of scope for the reference deployment.
- Alternatives considered: Node/NestJS backend (rejected: prompt specifies
  FastAPI), mediasoup/Janus (rejected: LiveKit has maintained E2EE support,
  SDKs, and self-hosting docs matching the roadmap).
