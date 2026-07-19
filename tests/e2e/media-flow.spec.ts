/**
 * Proves audio actually transits the SFU in a real community voice channel —
 * signaling success (participant lists, mute flags) is NOT evidence that
 * media flows.
 *
 * Client A publishes a continuous 440 Hz tone (fake capture file). Then:
 * 1. Client B's UI must mark A as speaking — that state comes from the
 *    SERVER's audio-level detection, proving A→SFU audio.
 * 2. The remote MediaStream attached in B's page must carry measurable
 *    energy — proving SFU→B audio.
 */
import { expect, test } from "@playwright/test";

import {
  measureRemoteAudio,
  setUpGuestInVoice,
  setUpOwnerInVoice,
  skipVoiceMedia,
  uniqueName,
} from "./helpers";

test("audio from one client reaches the other through the SFU", async ({ browser }) => {
  test.skip(skipVoiceMedia, "real-media voice test — runs locally / self-hosted runners");
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const communityName = `Media ${uniqueName("lab")}`;
  const { username: aliceName, inviteCode } = await setUpOwnerInVoice(
    alice,
    "media-alice",
    communityName,
  );
  await setUpGuestInVoice(bob, "media-bob", inviteCode, communityName);

  const rowForAlice = bob
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ hasText: aliceName });
  await expect(rowForAlice).toBeVisible({ timeout: 15_000 });

  // 1. Subscriber-side energy is the hard proof that media transits the SFU:
  // the remote stream B plays must carry real audio (A→SFU→B).
  const result = await measureRemoteAudio(bob);
  expect(result.attached, "B must have an attached remote audio element").toBeGreaterThan(0);
  expect(result.peak, "remote audio at B must carry energy (SFU→B media path)").toBeGreaterThan(
    0.02,
  );

  // 2. Server-side voice activity (a softer, timing-sensitive signal): the
  // server's own audio-level detection should eventually mark A as speaking.
  await expect(rowForAlice.getByText("speaking")).toBeAttached({ timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});
