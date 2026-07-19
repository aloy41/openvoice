# Data retention statement

Status: operator-facing statement kept in sync with shipped features. This
document must be updated whenever storage or retention behavior changes.

## What the system stores today

| Data | Where | Retention | Notes |
| --- | --- | --- | --- |
| Accounts (username, display name, avatar/profile fields, Argon2id password hash, timestamps) | PostgreSQL | until account deletion | password is stored only as an Argon2id hash |
| Sessions & devices (SHA-256 hash of the session secret, device public key, user agent, timestamps) | PostgreSQL | until expiry/revocation | the raw session secret and device private key are never stored server-side |
| Communities, channels, roles, memberships, permission overrides, invites (hashed), bans | PostgreSQL | until deleted | source of truth for authorization |
| Messages (content or opaque ciphertext envelope, author, channel, timestamps) | PostgreSQL | until deletion (tombstoned: content cleared, `deleted_at` set) | plaintext when no channel passphrase; AES-GCM ciphertext the server cannot read when a passphrase is set |
| Message reactions | PostgreSQL | until removed or message deleted | |
| Durable event log (per-community ordered events for reconnect catch-up) | PostgreSQL | **pruned after `event_retention_seconds` (default 14 days)**; a background sweep runs every `event_retention_sweep_seconds` | see "Event log retention" below |
| Audit events (actor, action, target, safe structured metadata) | PostgreSQL | until manually pruned | never contains message content, passwords, or key material |
| Presence / typing signals | Redis (memory, TTL) | ephemeral (seconds) | never persisted to disk |
| Structured API logs (request ID, method, path, status, duration) | container stdout | operator-controlled (Docker log driver) | never contain tokens, passwords, key material, SDP, ICE credentials, or content |
| LiveKit server logs | container stdout | operator-controlled | LiveKit's own logging; media itself is never written to disk |

## Event log retention

The durable event log is a **reconnect catch-up buffer, not a store of
record**: clients re-fetch current state (message history, membership, roles)
from the REST API, and the log only lets a reconnecting client replay events
it missed while briefly disconnected. Two mechanisms bound how long content
lives there:

- **Scrub on delete.** Deleting a message clears its content from the messages
  table *and* rewrites the corresponding `message.created`/`message.updated`
  event payloads to empty, marked `scrubbed`. A client replaying the log after
  a deletion recovers no content — only the envelope (id, author, channel,
  timestamps).
- **Bounded retention.** A background sweep deletes event rows older than
  `event_retention_seconds` (default 14 days). This caps how long any event —
  including ones that predate a deletion sweep — can linger. Set the value to
  `0` to disable pruning (not recommended for production).

## What the system does NOT store

- Voice media. The SFU routes media; nothing records, transcribes, or persists
  it, and no such feature will be added server-side (see product non-goals).
- Plaintext passwords (only Argon2id hashes) or raw session secrets (only
  SHA-256 hashes).
- Device private keys — the non-extractable ECDSA P-256 key stays in the
  browser's IndexedDB and is never transmitted.
- Message plaintext for passphrase-protected channels — only opaque AES-GCM
  ciphertext envelopes the server can neither read nor key.

## Metadata honesty

Even with E2EE enabled, the server necessarily observes: IP addresses, account
and device identifiers, community/channel membership, message routing metadata
(author, channel, timestamps), connection timing, and traffic volume. This is
disclosed in the threat model and in user-facing documentation.

## Operator obligations

- Retention windows for the event log are configurable
  (`event_retention_seconds`, `event_retention_sweep_seconds`).
- Log retention is governed by the operator's Docker/logging configuration.
- Backups restore ciphertext and metadata only — never device secrets;
  recovery and permanent-loss semantics are documented with the production
  deployment guide.
