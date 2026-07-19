# Openvoice (working name)

An open-source, self-hostable voice and community platform. Communities with text
and voice channels, reliable low-latency group voice, and — in later milestones —
end-to-end encrypted voice and private text. No ads, no payments, no feature gates,
no mandatory hosted services.

> **Project status: Milestone 0/1 — voice technology spike.**
> This repository currently contains the development foundation and the first
> vertical slice: a development-only login and a voice room that two or more
> browser clients can join through a self-hosted LiveKit SFU.
> **It is not yet suitable for real communities or sensitive communication.**

## Security status — read this first

**Voice in this milestone is NOT end-to-end encrypted.**

Media between each client and the LiveKit SFU is protected by WebRTC transport
encryption (DTLS-SRTP). That protects against passive network observers, but the
SFU — and therefore whoever operates this server — can access the media it routes.
Application-level E2EE (where the SFU and control plane cannot decrypt media) is
planned for Milestone 3 using LiveKit's maintained E2EE support and audited key
management. Until that ships and is verified, no part of this project's UI or
documentation labels sessions "end-to-end encrypted", and the client explicitly
shows the current state as "Transport encryption only".

See [`docs/security/threat-model.md`](docs/security/threat-model.md) for the
threat model skeleton and current trust boundaries.

## Repository layout

```
apps/api/          FastAPI control plane (Python 3.12, SQLAlchemy 2, Alembic)
apps/web/          React + TypeScript + Vite browser client
packages/api-client/  TypeScript API types generated from the OpenAPI contract
infra/livekit/     LiveKit SFU development configuration
infra/caddy/       Reverse proxy development configuration
docs/              Architecture, ADRs, security, operations
tests/e2e/         Playwright end-to-end tests
```

## Prerequisites

- Docker with Docker Compose v2 (Docker Desktop on Windows/macOS is fine)
- Node.js 22+ and npm 11+ (for running web tests and generating the API client
  on the host; the dev servers themselves run in Docker)
- Git

Local Python is **not** required: the API runs and is tested inside a
Python 3.12 container.

## Quick start (development)

1. Copy the example environment file and generate secrets:

   ```sh
   cp .env.example .env
   # then follow the instructions inside .env.example to set secrets
   ```

2. Start the full development stack:

   ```sh
   docker compose -f docker-compose.dev.yml up --build
   ```

   This starts PostgreSQL, Redis, LiveKit, the API (with automatic database
   migrations), the web dev server, and Caddy as the front door.

3. Open **http://localhost:8080**.

4. Sign in with any username and the development password you set in `.env`
   (`OPENVOICE_DEV_AUTH_PASSWORD`). Pick a microphone, run the mic test, and
   join the development voice room. Open a second browser window (or a private
   window) and join with a different username to talk to yourself.

### Verifying the installation

- API liveness:   `curl http://localhost:8080/api/healthz` → `{"status":"ok"}`
- API readiness:  `curl http://localhost:8080/api/readyz` → checks PostgreSQL and Redis
- LiveKit:        `curl http://localhost:7880` → `OK`

### Teardown

```sh
docker compose -f docker-compose.dev.yml down        # keep data
docker compose -f docker-compose.dev.yml down -v     # delete database volumes
```

## Running the tests

```sh
# API unit + integration tests (integration tests require the compose stack's
# postgres and redis to be up)
docker compose -f docker-compose.dev.yml up -d postgres redis
docker compose -f docker-compose.dev.yml run --rm api pytest

# Web unit/component tests, typecheck, lint, build
npm install
npm run test -w apps/web
npm run typecheck -w apps/web
npm run lint -w apps/web
npm run build -w apps/web

# End-to-end tests (require the full dev stack up)
npm run test:e2e                                   # two-client voice smoke + axe accessibility
$env:RUN_CHAOS="1"; npx playwright test reconnect-chaos   # SFU-restart recovery (controls Docker)
$env:SOAK_MINUTES="60"; npx playwright test soak          # 4-client stability soak
```

Verified results for each gate are recorded in
[`docs/operations/verification-log.md`](docs/operations/verification-log.md).

## Regenerating the API client

The TypeScript API types in `packages/api-client` are generated from the
backend's OpenAPI schema and committed. After changing API contracts:

```sh
# run the export inside the container so the file is written LF/no-BOM on
# every platform (the schema lands in apps/api/openapi.json via the bind mount)
docker compose -f docker-compose.dev.yml run --rm api sh -c "python -m openvoice_api.export_openapi > openapi.json"
npm run generate -w packages/api-client
```

CI fails if the committed schema or generated client drifts from the code.

## Known limitations (current milestone)

- **No E2EE yet** — see the security status above.
- Development authentication only: a shared development password behind
  `OPENVOICE_DEV_AUTH_ENABLED`, which the API **refuses to start with** in
  production mode. There are no real accounts, sessions, or devices yet.
- One fixed development voice room; no communities, channels, roles,
  permissions, invites, or text messaging yet.
- No rate limiting on the development login endpoint (it is dev-only and must
  never be exposed publicly).
- No TURN server yet; clients on networks that block UDP to the SFU may fail
  to connect. TURN is part of the Milestone 1 exit criteria and will be added
  before that milestone closes.
- Windows/macOS Docker Desktop note: LiveKit's UDP port range is published
  through the Docker NAT; for development on `localhost` this is fine, but do
  not treat this compose file as a production deployment.

## License

Intended license: **AGPL-3.0-or-later** for project-owned code, so the product
remains open when offered over a network. This is recorded as a project
preference pending explicit confirmation by the project owner before the first
public release — see `LICENSE`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md) (rules for
coding agents), and [`SECURITY.md`](SECURITY.md) (vulnerability reporting).
