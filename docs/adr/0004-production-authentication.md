# ADR-0004: Production authentication (first Milestone 2 slice)

- Status: accepted
- Date: 2026-07-18

## Context

Milestone 2 replaces the dev-only login (ADR-0003) with real accounts. The
master prompt requires Argon2id, HttpOnly cookies with CSRF protection,
rate limiting, no account-existence leaks, and per-device session
viewing/revocation.

## Decision

### Accounts

- Username + password only; no email address yet. Account recovery flows
  (and their enumeration-resistance requirements) arrive with a later slice —
  until then, a lost password means a lost account, which the UI must state.
- Argon2id via `argon2-cffi` with library-default parameters. Reviewing the
  parameters for the deployment class is a tracked pre-MVP task.
- Dev-login accounts (`is_dev_user`, `password_hash IS NULL`) can never
  authenticate through the password endpoints.

### Sessions

- Opaque 256-bit secrets in an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` in production; overridable via `OPENVOICE_COOKIE_SECURE`).
- The server stores only a SHA-256 digest (`sessions.token_hash`), so a
  database disclosure cannot mint usable sessions.
- 30-day absolute expiry (`OPENVOICE_SESSION_MAX_AGE_SECONDS`),
  `last_seen_at` maintained per request; revocation is immediate and
  checked on every request (no server-side session cache yet).
- `GET /auth/sessions` lists active sessions (created, last seen, coarse
  user agent — never IP addresses); `DELETE /auth/sessions/{id}` revokes.
- Rotating refresh tokens are not needed for this cookie model; they will be
  introduced with the desktop client's token flow, where reuse detection
  applies (master prompt requirement recorded here so it is not lost).

### CSRF

Double-submit cookie: middleware issues a non-HttpOnly `ov_csrf` cookie to
every browser; state-changing requests must echo it in `x-csrf-token`.
Login and register also require it (login-CSRF). Bearer-token requests are
exempt — they carry no ambient cookie authority.

### Abuse protection

Redis fixed-window limiting on register/login keyed by client address +
username (`OPENVOICE_AUTH_RATE_LIMIT_*`, operator-tunable, never a paid
feature). The limiter fails open with a logged warning if Redis is down —
Redis is disposable by design and must not take sign-in down with it.

### Transition

`/api/v1/dev/voice-token` accepts cookie sessions and (while enabled) dev
bearer tokens via a shared `authenticate` dependency. The web client moves
to cookie auth next; dev auth then becomes a compose-profile convenience
and is eventually removed.

## Consequences

- Anonymous-endpoint CSRF means the SPA must make one request (anything,
  e.g. `/api/healthz`) before login so the CSRF cookie exists.
- Session validation is one DB roundtrip per request; acceptable now,
  revisit with a Redis validation cache when profiling says so.
- No password strength estimation beyond length (10–128); consider zxcvbn
  client-side later without making it a server gate.
