# ADR-0006: E2EE via passphrase-keyed encryption (alpha) — voice and text

- Status: accepted
- Date: 2026-07-19
- Scope note: originally voice-only; extended the same day to cover text
  messages (see "Text messages" below). MLS-based automatic group keying
  replaces the manual passphrase for both in the M3 completion.

## Context

Milestone 3 requires end-to-end encrypted voice where the SFU, control
plane, database, and operator cannot access media content. The master
prompt's rules: use LiveKit's maintained E2EE support, never invent
cryptography, and — if MLS-based dynamic group keying is not yet
integrated — a **clearly labeled client-entered pre-shared secret** is an
acceptable alpha bootstrap. It is never acceptable to quietly substitute a
server-generated key and call the result E2EE.

## Decision

### Mechanism (widely-used, maintained code, zero custom crypto)

- LiveKit's `ExternalE2EEKeyProvider` + E2EE web worker
  (`livekit-client/e2ee-worker`): per-frame media encryption (AES-GCM via
  Web Crypto) applied in the client before frames reach the transport, so
  the SFU routes ciphertext it cannot read.
- The key is derived **in the client** from a user-entered passphrase using
  the SDK's PBKDF2 path (`keyProvider.setKey(passphrase)`).
- The passphrase is held in browser memory only for the duration of the
  call. It is NEVER sent to the API, stored, logged, or embedded in tokens.
  The backend has no code path that receives key material (exit-gate
  requirement; greppable).

### Product semantics

- Per call, opt-in: a "voice encryption passphrase" field on the voice
  workspace. Everyone in the channel must enter the same passphrase,
  exchanged out-of-band (in person, another E2EE channel, etc.).
- UI states are exact:
  - passphrase set → "End-to-end encrypted (passphrase)" with a
    plain-language explanation of what that does and does not protect;
  - no passphrase → the existing "transport encryption only" state;
  - E2EE active but a participant is sending unencrypted → degraded warning.
- A participant with the wrong passphrase hears silence (frames do not
  decrypt) — the UI explains this rather than pretending it cannot happen.

### Honest limitations (disclosed in UI copy and threat model)

1. Anyone holding the passphrase AND channel access can decrypt. Removing a
   member does not rotate the key — participants must agree on a new
   passphrase to lock a former member out of FUTURE calls. (Automatic
   epoch rotation on membership change is exactly what MLS provides and is
   the planned replacement.)
2. No per-device identity binding yet; the passphrase does not authenticate
   who is speaking (channel authorization still does membership).
3. Passphrase strength is the user's responsibility; PBKDF2 slows brute
   force but a weak passphrase weakens the encryption.
4. Metadata (who talks to whom, when, how much) remains visible to the
   server, as always.

### Path to full M3

MLS (RFC 9420) via a widely-used, maintained implementation for automatic group keying
with per-device credentials, epoch rotation on membership change, and
verification states — replacing the passphrase for dynamic groups. Text
message E2EE (ciphertext envelopes) ships alongside that key layer.

## Text messages (same mechanism, added 2026-07-19)

- Client-side AES-GCM with a PBKDF2-derived key via Web Crypto
  (`apps/web/src/crypto/envelope.ts`) — no custom crypto. The passphrase is
  per-community, entered in the channel header, held in browser memory only.
- Messages carry a `scheme`: `plaintext` (transport-only, server-readable) or
  `passphrase-v1` (the `content` column holds the opaque base64 envelope).
  The server stores and returns `content` verbatim, validates only the
  scheme enum, and has no code path that decrypts or derives the key.
- Wrong passphrase / no passphrase → the message renders as a locked
  placeholder, never the plaintext. Decryption failures return null, never
  throw.
- Same honest limits as voice: shared out-of-band, no rotation on membership
  change, no per-device identity. Deletion still tombstones (content cleared).
- Verified by `tests/e2e/e2ee-text.spec.ts`: same-passphrase clients read the
  text; the API response (exactly what the server holds) contains only the
  ciphertext envelope, never the plaintext; a wrong-passphrase member sees the
  locked placeholder. Envelope unit tests in
  `apps/web/src/crypto/__tests__/envelope.test.ts` assert round-trip,
  wrong-key null, and that ciphertext never contains the plaintext.

## Consequences

- The e2e suite proves the crypto truth: same-passphrase clients exchange
  intelligible audio; a wrong-passphrase client with full channel access
  receives only undecodable frames (silence) — demonstrating that holding
  the ciphertext without the key yields nothing.
- The SFU still performs SRTP (transport) on top; E2EE is inside it.
- Voice tokens, authorization, and the permission engine are unchanged —
  E2EE composes with, and does not replace, access control.
