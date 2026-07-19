# ADR-0008: Device-bound sessions (proof of possession)

- Status: accepted
- Date: 2026-07-19

## Context

ADR-0007 gave each browser an ECDSA P-256 device key, but registration
accepted a public key with **no proof the client held the matching private
key** — anyone with a session could register any public key, and sessions had
no relationship to a device. That makes "per-device revocation" cosmetic: a
device entry could be forged, and revoking it did nothing to any session. It is
also an unsound base for MLS, which trusts device credentials.

## Decision

Bind sessions to devices using a standard signature challenge — **no custom
cryptography**; server-side verification uses pyca/cryptography, client signing
uses Web Crypto.

1. **Challenge.** `POST /devices/challenge` returns a random nonce wrapped in a
   short-lived, HMAC-signed token (itsdangerous, `device_challenge_ttl_seconds`
   = 300s). The challenge is stateless — no server-side nonce store — because
   the token carries its own integrity and expiry.
2. **Proof of possession on registration.** `POST /devices` now requires the
   challenge token plus a signature over its nonce. The server verifies the
   token (integrity + freshness), then verifies the ECDSA P-256 / SHA-256
   signature against the submitted SPKI public key before writing anything. A
   key cannot be registered by someone who does not hold its private key.
3. **Session binding.** `POST /devices/{id}/bind-session` requires a *fresh*
   proof and sets `sessions.device_id`. A stolen cookie alone cannot claim a
   device it cannot sign for.
4. **Revocation cascades.** Revoking a device revokes every session bound to it
   (sets `revoked_at`), so a lost/compromised device cannot keep a live
   session. The FK is `ON DELETE SET NULL` so removing a device never destroys
   the session audit trail.

### Wire formats (server and client must agree)

- Public key: base64 of the SPKI DER (`crypto.subtle.exportKey("spki")`).
- Signature: base64 of the raw IEEE-P1363 `r||s` pair (Web Crypto output),
  converted to DER server-side for verification.

These live in `apps/api/src/openvoice_api/device_crypto.py` and
`apps/web/src/crypto/device.ts`; the API tests reproduce the browser formats
exactly so the verification path is exercised end-to-end.

## Scope and honesty

- This hardens **session/device authentication**. It is **not** end-to-end
  encryption and does not change any E2EE labeling. Content protection is the
  separate group-key work (ADR-0009).
- Binding is best-effort in the client: a failure never blocks sign-in, because
  device binding is a hardening layer, not a login requirement. Sessions that
  predate binding, or dev-bearer sessions, simply have no `device_id`.
- Continuous per-request signing is intentionally **out of scope** — the
  property delivered is "a session can be cryptographically tied to a device,
  and revoking the device kills the session," not "every request is signed."
- No independent security review has been performed (see `SECURITY.md`).

## Consequences

- Device identity is now trustworthy enough to build MLS credentials on.
- Registration requires a round-trip for the challenge; negligible cost.
- `cryptography` is a new API dependency (pinned in `constraints.txt`) — a
  standard, widely-used library, used only for signature verification.
