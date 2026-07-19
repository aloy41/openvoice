# ADR-0007: Per-device identity keys

- Status: accepted
- Date: 2026-07-19

## Context

"Per-device identity with the ability to revoke a device" is a required MVP
feature (master prompt). It is also the foundation MLS needs: MLS group
membership is keyed by per-device credentials, so devices must have stable
public keys before automatic group keying can replace the manual passphrase
(ADR-0006). Full MLS integration is a large, dedicated effort (a maintained
WASM MLS library, key-package distribution, media-key wiring); this ADR
delivers the device layer it depends on without inventing cryptography or
faking the parts that are not yet built.

## Decision

- Each browser generates an **ECDSA P-256** keypair via Web Crypto — a
  boring, universally supported choice. The **private key is
  non-extractable** and stored in IndexedDB; it can sign but can never be
  read out of the browser, and it is never transmitted. Only the
  SPKI-encoded **public key** is sent to the server.
- `devices` table (migration 0006): user, public key, key type, coarse name,
  timestamps, soft revocation. Unique on (user, public key). Private keys are
  never stored server-side.
- Endpoints: `POST /devices` (idempotent per key; a revoked key is refused —
  a returning revoked key is suspicious, so the client must mint a new one),
  `GET /devices` (active devices for the caller), `DELETE /devices/{id}`
  (soft revoke; CSRF-protected; scoped to the caller's own devices).
- The web client registers its device on sign-in and session restore
  (best-effort — a failure never blocks sign-in, since device identity is not
  yet load-bearing). A "Devices" dialog lists devices, marks the current one,
  and revokes.
- Key type is recorded (`ecdsa-p256`) so a future migration to another
  credential format is possible without a data ambiguity.

## Honest limitations (documented in the threat model)

- Browser storage (IndexedDB) can be cleared by the user or the browser,
  which loses the device key; the user simply registers a new device. Desktop
  builds will use OS secure storage instead.
- These keys are **not yet used to encrypt or authenticate anything** — they
  are identity/foundation only. Voice and text E2EE still use the ADR-0006
  passphrase until MLS lands. This is stated plainly; the UI makes no claim
  the device key protects content today.

## Path to MLS (remaining M3)

Device public keys become the basis for MLS `key_packages`; adding a member's
device to a group and rotating the epoch on membership change is what removes
the passphrase's manual-rotation limitation. That integration — library
selection, key-package publication, and rekeying LiveKit's media E2EE from
MLS exporter secrets — is the next major milestone and is deliberately not
rushed here.

## Consequences

- A real, testable device layer exists now (registration carries only a
  public key — asserted by an e2e test — and the key persists across reloads).
- No security claim is made that device identity does not yet earn.
