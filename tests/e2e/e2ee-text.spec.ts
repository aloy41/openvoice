/**
 * E2EE text messages (ADR-0006 semantics). Proves the crypto truth:
 * 1. Two clients with the same channel passphrase exchange readable text live.
 * 2. The API — queried directly, i.e. exactly what the server holds — returns
 *    only a ciphertext envelope, never the plaintext. If the server can't
 *    produce the plaintext, neither can its operator or database.
 * 3. A member with the WRONG passphrase sees a locked placeholder, not the text.
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

const SECRET = "meet at the docks at midnight";
const PASSPHRASE = "shared-channel-secret-9911";

async function openTextChannel(page: Page, name = "general") {
  await page.getByRole("button", { name: `Text channel ${name}` }).click();
  await expect(page.getByRole("form", { name: "Send a message" })).toBeVisible({
    timeout: 15_000,
  });
}

test("encrypted messages are readable with the passphrase and opaque to the server", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  const carol = await ctxC.newPage();

  const communityName = `Cipher ${uniqueName("den")}`;
  await registerAndSignIn(alice, "ct-alice");
  await createCommunity(alice, communityName);
  const code = await getInviteCode(alice);
  await openTextChannel(alice);

  await registerAndSignIn(bob, "ct-bob");
  await joinCommunityWithCode(bob, code, communityName);
  await openTextChannel(bob);

  await registerAndSignIn(carol, "ct-carol");
  await joinCommunityWithCode(carol, code, communityName);
  await openTextChannel(carol);

  // Alice and Bob share the passphrase; Carol enters a wrong one.
  await alice.getByPlaceholder(/Message passphrase/).fill(PASSPHRASE);
  await bob.getByPlaceholder(/Message passphrase/).fill(PASSPHRASE);
  await carol.getByPlaceholder(/Message passphrase/).fill("the-wrong-passphrase");

  // Alice sends an encrypted message (composer placeholder flips to
  // "Encrypted message to #…" once a passphrase is set).
  await alice.getByPlaceholder(/^Encrypted message to #/).fill(SECRET);
  await alice.getByRole("button", { name: "Send" }).click();

  // Bob (right passphrase) reads it live, with the E2EE badge.
  const bobMessages = bob.getByRole("list", { name: "Messages" });
  await expect(bobMessages).toContainText(SECRET, { timeout: 15_000 });

  // Carol (wrong passphrase) sees a locked placeholder, never the plaintext.
  const carolMessages = carol.getByRole("list", { name: "Messages" });
  await expect(carolMessages).toContainText("can't decrypt", { timeout: 15_000 });
  await expect(carolMessages).not.toContainText(SECRET);

  // THE SERVER'S VIEW: fetch the channel messages straight from the API (this
  // is exactly what the server stored and can return). It must be ciphertext.
  const channelId = new URL(alice.url()); // not used; fetch via API below
  void channelId;
  const detail = await alice.request.get(
    `/api/v1/communities/${await communityIdFrom(alice)}`,
  );
  const channels = (await detail.json()).channels as Array<{ id: string; kind: string }>;
  const textChannel = channels.find((c) => c.kind === "text")!;
  const raw = await alice.request.get(`/api/v1/channels/${textChannel.id}/messages`);
  const body = await raw.text();
  expect(body).not.toContain(SECRET);
  const parsed = JSON.parse(body) as { messages: Array<{ scheme: string; content: string }> };
  const encrypted = parsed.messages.find((m) => m.scheme === "passphrase-v1");
  expect(encrypted, "message stored under the encrypted scheme").toBeTruthy();
  expect(encrypted!.content).not.toContain(SECRET);
  expect(encrypted!.content).toContain("AES-GCM"); // opaque envelope marker

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

async function communityIdFrom(page: Page): Promise<string> {
  const res = await page.request.get("/api/v1/communities");
  const list = (await res.json()).communities as Array<{ id: string }>;
  return list[0]!.id;
}
