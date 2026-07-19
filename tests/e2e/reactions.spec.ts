/**
 * Emoji reactions: reacting shows a chip with a count that updates live for
 * the other client; toggling off removes it. Own reactions are highlighted.
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

test("reactions add, count live, highlight own, and toggle off", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const communityName = `React ${uniqueName("hub")}`;
  await registerAndSignIn(alice, "react-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);
  await openTextChannel(alice);

  await registerAndSignIn(bob, "react-bob");
  await joinCommunityWithCode(bob, code, communityName);
  await openTextChannel(bob);

  await alice.getByPlaceholder(/Message #/).fill("react to this");
  await alice.getByRole("button", { name: "Send" }).click();

  const bobMsg = bob.getByRole("list", { name: "Messages" }).getByRole("listitem").last();
  await expect(bobMsg).toContainText("react to this", { timeout: 15_000 });

  // Bob reacts 🎉 via the picker.
  await bobMsg.hover();
  await bobMsg.getByRole("button", { name: "Add reaction" }).click();
  await bob.getByRole("menuitem", { name: "React 🎉" }).click();

  // Alice sees the 🎉 chip with count 1 (live).
  const aliceMsg = alice.getByRole("list", { name: "Messages" }).getByRole("listitem").last();
  const aliceChip = aliceMsg.getByRole("button", { name: /^🎉 1/ });
  await expect(aliceChip).toBeVisible({ timeout: 15_000 });
  // Not highlighted for Alice (she didn't react).
  await expect(aliceChip).toHaveAttribute("aria-pressed", "false");

  // Alice reacts with the same emoji → count 2, highlighted for her.
  await aliceChip.click();
  await expect(aliceMsg.getByRole("button", { name: /^🎉 2/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Bob sees the count rise to 2 live.
  await expect(bobMsg.getByRole("button", { name: /^🎉 2/ })).toBeVisible({ timeout: 15_000 });

  // Bob toggles his 🎉 off → count back to 1 on both sides.
  await bobMsg.getByRole("button", { name: /^🎉 2/ }).click();
  await expect(aliceMsg.getByRole("button", { name: /^🎉 1/ })).toBeVisible({ timeout: 15_000 });

  await ctxA.close();
  await ctxB.close();
});
