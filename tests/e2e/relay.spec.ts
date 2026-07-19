/**
 * TURN relay validation: both clients connect with ?forceRelay=1, which
 * restricts ICE to relay candidates — the call can only succeed if LiveKit's
 * embedded TURN server allocates and relays media. Asserts the same media
 * proofs as media-flow.spec.ts (server VAD + subscriber-side energy).
 *
 * Gated behind RUN_RELAY=1 (needs the TURN port published):
 *   RUN_RELAY=1 npx playwright test relay
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEV_PASSWORD = process.env.OPENVOICE_DEV_AUTH_PASSWORD ?? "";

test.skip(process.env.RUN_RELAY !== "1", "set RUN_RELAY=1 to run TURN relay validation");
test.skip(DEV_PASSWORD === "", "OPENVOICE_DEV_AUTH_PASSWORD is not set");

async function signInAndJoinRelayed(page: Page, username: string) {
  await page.goto("/?forceRelay=1");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Development password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 30_000,
  });
}

test("a relay-only call succeeds through TURN with real media", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await signInAndJoinRelayed(alice, "relay-alice");
  await signInAndJoinRelayed(bob, "relay-bob");

  const rowForAlice = bob
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ hasText: "relay-alice" });
  await expect(rowForAlice).toBeVisible({ timeout: 15_000 });
  await expect(rowForAlice.getByText("speaking")).toBeAttached({ timeout: 20_000 });

  const result = await bob.evaluate(async () => {
    const els = Array.from(document.querySelectorAll("audio")).filter(
      (el): el is HTMLAudioElement => el instanceof HTMLAudioElement && el.srcObject !== null,
    );
    if (els.length === 0) return { attached: 0, peak: -1 };
    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
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

  expect(result.attached).toBeGreaterThan(0);
  expect(result.peak, "relayed audio must carry energy").toBeGreaterThan(0.02);

  await ctxA.close();
  await ctxB.close();
});
