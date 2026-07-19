/** Shared e2e helpers: production-auth + community flows. */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const E2E_PASSWORD = "e2e-test-password-1";

/**
 * Real-media voice tests join LiveKit and capture/decode audio, which does not
 * run reliably on shared CI runners (no real UDP media path, limited CPU/RAM —
 * the browser workers crash). Skip them in CI unless RUN_VOICE_E2E=1 (e.g. a
 * self-hosted runner); they always run locally. Everything that doesn't need
 * real media still runs in CI.
 */
export const skipVoiceMedia = !!process.env.CI && !process.env.RUN_VOICE_E2E;

// Unique per test run so registrations never collide with previous runs.
const RUN_ID = Math.random().toString(36).slice(2, 8);

export function uniqueName(prefix: string): string {
  return `${prefix}-${RUN_ID}`;
}

/** Register a fresh account (unique per run) and land on the Home pane. */
export async function registerAndSignIn(page: Page, prefix: string): Promise<string> {
  const username = uniqueName(prefix);
  // Navigate unless the caller already did (e.g. with ?forceRelay=1).
  if (page.url() === "about:blank") await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create a community" })).toBeVisible({
    timeout: 15_000,
  });
  return username;
}

/** From the Home pane: create a community and land in it. */
export async function createCommunity(page: Page, name: string): Promise<void> {
  await page.getByLabel("Community name").fill(name);
  await page.getByRole("button", { name: "Create community" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
}

/** Inside a community: create an invite and return its code. */
export async function getInviteCode(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Invite people" }).click();
  const code = await page.getByTestId("invite-code").textContent({ timeout: 15_000 });
  expect(code).toBeTruthy();
  return code!.trim();
}

/** From the Home pane: redeem an invite code and land in the community. */
export async function joinCommunityWithCode(
  page: Page,
  code: string,
  communityName: string,
): Promise<void> {
  await page.getByLabel("Invite code").fill(code);
  await page.getByRole("button", { name: "Join community" }).click();
  await expect(page.getByRole("heading", { name: communityName })).toBeVisible({
    timeout: 15_000,
  });
}

/** Inside a community: open the default "General" voice channel workspace. */
export async function openVoiceChannel(page: Page, name = "General"): Promise<void> {
  await page.getByRole("button", { name: `Voice channel ${name}` }).click();
  await expect(page.getByRole("button", { name: "Join voice" })).toBeVisible({
    timeout: 15_000,
  });
}

/** In an open voice workspace: join and wait for Connected. */
export async function joinVoice(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 20_000,
  });
}

/** Full path for a community creator: register → community → voice channel. */
export async function setUpOwnerInVoice(
  page: Page,
  prefix: string,
  communityName: string,
): Promise<{ username: string; inviteCode: string }> {
  const username = await registerAndSignIn(page, prefix);
  await createCommunity(page, communityName);
  const inviteCode = await getInviteCode(page);
  await openVoiceChannel(page);
  await joinVoice(page);
  return { username, inviteCode };
}

/** Full path for a guest: register → redeem invite → voice channel. */
export async function setUpGuestInVoice(
  page: Page,
  prefix: string,
  inviteCode: string,
  communityName: string,
): Promise<string> {
  const username = await registerAndSignIn(page, prefix);
  await joinCommunityWithCode(page, inviteCode, communityName);
  await openVoiceChannel(page);
  await joinVoice(page);
  return username;
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
