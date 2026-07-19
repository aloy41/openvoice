# Dedicated CI for the full media suite

The per-PR pipeline (`.github/workflows/ci.yml`) runs everything that works on
a shared runner: API/web unit tests, the OpenAPI contract check, the
production image build, secret scanning, and the **non-media** end-to-end
flows (chat, reactions, presence, permissions). It deliberately skips the
real-media suites, which need a working WebRTC media path, Docker control on
the host, and — for the soak — sustained wall-clock time.

Those suites run in `.github/workflows/e2e-full.yml` instead:

| Suite | Spec | What it proves | Gate |
| --- | --- | --- | --- |
| Voice E2EE | `e2ee.spec.ts` | Same passphrase decrypts; wrong passphrase hears only silence | `RUN_VOICE_E2E=1` |
| Media flow | `media-flow.spec.ts` | Real audio from one client reaches another through the SFU | `RUN_VOICE_E2E=1` |
| Voice smoke | `voice-smoke.spec.ts` | Two authorized clients meet in a voice channel; sessions survive reload | `RUN_VOICE_E2E=1` |
| TURN relay | `relay.spec.ts` | A relay-only call (`?forceRelay=1`) succeeds through the embedded TURN server | `RUN_RELAY=1` |
| Reconnect chaos | `reconnect-chaos.spec.ts` | A client shows "reconnecting" and recovers after the SFU container restarts | `RUN_CHAOS=1` |
| Soak | `soak.spec.ts` | N clients hold a stable multi-minute call | `SOAK_MINUTES>0` |

## Running it

**Manually (recommended for first use):** Actions → *E2E — full media suite* →
*Run workflow*. Toggle the voice/relay/chaos suites and set a soak duration
(minutes; `0` skips the soak).

**Nightly:** the workflow also runs on a `06:00 UTC` schedule with the
voice/relay/chaos suites enabled and the soak off.

## Choosing the runner

By default the workflow runs on `ubuntu-latest`. A single GitHub-hosted runner
can host the media path because the dev stack advertises TURN at `127.0.0.1`
and Chromium is launched with `--allow-loopback-in-peer-connection` (see
`playwright.config.ts`). This exercises the real SFrame encryption, ICE, and
TURN allocation on one host.

To exercise a **real LAN media path** (two hosts, non-loopback ICE, TURN over
the wire), register a self-hosted runner and point the workflow at it:

1. Provision a Linux host with Docker (Compose v2) and Node.js 22+.
2. Register it as a repository self-hosted runner (Settings → Actions →
   Runners → *New self-hosted runner*) and give it a label, e.g. `media`.
3. Set the repository variable `E2E_RUNNER` to that label (Settings → Actions
   → Variables → *New repository variable*). The workflow reads
   `runs-on: ${{ vars.E2E_RUNNER || 'ubuntu-latest' }}`.
4. For a true LAN relay test, set the stack's `LIVEKIT_NODE_IP` to the host's
   LAN address (the workflow currently pins `127.0.0.1`; edit the `.env` step
   or override it on the runner) so LiveKit advertises a routable ICE
   candidate.

## What the chaos suite touches

`reconnect-chaos.spec.ts` restarts the LiveKit container
(`openvoice-dev-livekit-1`) mid-call via the host Docker socket, so the runner
must be able to run `docker restart`. On GitHub-hosted runners this is
available; on a self-hosted runner ensure the runner user is in the `docker`
group.

## Secrets

This workflow uses the same **fake, non-secret** credentials as `ci.yml`
(`CI_SECRET_KEY`, `CI_DEV_PASSWORD`, `CI_LIVEKIT_SECRET`), defined inline in
the workflow. No repository secrets are required.
