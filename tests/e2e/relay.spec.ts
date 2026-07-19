/**
 * TURN relay validation over the real product flow: both clients connect with
 * ?forceRelay=1, which restricts ICE to relay candidates — the call can only
 * succeed if LiveKit's embedded TURN server allocates and relays media.
 *
 * Gated behind RUN_RELAY=1 (needs LIVEKIT_NODE_IP set to a LAN IP):
 *   RUN_RELAY=1 npx playwright test relay
 */
import { expect, test } from "@playwright/test";

import {
  createCommunity,
  getInviteCode,
  joinCommunityWithCode,
  joinVoice,
  measureRemoteAudio,
  openVoiceChannel,
  registerAndSignIn,
  uniqueName,
} from "./helpers";

test.skip(process.env.RUN_RELAY !== "1", "set RUN_RELAY=1 to run TURN relay validation");

test("a relay-only call succeeds through TURN with real media", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const communityName = `Relay ${uniqueName("net")}`;

  await alice.goto("/?forceRelay=1");
  const aliceName = await registerAndSignIn(alice, "relay-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);
  await openVoiceChannel(alice);
  await joinVoice(alice);

  await bob.goto("/?forceRelay=1");
  await registerAndSignIn(bob, "relay-bob");
  await joinCommunityWithCode(bob, code, communityName);
  await openVoiceChannel(bob);
  await joinVoice(bob);

  const rowForAlice = bob
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ hasText: aliceName });
  await expect(rowForAlice).toBeVisible({ timeout: 15_000 });
  await expect(rowForAlice.getByText("speaking")).toBeAttached({ timeout: 20_000 });

  const result = await measureRemoteAudio(bob);
  expect(result.attached).toBeGreaterThan(0);
  expect(result.peak, "relayed audio must carry energy").toBeGreaterThan(0.02);

  await ctxA.close();
  await ctxB.close();
});
