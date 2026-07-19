# Threat model

Status: **skeleton** — created at Milestone 0 as required by the master build
prompt. It must be completed and reviewed before any E2EE claim (Milestone 3
gate). Sections marked *(M3)* are gates for that milestone.

## Current honest security posture (2026-07-19)

- Voice media, passphrase E2EE (opt-in, ADR-0006): when every participant
  enters the same client-side passphrase, frames are encrypted in the
  browser (LiveKit's maintained E2EE worker, PBKDF2-derived key via Web
  Crypto) before transport — **the SFU, API, database, and operator cannot
  access the audio**. Verified by an automated test in which a fully
  authorized client with the wrong passphrase receives every frame and
  obtains only silence. Honest limits: the passphrase is shared out-of-band;
  anyone with passphrase + channel access can decrypt; no automatic key
  rotation on membership change (agree on a new passphrase to exclude a
  former member from future calls); no per-device identity binding yet.
  MLS-based dynamic group keying is the planned replacement (A5 below).
- Voice media, default: WebRTC transport encryption (DTLS-SRTP) between
  each client and the LiveKit SFU. **Without a passphrase the SFU can
  access media and the UI says so.**
- Text messaging: opt-in E2EE (ADR-0006). With a per-community passphrase,
  message content is AES-GCM ciphertext produced client-side (Web Crypto);
  the server stores/returns the opaque envelope and cannot read it (verified
  by e2e — the API response contains only ciphertext). Without a passphrase,
  messages are transport-encrypted only and server-readable. Same limits as
  voice E2EE; MLS replaces the manual passphrase later.
- Authentication: production password accounts (Argon2id, HttpOnly cookie
  sessions with hashed server-side secrets, double-submit CSRF, Redis rate
  limiting, immediate revocation — ADR-0004) plus the development-only
  shared-password login, which is refused in production mode at startup.
- Per-device identity (ADR-0007): each browser holds a non-extractable
  ECDSA P-256 private key in IndexedDB (never transmitted); only the public
  key is registered, and devices can be listed and revoked. Identity/
  foundation only — not yet used to protect content (that is the MLS work).
  Storage caveat: clearing browser storage loses the key; the user registers
  a new device. Desktop will use OS secure storage.
- No security review or audit has occurred.

## Assets

1. Voice media content.
2. (Future) private text message content.
3. Account credentials and session tokens.
4. (Future) device private identity keys — client-side only, never server-side.
5. Membership/permission state and audit history.
6. Metadata: IPs, identifiers, room membership, timing, traffic volume.

## Trust boundaries

| # | Boundary | Data crossing | Current protection | Target (M3+) |
| - | --- | --- | --- | --- |
| B1 | Client ↔ reverse proxy/API | credentials, tokens, API state | TLS (prod), signed dev tokens, startup config validation | HttpOnly cookies + CSRF, rotating refresh tokens, device identity |
| B2 | Client ↔ LiveKit SFU | signaling, media | WSS + DTLS-SRTP; SFU sees plaintext media | SFrame-compatible media E2EE via LiveKit's maintained support; SFU sees only ciphertext |
| B3 | API ↔ PostgreSQL | all durable state | internal network, credentials | least-privilege accounts; private content stored only as ciphertext envelopes |
| B4 | API ↔ Redis | ephemeral presence/coordination | internal network | same; loss of Redis must never lose durable data |
| B5 | API ↔ LiveKit | token-signing shared secret | env-only secret, never logged | unchanged; short-lived scoped tokens only |
| B6 | Client device itself | mic audio, keys, plaintext UI | out of scope (documented) | out of scope (documented) |

## Adversaries we design against

- **A1 Passive network observer** — mitigated now by TLS/DTLS-SRTP.
- **A2 Database/storage disclosure** — (M3) private content must be
  ciphertext; today no private content is stored.
- **A3 Curious/compromised SFU** — **NOT mitigated today**; (M3) media E2EE.
- **A4 Curious/compromised control plane** — **NOT mitigated today**; (M3)
  server never holds content keys.
- **A5 Replay / removed-member access** — (M3) epoch rotation on membership
  change per the audited implementation's guarantees.
- **A6 Credential theft** — (M2) session revocation, device revocation,
  hashed rotating refresh tokens, reuse detection.

## Explicit non-goals (never claim protection against)

- Compromised endpoint, OS, browser, microphone, or stolen device keys.
- A legitimate participant recording audio or copying messages.
- Traffic analysis / metadata concealment. The server observes IPs, account
  and device identifiers, membership, timing, and volume.
- Host-level denial of service, delayed delivery, or message suppression.
- Anonymity of any kind.

## Known current weaknesses (tracked, not hidden)

| Weakness | Milestone that removes it |
| --- | --- |
| Voice E2EE requires a manually shared passphrase; no rotation on membership change, no per-device identity | M3 completion (MLS-based group keying) |
| SFU/operator can access voice media when no passphrase is used | user opt-in today; default-on E2EE with MLS |
| Text message content readable by the server | M3 (ciphertext envelopes) |
| Dev login still enabled in dev stacks (shared password, no rate limit); production auth exists but the web client still uses the dev flow | M2 (client migration, then dev-auth removal) |
| No account recovery — lost password = lost account (no email on file) | M2 later slice |
| Argon2id parameters are library defaults, not yet reviewed for deployment class | pre-MVP security review |
| TURN validated over UDP only; TURN over TLS needs domain + certificate | M4 hardened deployment |
| Rate limiting covers auth endpoints only | M2/M4 |
| Compose dev stack has no TLS | M4 hardened reference deployment |

## Standards and implementations to be used (do not substitute)

WebRTC; Opus (RFC 6716); SFrame (RFC 9605) via LiveKit's maintained E2EE;
MLS (RFC 9420) via an audited implementation for group key management;
Web Crypto / OS secure storage for client key handling. **No custom
primitives, ratchets, or wire formats — ever.**
