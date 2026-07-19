/**
 * Passphrase E2EE (ADR-0006) — proving the crypto truth, not just the UI:
 *
 * 1. Two clients with the SAME passphrase exchange intelligible audio
 *    (measurable energy at the subscriber).
 * 2. A third client with FULL channel authorization but the WRONG passphrase
 *    receives only undecryptable frames — silence. Holding the ciphertext
 *    without the key yields nothing, which is what makes the E2EE label
 *    honest (the SFU is in the same position as that client).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  createCommunity,
  getInviteCode,
  joinCommunityWithCode,
  measureRemoteAudio,
  openVoiceChannel,
  registerAndSignIn,
  uniqueName,
} from "./helpers";

async function joinVoiceEncrypted(page: Page, passphrase: string) {
  await page.getByLabel("Voice encryption passphrase (optional)").fill(passphrase);
  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 20_000,
  });
  await expect(page.getByRole("note", { name: "Call encryption status" })).toContainText(
    "End-to-end encrypted (passphrase)",
    { timeout: 15_000 },
  );
}

test("same passphrase decrypts; wrong passphrase hears only silence", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const ctxC = await browser.newContext({ permissions: ["microphone"] });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  const carol = await ctxC.newPage();

  const communityName = `E2EE ${uniqueName("vault")}`;
  const PASSPHRASE = "correct-horse-battery-staple-e2ee";

  const aliceName = await registerAndSignIn(alice, "e2ee-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);
  await openVoiceChannel(alice);
  await joinVoiceEncrypted(alice, PASSPHRASE);

  await registerAndSignIn(bob, "e2ee-bob");
  await joinCommunityWithCode(bob, code, communityName);
  await openVoiceChannel(bob);
  await joinVoiceEncrypted(bob, PASSPHRASE);

  // Same passphrase: Bob hears Alice's tone — encrypted end-to-end, decrypted
  // locally. Server-side voice-activity detection CANNOT see through E2EE, so
  // we assert on subscriber-side energy (the honest signal), not UI badges.
  const rowForAlice = bob
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ hasText: aliceName });
  await expect(rowForAlice).toBeVisible({ timeout: 15_000 });
  const bobHears = await measureRemoteAudio(bob);
  expect(bobHears.attached).toBeGreaterThan(0);
  expect(bobHears.peak, "same-passphrase subscriber must decode audio").toBeGreaterThan(0.02);

  // Both participants show as sending encrypted audio.
  await expect(bob.getByLabel("encrypted").first()).toBeVisible({ timeout: 15_000 });

  // Carol: full membership + channel authorization, WRONG passphrase.
  await registerAndSignIn(carol, "e2ee-carol");
  await joinCommunityWithCode(carol, code, communityName);
  await openVoiceChannel(carol);
  await joinVoiceEncrypted(carol, "totally-wrong-passphrase-123");

  // Give her subscriber a moment to attach tracks, then measure: nothing
  // decodable may come out despite receiving every (encrypted) frame.
  await expect(
    carol
      .getByRole("list", { name: "Participants" })
      .getByRole("listitem")
      .filter({ hasText: aliceName }),
  ).toBeVisible({ timeout: 15_000 });
  await carol.waitForTimeout(2000);
  const carolHears = await measureRemoteAudio(carol);
  expect(carolHears.attached, "frames are delivered to her").toBeGreaterThan(0);
  expect(
    carolHears.peak,
    "wrong-passphrase subscriber must get silence (ciphertext without the key)",
  ).toBeLessThan(0.02);

  // Meanwhile Bob STILL hears Alice fine — Carol's presence changes nothing.
  const bobStillHears = await measureRemoteAudio(bob);
  expect(bobStillHears.peak).toBeGreaterThan(0.02);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
