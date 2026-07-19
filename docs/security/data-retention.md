# Data retention statement

Status: initial statement for the development stack (Milestone 0/1). This
document is operator-facing and must be kept accurate as features land.

## What the system stores today

| Data | Where | Retention | Notes |
| --- | --- | --- | --- |
| Dev user rows (username, display name, created/last-login timestamps, `is_dev_user`) | PostgreSQL | until manually deleted | created by the dev login |
| Structured API logs (request ID, method, path, status, duration) | container stdout | operator-controlled (Docker log driver) | never contain tokens, passwords, key material, SDP, ICE credentials, or content |
| LiveKit server logs | container stdout | operator-controlled | LiveKit's own logging; media itself is never written to disk |
| Redis state | Redis (memory) | ephemeral | disposable by design; currently only used for readiness checks |

## What the system does NOT store

- Voice media. The SFU routes media; nothing records, transcribes, or
  persists it, and no such feature will be added server-side (see product
  non-goals).
- Passwords for dev login (a shared secret from the environment is compared
  in constant time; nothing is written).
- Message content — messaging does not exist yet. When it lands with E2EE,
  the server will store ciphertext envelopes and minimal routing metadata.

## Metadata honesty

Even with future E2EE, the server necessarily observes: IP addresses, account
and device identifiers, community/room membership, connection timing, and
traffic volume. This is disclosed in the threat model and will be disclosed
in user-facing documentation.

## Operator obligations (future)

Retention windows for logs and audit events will be operator-configurable
(Milestone 2/4). Backups restore ciphertext and metadata only — never device
secrets; recovery and permanent-loss semantics will be documented honestly
with the E2EE milestone.
