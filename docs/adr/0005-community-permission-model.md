# ADR-0005: Community domain and permission model

- Status: **proposed** (design for the next Milestone 2 slice; becomes
  accepted when the implementation and its table-driven tests land)
- Date: 2026-07-18

## Context

Milestone 2 needs communities, memberships, channels, roles, invites, and
bans with central, deny-by-default authorization. The master prompt requires
explicit named capabilities, documented precedence, and no scattered
role-name comparisons.

## Proposed domain

Tables per the master prompt's domain model: `communities`, `memberships`,
`roles` (ordered), `member_roles`, `channels` (category | text | voice),
`permission_overrides`, `invites` (hashed secrets), `bans`, `audit_events`.

## Named capabilities (initial set)

`view_channels`, `manage_channels`, `manage_roles`, `manage_community`,
`create_invite`, `kick_members`, `ban_members`, `send_messages`,
`connect_voice`, `speak`, `mute_members`, `manage_messages`,
`view_audit_log`, `administrator`.

Stored as a bitfield per role and per override (documented bit assignments;
never reuse a bit). `administrator` implies every capability but is still an
explicit grant, auditable and revocable.

## Evaluation algorithm (deny by default)

For member M, channel C in community Y:

1. If M is not an active member of Y (or is banned) → deny everything.
2. If M is the community owner → allow (ownership is the root of trust and
   cannot be orphaned; transfer is an explicit audited action).
3. Base = union of capability bits of all roles assigned to M, plus the
   implicit `@everyone` role of Y.
4. If `administrator` ∈ Base → allow.
5. Channel overrides applied in order, later steps win:
   a. `@everyone` override for C: apply its deny bits, then allow bits.
   b. Union of role overrides for C across M's roles: collect deny bits and
      allow bits separately; apply all denies, then all allows.
   c. Member-specific override for C: apply deny, then allow.
6. Capability granted iff its bit survives.

Properties: member-specific beats role overrides beats `@everyone` override
beats base roles; within a step, deny is applied before allow so an explicit
allow at the same specificity wins over a deny at the same specificity only
via the member-specific step. This table is the contract for the
table-driven tests.

## Enforcement points

- Every `/api/v1` mutation resolves capabilities server-side per request.
- LiveKit tokens are minted only after `connect_voice` (+ `speak` for
  publish) checks on the specific voice channel; token TTL stays ≤ 5 min.
- Capability removal triggers: stop issuing tokens immediately; disconnect
  active LiveKit participants via the server API (best effort, audited).
- Clients receive resolved capabilities for UI rendering but are never
  trusted.

## Open questions (must be answered before implementation)

1. Role ordering semantics for `manage_roles` (can only manage roles below
   your highest role?) — proposed: yes, Discord-like, prevents privilege
   escalation via role editing.
2. Invite scoping: community-wide only for the first slice; channel-scoped
   invites later.
3. `audit_events` retention default (operator-configurable; propose 90 days).
