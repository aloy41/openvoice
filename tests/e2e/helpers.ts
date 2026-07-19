/** Shared e2e helpers: production-auth sign-up/sign-in flows. */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const E2E_PASSWORD = "e2e-test-password-1";

// Unique per test run so registrations never collide with previous runs.
const RUN_ID = Math.random().toString(36).slice(2, 8);

export function uniqueName(prefix: string): string {
  return `${prefix}-${RUN_ID}`;
}

/** Register a fresh account (unique per run) and land on the voice screen. */
export async function registerAndSignIn(page: Page, prefix: string): Promise<string> {
  const username = uniqueName(prefix);
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Join voice" })).toBeVisible({
    timeout: 15_000,
  });
  return username;
}

export async function joinVoice(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 20_000,
  });
}

/** Peak audio level across all remote streams attached in the page — proof
 * that media (not just signaling) reaches this subscriber. */
export async function measureRemoteAudio(page: Page): Promise<{ attached: number; peak: number }> {
  return page.evaluate(async () => {
    const els = Array.from(document.querySelectorAll("audio")).filter(
      (el): el is HTMLAudioElement => el instanceof HTMLAudioElement && el.srcObject !== null,
    );
    if (els.length === 0) return { attached: 0, peak: -1 };
    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    // Measure every attached element (a stale element from a departing
    // participant may be silent) and keep the best peak seen.
    const analysers = els.map((el) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(el.srcObject as MediaStream).connect(analyser);
      return analyser;
    });
    const data = new Uint8Array(256);
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 6000 && peak < 0.05) {
      await new Promise((r) => setTimeout(r, 50));
      for (const analyser of analysers) {
        analyser.getByteTimeDomainData(data);
        for (const v of data) {
          const a = Math.abs(v - 128) / 128;
          if (a > peak) peak = a;
        }
      }
    }
    await ctx.close().catch(() => undefined);
    return { attached: els.length, peak };
  });
}
