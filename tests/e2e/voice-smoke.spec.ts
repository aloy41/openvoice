/**
 * Two-client voice smoke test against the full dev stack (Caddy, API,
 * PostgreSQL, Redis, LiveKit). Requires:
 *   docker compose -f docker-compose.dev.yml up
 * and OPENVOICE_DEV_AUTH_PASSWORD (from .env or the environment).
 * Chromium runs with fake media devices, so real audio hardware is not needed.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEV_PASSWORD = process.env.OPENVOICE_DEV_AUTH_PASSWORD ?? "";

test.skip(DEV_PASSWORD === "", "OPENVOICE_DEV_AUTH_PASSWORD is not set");

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Development password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Join voice" })).toBeVisible({ timeout: 10_000 });
}

async function joinVoice(page: Page) {
  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 20_000,
  });
}

test("two clients join the dev voice room, see each other, mute, and leave", async ({
  browser,
}) => {
  const contextA = await browser.newContext({ permissions: ["microphone"] });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await contextA.newPage();
  const bob = await contextB.newPage();

  await signIn(alice, "e2e-alice");
  await signIn(bob, "e2e-bob");

  // The honest encryption state is visible before and during the call.
  await expect(alice.getByRole("note", { name: "Encryption status" })).toContainText(
    "not end-to-end encrypted",
  );

  await joinVoice(alice);
  await joinVoice(bob);

  const listA = alice.getByRole("list", { name: "Participants" });
  await expect(listA).toContainText("e2e-alice", { timeout: 15_000 });
  await expect(listA).toContainText("e2e-bob", { timeout: 15_000 });

  const listB = bob.getByRole("list", { name: "Participants" });
  await expect(listB).toContainText("e2e-alice", { timeout: 15_000 });
  await expect(listB).toContainText("e2e-bob", { timeout: 15_000 });

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
  await expect(listB).not.toContainText("e2e-alice", { timeout: 15_000 });

  await contextA.close();
  await contextB.close();
});
