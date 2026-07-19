/**
 * Proves audio actually transits the SFU — signaling success (participant
 * lists, mute flags) is NOT evidence that media flows, especially behind
 * Docker NAT where ICE candidates can be unreachable while the room "looks"
 * connected.
 *
 * Client A publishes a continuous 440 Hz tone (fake capture file). Then:
 * 1. Client B's UI must mark A as speaking — that state comes from the
 *    SERVER's audio-level detection, proving A→SFU audio.
 * 2. The remote MediaStream attached in B's page must carry measurable
 *    energy — proving SFU→B audio.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEV_PASSWORD = process.env.OPENVOICE_DEV_AUTH_PASSWORD ?? "";

test.skip(DEV_PASSWORD === "", "OPENVOICE_DEV_AUTH_PASSWORD is not set");

async function signInAndJoin(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Development password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 20_000,
  });
}

test("audio from one client reaches the other through the SFU", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await signInAndJoin(alice, "media-alice");
  await signInAndJoin(bob, "media-bob");

  const rowForAlice = bob
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ hasText: "media-alice" });
  await expect(rowForAlice).toBeVisible({ timeout: 15_000 });

  // 1. Server-side voice activity: B sees A speaking (tone is continuous).
  await expect(rowForAlice.getByText("speaking")).toBeAttached({ timeout: 20_000 });

  // 2. Subscriber-side energy: the remote stream B plays must be non-silent.
  const result = await bob.evaluate(async () => {
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

  expect(result.attached, "B must have an attached remote audio element").toBeGreaterThan(0);
  expect(result.peak, "remote audio at B must carry energy (SFU→B media path)").toBeGreaterThan(
    0.02,
  );

  await ctxA.close();
  await ctxB.close();
});
