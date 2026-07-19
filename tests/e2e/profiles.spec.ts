/**
 * Profiles: edit your display name, pronouns, bio, and accent colour; the
 * changes appear across the app and other members can open your profile card.
 */
import { expect, test } from "@playwright/test";

import {
  createCommunity,
  getInviteCode,
  joinCommunityWithCode,
  registerAndSignIn,
  uniqueName,
} from "./helpers";

test("edit profile and view another member's card", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const communityName = `Profiles ${uniqueName("hub")}`;
  const aliceName = await registerAndSignIn(alice, "prof-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);

  // Alice edits her profile from the header.
  await alice.getByRole("button", { name: "Edit your profile" }).click();
  const dialog = alice.getByRole("dialog", { name: "Edit your profile" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Pronouns").fill("she/her");
  await dialog.getByLabel("About you").fill("Builds voice apps for fun.");
  await dialog.getByRole("button", { name: "Colour #a855f7" }).click();
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(dialog).not.toBeVisible();

  // Bob joins and opens Alice's profile card from the members panel.
  await registerAndSignIn(bob, "prof-bob");
  await joinCommunityWithCode(bob, code, communityName);
  const panel = bob.getByRole("complementary", { name: "Members" });
  await expect(panel).toContainText(aliceName, { timeout: 15_000 });
  await panel.getByRole("button", { name: `View ${aliceName}'s profile` }).click();

  const card = bob.getByRole("dialog", { name: "Profile" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("she/her");
  await expect(card).toContainText("Builds voice apps for fun.");
  await bob.keyboard.press("Escape");
  await expect(card).not.toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
