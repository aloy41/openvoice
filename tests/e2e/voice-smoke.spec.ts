/**
 * Core product smoke test against the full dev stack: account creation →
 * community creation → invite → second user joins → both enter an authorized
 * voice channel → mute propagates → leave. Chromium runs with fake media
 * devices, so real audio hardware is not needed.
 */
import { expect, test } from "@playwright/test";

import {
  registerAndSignIn,
  setUpGuestInVoice,
  setUpOwnerInVoice,
  uniqueName,
} from "./helpers";

test("invite flow: two clients meet in an authorized voice channel", async ({ browser }) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext({ permissions: ["microphone"] });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await contextA.newPage();
  const bob = await contextB.newPage();

  const communityName = `Smoke ${uniqueName("hq")}`;
  const { username: aliceName, inviteCode } = await setUpOwnerInVoice(
    alice,
    "smoke-alice",
    communityName,
  );

  // The honest encryption state is visible in the workspace.
  await expect(alice.getByRole("note", { name: "Encryption status" })).toContainText(
    "not end-to-end encrypted",
  );

  const bobName = await setUpGuestInVoice(bob, "smoke-bob", inviteCode, communityName);

  const listA = alice.getByRole("list", { name: "Participants" });
  await expect(listA).toContainText(aliceName, { timeout: 15_000 });
  await expect(listA).toContainText(bobName, { timeout: 15_000 });

  const listB = bob.getByRole("list", { name: "Participants" });
  await expect(listB).toContainText(aliceName, { timeout: 15_000 });
  await expect(listB).toContainText(bobName, { timeout: 15_000 });

  // Mute state is exposed via aria-pressed and reflected to the other client.
  await alice.getByRole("button", { name: "Mute" }).click();
  await expect(alice.getByRole("button", { name: "Unmute" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(listB.getByText("muted")).toBeVisible({ timeout: 15_000 });

  // Deafen implies mute stays on; controls remain keyboard-reachable.
  await alice.getByRole("button", { name: "Deafen" }).click();
  await expect(alice.getByRole("button", { name: "Undeafen" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Leaving returns to a joinable state.
  await alice.getByRole("button", { name: "Leave" }).first().click();
  await expect(alice.getByRole("button", { name: "Join voice" })).toBeVisible();

  // Bob sees Alice gone.
  await expect(listB).not.toContainText(aliceName, { timeout: 15_000 });

  await contextA.close();
  await contextB.close();
});

test("a session survives a page reload", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const name = await registerAndSignIn(page, "reload");
  await page.reload();
  // restored from the cookie session — no sign-in form
  await expect(page.getByRole("heading", { name: "Create a community" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Signed in as")).toContainText(name);
  await ctx.close();
});
