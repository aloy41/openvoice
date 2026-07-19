import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Load OPENVOICE_DEV_AUTH_PASSWORD from .env for local runs (CI sets env vars
// directly). Minimal parser — no secrets are printed or persisted.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // no .env — fine in CI
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  // These are real WebRTC/media tests: each spins up multiple headless
  // browser contexts capturing and decoding audio. Over-parallelizing
  // starves the audio pipeline and makes server-side voice-activity timing
  // flaky, so cap concurrency and allow one retry to absorb residual jitter.
  workers: process.env.CI ? 2 : 3,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    // The dev stack's LAN HTTPS/WSS endpoints use Caddy's internal CA.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            // Deterministic non-silent mic input (the built-in fake device is
            // silent in headless shell): loop a generated 440 Hz tone.
            `--use-file-for-fake-audio-capture=${resolve(process.cwd(), "tests/e2e/fixtures/tone.wav")}`,
            "--autoplay-policy=no-user-gesture-required",
            // Chromium ignores loopback TURN/ICE by default; the dev stack's
            // TURN server is advertised as 127.0.0.1 (relay.spec.ts).
            "--allow-loopback-in-peer-connection",
          ],
        },
      },
    },
  ],
});
