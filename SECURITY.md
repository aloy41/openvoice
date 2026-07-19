# Security Policy

## Current security status (be honest with yourself before deploying)

This project is at Milestone 0/1. It has **no production authentication, no
end-to-end encryption, and has not received any security review or audit**.
Do not deploy it for real communities or sensitive communication.

Voice media is protected in transit by WebRTC transport encryption
(DTLS-SRTP) between each client and the LiveKit SFU. The SFU and the server
operator can access routed media. Application-level E2EE is planned for
Milestone 3 and will only be claimed after it is implemented with audited
components and independently verified. See `docs/security/threat-model.md`.

## Reporting a vulnerability

While the repository is private, report security issues directly to the
project owner rather than filing an issue.

Before the first public release this policy will be replaced with:
- a dedicated security contact address,
- an expected acknowledgment/response SLA,
- a coordinated disclosure window,
- a supported-versions table.

Please include: affected component, reproduction steps, impact assessment,
and any suggested remediation. Do not include real user data in reports.

## Scope notes for researchers

- The development login (`OPENVOICE_DEV_AUTH_ENABLED`) is dev-only by design;
  the API refuses to start with it enabled in production mode. A bypass of
  that refusal IS a valid finding.
- Any way for a client to obtain a LiveKit token with grants beyond
  audio-only join to its authorized room is a valid finding.
- Secrets, tokens, key material, SDP bodies, or ICE credentials appearing in
  logs is a valid finding.

## Supported versions

None yet — there are no releases. This section will be maintained from the
first tagged release onward.
