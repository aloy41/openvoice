# Local development

## One-command startup

```sh
cp .env.example .env   # then set the CHANGE_ME values (instructions inside)
docker compose -f docker-compose.dev.yml up --build
```

Services and ports:

| Service | Purpose | Host port |
| --- | --- | --- |
| caddy | front door (web + `/api/*`) | 8080 |
| web | Vite dev server (behind caddy) | — |
| api | FastAPI (behind caddy at `/api`) | — |
| livekit | SFU WebSocket + WebRTC | 7880 (ws), 7881/tcp, 50000–50100/udp |
| postgres | database | — (compose-internal) |
| redis | ephemeral state | — (compose-internal) |

The API container runs `alembic upgrade head` before starting; a fresh clone
reaches a working stack with no manual database steps.

## Everyday commands

```sh
# API tests (unit + integration against real postgres/redis)
docker compose -f docker-compose.dev.yml run --rm api pytest

# API lint / format / types
docker compose -f docker-compose.dev.yml run --rm api sh -c "ruff check . && ruff format --check . && mypy src"

# Create a migration after editing models
docker compose -f docker-compose.dev.yml run --rm api alembic revision --autogenerate -m "describe change"

# Web
npm install
npm run test -w apps/web
npm run lint -w apps/web
npm run typecheck -w apps/web
npm run build -w apps/web

# E2E (full stack must be up)
npm run test:e2e

# Regenerate the API contract + TS client after API changes (the export runs
# inside the container so line endings stay LF on all platforms)
docker compose -f docker-compose.dev.yml run --rm api sh -c "python -m openvoice_api.export_openapi > openapi.json"
npm run generate -w packages/api-client
```

## Troubleshooting

- **`readyz` returns 503** — check `docker compose ... ps`; postgres or redis
  is unhealthy. The response body names the failing dependency.
- **API exits immediately at startup** — configuration validation failed; the
  error message names the exact setting. Common causes: missing/short
  `OPENVOICE_SECRET_KEY`, dev auth enabled with `production` environment,
  missing `OPENVOICE_DEV_AUTH_PASSWORD`.
- **Voice join fails but login works** — check the browser can reach
  `ws://localhost:7880` and that UDP 50000–50100 isn't blocked by a local
  firewall. There is no TURN fallback yet.
- **Microphone errors** — the client distinguishes permission-denied,
  no-device, and device-in-use states; on Windows check the OS microphone
  privacy settings.
- **Port conflicts** — 8080/7880/7881/50000–50100 must be free.

## Windows notes

Dev stack is developed and tested with Docker Desktop. File-watching for the
Vite dev server inside Docker uses polling (enabled in compose) — expect
slightly higher CPU during `up`.
