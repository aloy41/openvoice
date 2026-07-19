# Threat model

Status: **skeleton** — created at Milestone 0 as required by the master build
prompt. It must be completed and reviewed before any E2EE claim (Milestone 3
gate). Sections marked *(M3)* are gates for that milestone.

## Current honest security posture (2026-07-18)

- Voice media: WebRTC transport encryption (DTLS-SRTP) between each client
  and the LiveKit SFU. **The SFU decrypts and re-routes media. The operator
  can access voice content. This is not E2EE and is labeled accordingly
  everywhere.**
- Text messaging: not implemented yet.
- Authentication: production password accounts (Argon2id, HttpOnly cookie
  sessions with hashed server-side secrets, double-submit CSRF, Redis rate
  limiting, immediate revocation — ADR-0004) plus the development-only
  shared-password login, which is refused in production mode at startup.
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
| SFU/operator can access voice media | M3 (media E2EE) |
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
