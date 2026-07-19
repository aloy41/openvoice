/**
 * Two-client voice smoke test against the full dev stack (Caddy, API,
 * PostgreSQL, Redis, LiveKit). Requires:
 *   docker compose -f docker-compose.dev.yml up
 * Chromium runs with fake media devices, so real audio hardware is not needed.
 */
import { expect, test } from "@playwright/test";

import { joinVoice, registerAndSignIn } from "./helpers";

test("two clients join the dev voice room, see each other, mute, and leave", async ({
  browser,
}) => {
  const contextA = await browser.newContext({ permissions: ["microphone"] });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await contextA.newPage();
  const bob = await contextB.newPage();

  const aliceName = await registerAndSignIn(alice, "smoke-alice");
  const bobName = await registerAndSignIn(bob, "smoke-bob");

  // The honest encryption state is visible before and during the call.
  await expect(alice.getByRole("note", { name: "Encryption status" })).toContainText(
    "not end-to-end encrypted",
  );

  await joinVoice(alice);
  await joinVoice(bob);

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
  await alice.getByRole("button", { name: "Leave" }).click();
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
  await expect(page.getByRole("button", { name: "Join voice" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(`Signed in as`)).toContainText(name);
  await ctx.close();
});
