# ADR-0002: Development environment — API in Docker, npm workspaces

- Status: accepted
- Date: 2026-07-18

## Context

The API requires Python ≥ 3.12. Contributor machines (including the machine
this repo was initialized on) may only have older interpreters. The web
toolchain needs a workspace-aware package manager; pnpm is not guaranteed to
be installed.

## Decision

1. **The API runs and is tested inside a `python:3.12-slim` container** in
   both development and CI. `docker compose -f docker-compose.dev.yml run
   --rm api pytest` is the canonical test entry point. A host virtualenv is
   optional and unsupported below 3.12.
2. **npm workspaces** (npm ≥ 10 ships with Node 22) manage the JS monorepo:
   `apps/web` and `packages/api-client`. No pnpm/yarn requirement.
3. `docker-compose.dev.yml` is the one-command dev environment: PostgreSQL,
   Redis, LiveKit, Caddy, API (with auto-migration on start), and the Vite
   dev server. Production reference compose hardening is Milestone 4 work.

## Consequences

- Uniform Python version everywhere; no "works on my interpreter" drift.
- Slightly slower API iteration than a host venv; acceptable at this stage,
  and contributors with Python 3.12+ may still use a venv locally.
- Dev-only placeholder credentials (LiveKit devkey, compose-internal
  passwords) live in `.env.example`/compose with conspicuous CHANGE_ME
  values and are excluded from secret-scanning noise via `.gitleaks.toml`
  with narrow, documented allowlist rules.
