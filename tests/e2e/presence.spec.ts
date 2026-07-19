/**
 * Presence + typing: two members see each other as online, a typing signal
 * shows the indicator, and leaving flips presence to offline.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  createCommunity,
  getInviteCode,
  joinCommunityWithCode,
  registerAndSignIn,
  uniqueName,
} from "./helpers";

async function openTextChannel(page: Page) {
  await page.getByRole("button", { name: "Text channel general" }).click();
  await expect(page.getByRole("form", { name: "Send a message" })).toBeVisible({
    timeout: 15_000,
  });
}

test("members show online and typing indicators appear live", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const communityName = `Live ${uniqueName("hub")}`;
  const aliceName = await registerAndSignIn(alice, "live-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);
  await openTextChannel(alice);

  const bobName = await registerAndSignIn(bob, "live-bob");
  await joinCommunityWithCode(bob, code, communityName);
  await openTextChannel(bob);

  // Alice's members panel shows 2 online.
  const aPanel = alice.getByRole("complementary", { name: "Members" });
  await expect(aPanel).toContainText("(2 online)", { timeout: 15_000 });

  // Bob types → Alice sees a typing indicator with Bob's name.
  await bob.getByPlaceholder(/Message #/).fill("hey");
  await expect(alice.getByText(`${bobName} is typing…`)).toBeVisible({ timeout: 15_000 });

  // Bob leaves → Alice's online count drops to 1 and Bob dims to offline.
  await bob.close();
  await expect(aPanel).toContainText("(1 online)", { timeout: 20_000 });
  // Alice herself is still online.
  await expect(aPanel).toContainText(aliceName);

  await ctxA.close();
  await ctxB.close();
});
