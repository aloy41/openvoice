# Verification log

Recorded evidence for quality-gate runs, per the project rule that every
benchmark ships with its test conditions and hardware. Append new entries;
never edit history.

## 2026-07-18 — Milestone 0 + first Milestone 1 slice

**Hardware/OS:** AMD Ryzen 9 7900X (12c), 95 GB RAM, Windows 11 Home,
Docker Desktop (Engine 29.1.3, Compose v2.40.3). All services on one host;
network is loopback — these numbers do not represent WAN conditions.

**Stack:** LiveKit v1.9.11, PostgreSQL 16-alpine, Redis 7-alpine,
Caddy 2-alpine, API on python:3.12-slim, Chromium 149 headless with fake
media devices.

| Check | Result |
| --- | --- |
| API: ruff lint + format, mypy --strict | clean |
| API: pytest (real PostgreSQL/Redis, alembic migration path) | 23/23 passed |
| Web: eslint, tsc --noEmit, vite production build | clean |
| Web: vitest component tests | 14/14 passed |
| Contract: openapi.json + generated TS client in sync | verified |
| Two-client e2e voice smoke (sign-in → join → mutual visibility → mute propagation → deafen → leave) | passed |
| Accessibility: axe WCAG 2.1 A/AA on login, pre-join, in-call | 0 violations (after darkening two button colors) |
| Reconnect chaos: `docker restart` of the SFU mid-call | drop surfaced as reconnecting/disconnected; usable call again < 30 s |
| 4-client soak (`SOAK_MINUTES=8`), liveness + participant-count check every 15 s | passed — 4 clients stable for the full 8 minutes, zero dropped checks |
| Secret scan (gitleaks, working tree) | only the gitignored local `.env` flagged (expected) |
| Dependency audits: npm audit (high), pip-audit | 0 known vulnerabilities (after pip ≥ 26.1 and pytest ≥ 9.0.3 upgrades) |
| Workflow lint (actionlint + shellcheck) | clean |

### Follow-up (same day): user-reported audio feedback bug

User report: no mic level feedback during the mic test, no way to hear
themselves, and no output-device test. Root cause found via in-browser
diagnostics: an unstable `onPermissionGranted` prop identity caused the
mic-test restart effect to loop, killing each capture after its first
(always-silent) analyser frame — the meter never left 0. Fixed by passing a
stable callback and guarding restarts on the actually-captured device id.
Also added: "Hear myself" mic monitoring routed to the selected output (with
echo warning), a "Play test sound" chime for the output device,
`AudioContext.resume()` guards (suspended contexts read pure silence), and
the selected output device is now applied to call audio at join time.
New regression e2e (`audio-check.spec.ts`) drives the real meter with a
440 Hz fake-capture tone and fails if the level stays 0 or the test
self-stops; both tests pass.

**Not yet verified** (open Milestone 1 exit items):

- Full one-hour 4-client soak (run `SOAK_MINUTES=60 npx playwright test soak`
  on reference hardware; the spec exists and passed at shorter durations).
- TURN / restrictive-network fallback — no TURN server deployed yet.
- Network impairment (latency/loss/jitter via netem) — needs a Linux test
  environment.
- CI pipeline has not executed on GitHub (nothing pushed yet); it is linted
  but unproven remotely.
