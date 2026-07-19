import { readFileSync } from "node:fs";
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
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
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
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
});
