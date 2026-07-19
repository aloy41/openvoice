/**
 * Realtime text messaging: two clients in the same community; messages,
 * edits, and deletions propagate live over the WebSocket event stream, and
 * history survives a reload (loaded from the API + durable event log).
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

async function openTextChannel(page: Page, name = "general") {
  await page.getByRole("button", { name: `Text channel ${name}` }).click();
  await expect(page.getByRole("form", { name: "Send a message" })).toBeVisible({
    timeout: 15_000,
  });
}

test("messages, edits, and deletes propagate live between two clients", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const communityName = `Chat ${uniqueName("hub")}`;
  const aliceName = await registerAndSignIn(alice, "chat-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);
  await openTextChannel(alice);

  await registerAndSignIn(bob, "chat-bob");
  await joinCommunityWithCode(bob, code, communityName);
  await openTextChannel(bob);

  // Regression guard: idle past any server-side socket timeout before the
  // first send — a pub/sub listener killed by an idle timeout once made live
  // delivery silently fail at human pace while fast tests passed.
  await alice.waitForTimeout(3500);

  // A sends; B sees it live (no reload) with the author name.
  await alice.getByLabel(/Message #/).fill("hello from alice");
  await alice.getByRole("button", { name: "Send" }).click();
  const bobMessages = bob.getByRole("list", { name: "Messages" });
  await expect(bobMessages).toContainText("hello from alice", { timeout: 15_000 });
  await expect(bobMessages).toContainText(aliceName);

  // B replies; A sees it live.
  await bob.getByLabel(/Message #/).fill("hi alice!");
  await bob.getByRole("button", { name: "Send" }).click();
  const aliceMessages = alice.getByRole("list", { name: "Messages" });
  await expect(aliceMessages).toContainText("hi alice!", { timeout: 15_000 });

  // A edits her message; B sees the edit live.
  const aliceRow = aliceMessages.getByRole("listitem").filter({ hasText: "hello from alice" });
  await aliceRow.hover();
  await aliceRow.getByRole("button", { name: /^Edit message/ }).click();
  await alice.getByLabel("Edit message").fill("hello from alice (better)");
  await alice.getByRole("button", { name: "Save" }).click();
  await expect(bobMessages).toContainText("hello from alice (better)", { timeout: 15_000 });
  await expect(bobMessages).toContainText("(edited)");

  // B deletes his own message; A sees the tombstone live.
  const bobRow = bobMessages.getByRole("listitem").filter({ hasText: "hi alice!" });
  await bobRow.hover();
  await bobRow.getByRole("button", { name: /^Delete message/ }).click();
  await expect(aliceMessages).toContainText("message deleted", { timeout: 15_000 });
  await expect(aliceMessages).not.toContainText("hi alice!");

  // History (including the tombstone) survives a reload. Navigation state is
  // client-side, so re-enter the community from the rail first.
  await bob.reload();
  await bob.getByRole("button", { name: `Community ${communityName}` }).click();
  await openTextChannel(bob);
  await expect(bobMessages).toContainText("hello from alice (better)", { timeout: 15_000 });
  await expect(bobMessages).toContainText("message deleted");

  await ctxA.close();
  await ctxB.close();
});
