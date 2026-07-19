/**
 * Final polish: composer emoji picker inserts an emoji; renaming a community
 * updates the other member's rail live; a message in another channel raises an
 * unread badge that clears when the channel is opened.
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

async function openText(page: Page, name = "general") {
  await page.getByRole("button", { name: `Text channel ${name}` }).click();
  await expect(page.getByRole("form", { name: "Send a message" })).toBeVisible({
    timeout: 15_000,
  });
}

test("emoji picker inserts into the composer", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await registerAndSignIn(page, "polish-e");
  await createCommunity(page, `Polish ${uniqueName("a")}`);
  await openText(page);

  await page.getByRole("button", { name: "Insert emoji" }).click();
  await page.getByRole("menuitem", { name: "Insert 🎉" }).click();
  await expect(page.getByPlaceholder(/Message #/)).toHaveValue("🎉");
  await ctx.close();
});

test("renaming a community updates other members live", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const owner = await ctxA.newPage();
  const member = await ctxB.newPage();

  const name = `Rename ${uniqueName("hub")}`;
  await registerAndSignIn(owner, "polish-owner");
  await createCommunity(owner, name);
  const code = await getInviteCode(owner);
  await registerAndSignIn(member, "polish-member");
  await joinCommunityWithCode(member, code, name);

  await owner.getByRole("button", { name: "Community settings" }).click();
  await owner.getByLabel("Community name").fill("Renamed Live");
  await owner.getByRole("button", { name: "Save" }).click();

  // Member's sidebar heading + rail update without a reload.
  await expect(member.getByRole("heading", { name: "Renamed Live" })).toBeVisible({
    timeout: 15_000,
  });
  await ctxA.close();
  await ctxB.close();
});

test("a message in another channel raises an unread badge that clears on open", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const name = `Unread ${uniqueName("hub")}`;
  await registerAndSignIn(alice, "unread-alice");
  await createCommunity(alice, name);
  const code = await getInviteCode(alice);
  // Add a second text channel.
  await alice.getByRole("button", { name: "Add channel" }).click();
  const dialog = alice.getByRole("dialog", { name: "Create a channel" });
  await dialog.getByLabel("Name").fill("random");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByRole("button", { name: "Text channel random" })).toBeVisible();

  await registerAndSignIn(bob, "unread-bob");
  await joinCommunityWithCode(bob, code, name);

  // Alice sits in #general; Bob posts in #random.
  await openText(alice, "general");
  await openText(bob, "random");
  await bob.getByPlaceholder(/Message #/).fill("anyone around?");
  await bob.getByRole("button", { name: "Send" }).click();

  // Alice's #random shows an unread badge, then clears when she opens it.
  const randomBtn = alice.getByRole("button", { name: "Text channel random" });
  await expect(randomBtn.getByLabel("unread messages")).toBeVisible({ timeout: 15_000 });
  await randomBtn.click();
  await expect(alice.getByRole("button", { name: "Text channel random" }).getByLabel("unread messages")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
