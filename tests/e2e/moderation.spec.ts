/**
 * Moderation UI: the members panel lists everyone with the owner badge;
 * kicking a member updates both sides live — the kicked user is bounced to
 * Home with an honest notice and their event stream is cut.
 */
import { expect, test } from "@playwright/test";

import {
  createCommunity,
  getInviteCode,
  joinCommunityWithCode,
  registerAndSignIn,
  uniqueName,
} from "./helpers";

test("owner kicks a member; both UIs update live", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const owner = await ctxA.newPage();
  const member = await ctxB.newPage();

  const communityName = `Mod ${uniqueName("court")}`;
  const ownerName = await registerAndSignIn(owner, "mod-owner");
  await createCommunity(owner, communityName);
  const code = await getInviteCode(owner);

  const memberName = await registerAndSignIn(member, "mod-member");
  await joinCommunityWithCode(member, code, communityName);

  // Owner's members panel shows both, with the owner badge, live (no reload).
  const panel = owner.getByRole("complementary", { name: "Members" });
  await expect(panel).toContainText(ownerName, { timeout: 15_000 });
  await expect(panel).toContainText(memberName, { timeout: 15_000 });
  await expect(panel.getByText("owner", { exact: true })).toBeVisible();

  // Member's own panel: no kick/ban controls against the owner (no caps).
  const memberPanel = member.getByRole("complementary", { name: "Members" });
  await expect(memberPanel).toContainText(ownerName, { timeout: 15_000 });
  await expect(memberPanel.getByRole("button", { name: /^Kick/ })).toHaveCount(0);

  // Two-step kick from the owner's panel.
  const memberRow = panel.getByRole("listitem").filter({ hasText: memberName });
  await memberRow.hover();
  await memberRow.getByRole("button", { name: `Kick ${memberName}` }).click();
  await memberRow.getByRole("button", { name: `Confirm kick ${memberName}` }).click();

  // Owner's panel updates live.
  await expect(panel).not.toContainText(memberName, { timeout: 15_000 });

  // The kicked member is bounced to Home with an honest notice, and the
  // community is gone from their rail.
  await expect(member.getByRole("alert")).toContainText("removed from that community", {
    timeout: 15_000,
  });
  await expect(member.getByRole("heading", { name: "Create a community" })).toBeVisible();
  await expect(
    member.getByRole("button", { name: `Community ${communityName}` }),
  ).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
