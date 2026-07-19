# ADR-0003: Development-only authentication and honest encryption labeling

- Status: accepted
- Date: 2026-07-18

## Context

Milestone 1 needs an authenticated path to LiveKit tokens before production
authentication (Milestone 2) exists. The master prompt forbids development
bypasses that can leak into production, and forbids calling transport
encryption "end-to-end encryption".

## Decision

### Development authentication

- A dev-only login: any username + a shared development password
  (`OPENVOICE_DEV_AUTH_PASSWORD`, min 12 chars), enabled only by
  `OPENVOICE_DEV_AUTH_ENABLED=true`.
- **Startup validation refuses the combination `environment=production` +
  `dev_auth_enabled=true`** — the process exits with an actionable error.
  This rule has unit tests and must never be removed.
- Successful login upserts a real `users` row (marked `is_dev_user`) and
  returns a signed, time-limited token (itsdangerous, HMAC over the app
  secret, 12 h max age). The browser keeps it in memory only — deliberately
  not localStorage — so it dies with the tab. Production auth (Milestone 2)
  will use HttpOnly cookies + CSRF protection instead, per the master prompt.
- Passwords are compared with `secrets.compare_digest`. No rate limiting yet;
  documented as a known dev-only limitation.

### LiveKit token scoping

- The API signs tokens with the official `livekit-api` package only.
- Identity is derived server-side (`user-<uuid>`); the room is fixed by
  server configuration (`dev-lobby`). Client-supplied room/identity values
  are ignored.
- Grants: `room_join`, `can_publish` (audio), `can_subscribe` only. No admin,
  no room creation, no data publish. TTL 5 minutes. Tests decode issued
  tokens and assert exactly these grants.

### Encryption labeling

- Code, docs, and UI label the current state **"Transport encryption only
  (not end-to-end encrypted)"**. The client renders this state permanently in
  the voice UI. There is no code path, flag, or copy that claims E2EE.
- E2EE work lands in Milestone 3 behind the threat model and a reviewed
  key-management ADR; only then may labeling change, and only to reflect
  verified behavior.

## Consequences

- The dev login is useless against production configs by construction.
- Milestone 2 replaces this flow; the `users` table carries over.
- Anyone auditing the repo can grep for "end-to-end" and find only honest
  statements.
