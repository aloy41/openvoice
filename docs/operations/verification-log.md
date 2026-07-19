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

Second root cause, caught by the new "Capturing:" diagnostic on the user's
machine: a bare `deviceId` constraint is only a preference, and Chrome
substituted a vendor virtual device ("NGENUITY - HyperX Virtual Audio
Device", which is silent) for the selected physical mic. Fixed by using
exact device constraints everywhere (mic test with stale-id fallback,
in-call `switchActiveDevice(..., exact=true)`, and join-time
`audioCaptureDefaults`), plus a single AudioContext reused across device
switches (contexts recreated outside a user gesture can be stuck
suspended). **Confirmed fixed by the user on real hardware: meter moves and
self-monitoring is audible.**

### Media-path and TURN validation (same day, second session)

- **SFU media transit proven** (`media-flow.spec.ts`, runs in every e2e
  pass): client A publishes a 440 Hz tone; client B's UI must mark A as
  speaking (server-side voice-activity detection ⇒ A→SFU audio) and the
  remote stream at B must carry measurable energy (⇒ SFU→B audio). Passed
  repeatedly. Signaling success alone is now never mistaken for media flow.
- **TURN relay validated** (`relay.spec.ts`, gated `RUN_RELAY=1`): embedded
  LiveKit TURN/UDP (3478, relay range 30000–30100 published) with the node
  advertising the machine's LAN IP; both clients forced to relay-only ICE
  (`?forceRelay=1` ⇒ `iceTransportPolicy: relay`) completed a call with the
  same media proofs. Diagnostics confirmed a `typ relay` candidate and ICE
  `connected`. Two findings recorded for future operators: Chromium ignores
  loopback TURN servers (dev harness passes
  `--allow-loopback-in-peer-connection`), and ICE cannot complete through a
  relay advertised as 127.0.0.1 — hence `LIVEKIT_NODE_IP` must be a real
  interface IP for relay validation.

### Production authentication slice (same day, ADR-0004)

12 new API tests, all passing against real PostgreSQL/Redis: Argon2id hash
storage verified in the database, HttpOnly/SameSite cookie flags asserted,
CSRF enforcement on every state-changing and anonymous auth endpoint,
unknown-user vs wrong-password indistinguishability, dev-account password
login refusal, cross-device session listing and immediate revocation,
Redis rate limiting (429 after the configured attempts), and voice-token
issuance via cookie auth with CSRF. Migration 0002 exercised by the test
session. Full API gate: 35/35 tests, ruff + mypy strict clean.

### Milestone 1 exit: one-hour 4-client soak — PASSED

`SOAK_MINUTES=60 npx playwright test soak` on the hardware above:
4 fake-media Chromium clients held one continuous call for 60 minutes —
240/240 liveness + all-see-all participant-count checks at 15 s intervals,
zero reconnects or drops. (Same-host loopback conditions; a WAN-conditions
soak belongs to the M4 network-impairment work.)

Operational note recorded: the API dev server hot-reloads code but only
applies migrations at container start — after pulling schema changes, run
`docker compose -f docker-compose.dev.yml up -d --force-recreate api`.

### Community domain + permission engine (ADR-0005, same day)

34 new API tests (72 total, all green against real PostgreSQL/Redis):

- 14 table-driven permission-precedence cases — the executable contract for
  the ADR-0005 algorithm (deny-by-default, role unions, owner/admin
  bypass, everyone→role→member override precedence, deny-before-allow).
- Community lifecycle with provisioned defaults (@everyone role, starter
  category/text/voice channels), owner-only deletion (administrators
  refused), audit trail verified end-to-end.
- IDOR posture: non-members receive 404 for every community-scoped route.
- Invites: hashed codes, body-based redemption (secrets never in URLs),
  idempotent re-join, max-uses, expiry, ban-blocking, capability-gated
  creation, per-account redemption rate limiting.
- Moderation: kick/ban/unban flows, immediate access loss, rejoin
  semantics, owner/self-protection, audit access control.
- Authorized voice-channel tokens: server-derived per-channel rooms,
  CONNECT_VOICE gating, SPEAK→canPublish mapping, member-specific override
  precedence over role denies, kicked members refused instantly.

Migration 0003 exercised by the test session and applied to the dev
database. Web e2e suite unaffected (7/7). The community UI is the next
slice; until then these endpoints are API-only.

**Not yet verified** (open Milestone 1 exit items):
- TURN over **TLS** for the most restrictive networks — requires a domain and
  real certificate; part of the hardened production deployment (M4).
- Network impairment (latency/loss/jitter via netem) — needs a Linux test
  environment.
- CI pipeline has not executed on GitHub (nothing pushed yet); it is linted
  but unproven remotely.
