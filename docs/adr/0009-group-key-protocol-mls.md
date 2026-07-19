# ADR-0009: Group-key protocol for default-on E2EE (MLS)

- Status: **proposed — design only, not implemented**
- Date: 2026-07-19

## Context

Today E2EE is opt-in and keyed by a **manually shared passphrase** (ADR-0006
for voice; AES-GCM message envelopes for text). That has real limits: no key
rotation when membership changes (a removed member who kept the passphrase can
still decrypt future traffic if they rejoin the media/ciphertext stream), keys
are shared out-of-band, and there is no per-device identity in the key
agreement. Replacing the passphrase with an automatic **group-key protocol** is
what "default-on E2EE" requires.

The obvious standard is **MLS (RFC 9420)**: continuous group key agreement with
forward secrecy and post-compromise security, epoch rotation on every add/
remove, and per-device leaf credentials — which is exactly what ADR-0007/0008
device keys are for.

## Why this ADR ships as design-only

Implementing a group-key protocol correctly is a security-critical,
review-heavy effort that must not be rushed or hand-rolled:

- **No custom cryptography** is a hard project rule. The ratchet, tree math,
  and wire format must come from a maintained, widely-used MLS implementation
  (e.g. an audited-lineage WASM library), integrated and then independently
  reviewed — not written here.
- Doing it wrong is worse than not doing it: it would let us *claim* E2EE while
  silently failing to deliver it. Per ADR-0003, E2EE labeling changes **only**
  after the real implementation lands and is verified.

So this ADR fixes the design and the server-side contract now, and the crypto
integration is a separate, reviewed piece of work. **No E2EE labeling changes
as a result of this ADR.**

## Decision (target design)

### Roles

- **Clients** run the MLS library. All key material, group state, and the
  ratchet live on the device (device key from ADR-0007/0008 is the leaf
  credential). The server never sees plaintext or group secrets.
- **Server is a dumb directory + ordered delivery service.** It stores and
  serves opaque blobs and orders handshake messages; it performs no crypto.

### Server-side contract (buildable without any crypto)

1. **Key-package directory.** Each device publishes one or more opaque MLS
   *key packages* (`POST /mls/key-packages`, bytes + which device). A member
   adding a device to a group fetches a fresh key package
   (`GET /mls/key-packages/{user_id}`), consuming it (last-resort packages
   excepted). This is pure storage keyed by the proven device from ADR-0008.
2. **Ordered handshake delivery.** Commits/Welcomes/Proposals are delivered
   over the existing durable event log + WebSocket fanout (per-community
   ordering already guarantees every member applies epochs in the same order).
   Handshake payloads are opaque `application/mls` blobs.
3. **Epoch on membership change.** Community add/remove already emits
   membership events; the client that owns the group turns those into MLS
   Add/Remove proposals + Commit, rotating the epoch so a removed member loses
   access to future epochs (this is the property the passphrase lacks).

### Content encryption

- Text: message ciphertext is encrypted under the current MLS epoch's exporter
  secret instead of a passphrase-derived key. The stored envelope stays opaque
  to the server (as today).
- Voice: the LiveKit `ExternalE2EEKeyProvider` is fed the epoch-derived key
  instead of the passphrase-derived key, rotating on epoch change.

## Explicitly not in this ADR

- The MLS library choice, its WASM packaging, and the client integration.
- Any change to E2EE labeling or the security posture claims.
- Key-package replenishment policy, last-resort key packages, and recovery/
  multi-device UX — designed with the implementation.

## Consequences

- Device-bound sessions (ADR-0008) are the prerequisite this builds on and are
  now in place.
- The server-side directory + delivery contract can be implemented and tested
  independently of the crypto, de-risking the eventual integration.
- Until the reviewed client integration lands, the honest status remains:
  **opt-in passphrase E2EE only; group keying is not yet implemented.**
