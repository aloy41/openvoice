# Production deployment

A hardened, single-host deployment of Openvoice with automatic TLS, scheduled
backups, and operational monitoring. For local development use
`docker-compose.dev.yml` instead (see `local-development.md`).

> **Security status.** This project has not had an independent security audit
> (see `SECURITY.md`). This guide makes the deployment *operationally* sound —
> it does not substitute for a review before hosting sensitive communities.

## What the production stack changes vs. dev

| Concern | Dev (`docker-compose.dev.yml`) | Prod (`docker-compose.prod.yml`) |
| --- | --- | --- |
| Images | source bind-mounted, live reload | built images, no host mounts |
| Auth | dev shared-password login on | `OPENVOICE_ENVIRONMENT=production` (dev login refused at startup) |
| TLS | Caddy internal CA | Let's Encrypt on a real domain |
| Postgres / Redis ports | published to host | private network only |
| Process | single uvicorn `--reload` | multi-worker uvicorn under tini, non-root |
| Hardening | none | `no-new-privileges`, `restart: unless-stopped`, memory limits |
| Backups | none | scheduled `pg_dump` with retention |
| Monitoring | none | `/api/metrics`, container healthchecks |

## Prerequisites

- A Linux host with Docker (Compose v2) and a public IP.
- A domain whose A/AAAA record points at the host.
- Ports **80** and **443** open to the internet (ACME challenge + HTTPS), plus
  the LiveKit media ports (**7881/tcp**, **3478/udp**, **50000-50100/udp**).

## Configure

```sh
cp .env.prod.example .env.prod
# Fill in EVERY value. Generate secrets with:
#   python -c "import secrets; print(secrets.token_hex(32))"
```

Required: `OPENVOICE_DOMAIN`, `OPENVOICE_ACME_EMAIL`, `OPENVOICE_SECRET_KEY`
(≥32 chars), `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
(≥32 chars), and `LIVEKIT_NODE_IP` set to the host's **public** IP.

## Deploy

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The `api` container runs `alembic upgrade head` before serving, so migrations
apply automatically on every deploy. Watch startup:

```sh
docker compose -f docker-compose.prod.yml logs -f api caddy
```

Verify:

```sh
curl -fsS https://$OPENVOICE_DOMAIN/api/healthz     # {"status":"ok"}
curl -fsS https://$OPENVOICE_DOMAIN/api/readyz       # postgres+redis ok
```

## Monitoring

- **Liveness / readiness.** `/api/healthz` (process up) and `/api/readyz`
  (Postgres + Redis reachable; returns 503 and names the failing dependency
  when degraded). Point an external uptime monitor at `/api/readyz`.
- **Metrics.** `/api/metrics` exposes Prometheus text-format counters
  (`openvoice_up`, `openvoice_uptime_seconds`, `openvoice_requests_total` by
  method/status class, request-duration totals). It is **blocked at the public
  edge** by Caddy — scrape it from inside the private network at
  `http://api:8000/api/metrics` (e.g. a Prometheus sidecar on the compose
  network). It contains only aggregate counters — no content or identifiers.
- **Container health.** Every service defines a Docker healthcheck; watch with
  `docker compose -f docker-compose.prod.yml ps` (STATUS shows healthy/
  unhealthy) or wire it to your host monitoring.
- **Logs.** The API emits structured JSON logs (request id, method, path,
  status, duration) to stdout — ship them with your Docker logging driver. They
  never contain tokens, passwords, key material, or message content.

## Backups

The `db-backup` service runs `pg_dump` every `BACKUP_INTERVAL_SECONDS`
(default daily), writing gzipped dumps to the `backups` volume and pruning
those older than `BACKUP_KEEP_DAYS` (default 14).

```sh
# List dumps
docker compose -f docker-compose.prod.yml exec db-backup ls -1 /backups
# Force a backup right now
docker compose -f docker-compose.prod.yml exec -e RUN_ONCE=1 db-backup \
  sh /usr/local/bin/backup.sh
# Copy a dump off-host (do this regularly — a volume on the same host is not
# disaster recovery)
docker compose -f docker-compose.prod.yml cp \
  db-backup:/backups/openvoice-YYYYMMDDTHHMMSSZ.sql.gz ./
```

### Restore (tested round-trip)

The dumps are created with `--clean --if-exists`, so a restore drops and
recreates objects. Stop the API first for a clean restore:

```sh
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec \
  -e DUMP=openvoice-YYYYMMDDTHHMMSSZ.sql.gz db-backup \
  sh /usr/local/bin/restore.sh
docker compose -f docker-compose.prod.yml start api   # re-runs migrations
```

The backup and restore scripts were verified end-to-end against a populated
database (schema + row counts identical after a dump → restore into a fresh
database round-trip). See `docs/operations/verification-log.md`.

## Upgrade & rollback

**Upgrade:**

```sh
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

New images build, `api` runs migrations, then Compose recreates containers.
Data lives in named volumes (`postgres-data`, `redis-data`, `caddy-data`) and
survives recreation.

**Roll back:** always take a backup immediately before an upgrade
(`RUN_ONCE=1` above). To roll back:

```sh
git checkout <previous-tag>
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

If a migration in the newer version changed the schema incompatibly, restore
the pre-upgrade dump (see Restore) after checking out the previous version, so
the schema matches that version's expectations. Test upgrades on a staging copy
first when a release includes migrations.

## Known limitations

- **TURN over TLS** is not configured; TURN is UDP/TCP only. The most
  restrictive corporate networks that block non-TLS UDP may fail to establish
  media (tracked in the threat model).
- Single-host deployment: no built-in horizontal scaling or HA. The stateless
  API can be scaled behind a load balancer, but Redis/Postgres/LiveKit HA is
  out of scope here.
