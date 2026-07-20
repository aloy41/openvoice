# Security Policy

## Current security status (be honest with yourself before deploying)

This project has **not received any independent security review or audit**.
Do not deploy it for real communities or sensitive communication without one.

Optional application-level E2EE is available for both voice (passphrase-keyed
LiveKit frame encryption) and text (client-side AES-GCM message envelopes),
and the UI always shows whether a given channel or call is end-to-end
encrypted or transport-encrypted only. These features are built on
widely-used, maintained cryptographic libraries (Web Crypto, LiveKit's
frame encryption) with no custom cryptography, but the integration itself has
not been independently reviewed. Without a passphrase, voice and text are
protected only by transport encryption (DTLS-SRTP / TLS), which the SFU and
the server operator can access. See `docs/security/threat-model.md`.

## Reporting a vulnerability

The repository is public. **Do not file a public issue for security
vulnerabilities.** Instead, report them privately via GitHub's "Report a
vulnerability" flow (Security → Advisories) on the repository, or directly to
the project owner.

This project is pre-1.0 and maintained without a formal SLA; expect
best-effort acknowledgment. A future release will add a dedicated security
contact, a response SLA, a coordinated-disclosure window, and a
supported-versions table.

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
