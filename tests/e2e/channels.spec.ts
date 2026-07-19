/**
 * Channel management UI: an owner creates a category and text/voice channels,
 * renames one, and deletes one — all from the sidebar. A plain member sees no
 * management controls (capability-gated).
 */
import { expect, test } from "@playwright/test";

import {
  createCommunity,
  getInviteCode,
  joinCommunityWithCode,
  registerAndSignIn,
  uniqueName,
} from "./helpers";

test("owner creates, renames, and deletes channels; members can't manage", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const owner = await ctxA.newPage();
  const member = await ctxB.newPage();

  const communityName = `Build ${uniqueName("shop")}`;
  await registerAndSignIn(owner, "ch-owner");
  await createCommunity(owner, communityName);
  const code = await getInviteCode(owner);

  const nav = owner.getByRole("navigation", { name: "Channels" });

  // Create a text channel via the header "Add channel" button.
  await owner.getByRole("button", { name: "Add channel" }).click();
  const dialog = owner.getByRole("dialog", { name: "Create a channel" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("announcements");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(nav.getByRole("button", { name: "Text channel announcements" })).toBeVisible({
    timeout: 15_000,
  });

  // Create a voice channel.
  await owner.getByRole("button", { name: "Add channel" }).click();
  const dialog2 = owner.getByRole("dialog", { name: "Create a channel" });
  await dialog2.getByRole("button", { name: /Voice/ }).click();
  await dialog2.getByLabel("Name").fill("Strategy Room");
  await dialog2.getByRole("button", { name: "Create" }).click();
  await expect(nav.getByRole("button", { name: "Voice channel Strategy Room" })).toBeVisible({
    timeout: 15_000,
  });

  // Rename the text channel via its hover ✎ control.
  const row = nav.getByRole("button", { name: "Text channel announcements" });
  await row.hover();
  await nav.getByRole("button", { name: "Rename announcements" }).click();
  await owner.getByLabel("Rename channel").fill("news");
  await owner.getByLabel("Rename channel").press("Enter");
  await expect(nav.getByRole("button", { name: "Text channel news" })).toBeVisible({
    timeout: 15_000,
  });

  // Delete it (two-step confirm).
  const newsRow = nav.getByRole("button", { name: "Text channel news" });
  await newsRow.hover();
  await nav.getByRole("button", { name: "Delete news" }).click();
  await nav.getByRole("button", { name: "Confirm delete news" }).click();
  await expect(nav.getByRole("button", { name: "Text channel news" })).toHaveCount(0, {
    timeout: 15_000,
  });

  // A plain member has no management controls.
  await registerAndSignIn(member, "ch-member");
  await joinCommunityWithCode(member, code, communityName);
  await expect(member.getByRole("button", { name: "Add channel" })).toHaveCount(0);
  const memberRow = member
    .getByRole("navigation", { name: "Channels" })
    .getByRole("button", { name: "Voice channel Strategy Room" });
  await memberRow.hover();
  await expect(
    member.getByRole("button", { name: "Rename Strategy Room" }),
  ).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
