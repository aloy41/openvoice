# Contributing

Thanks for your interest. This project is in early private development
(Milestone 0/1); processes will firm up before the first public release.

## Ground rules

- Read `AGENTS.md` — its hard rules (security honesty, no custom crypto, no
  committed secrets, migrations for schema changes, tests with every behavior
  change) apply to human contributors too.
- Small vertical slices. Every PR should leave the application runnable.
- Security claims must be technically accurate. Never describe transport
  encryption as end-to-end encryption.
- Prefer maintained libraries and boring technology over novelty.

## Development setup

See the README quick start. In short: copy `.env.example` to `.env`, set
secrets, and run `docker compose -f docker-compose.dev.yml up --build`.

## Code quality gates (run before opening a PR)

| Area | Command |
| --- | --- |
| API lint/format | `docker compose -f docker-compose.dev.yml run --rm api sh -c "ruff check . && ruff format --check ."` |
| API types | `docker compose -f docker-compose.dev.yml run --rm api mypy src` |
| API tests | `docker compose -f docker-compose.dev.yml run --rm api pytest` |
| Web lint | `npm run lint -w apps/web` |
| Web types | `npm run typecheck -w apps/web` |
| Web tests | `npm run test -w apps/web` |
| Contract drift | regenerate `apps/api/openapi.json` + `packages/api-client` and check `git diff` is clean |

CI runs all of the above plus secret scanning and dependency audits.

## Commits and PRs

- Describe what changed, what was verified (paste test results), and any
  remaining risk.
- Contract changes: commit the regenerated OpenAPI schema and client together
  with the server change.
- Schema changes: include the Alembic migration and note rollback behavior.
- Decisions with lasting consequences get an ADR in `docs/adr/`.

## Reporting security issues

Do **not** open public issues for vulnerabilities — see `SECURITY.md`.
