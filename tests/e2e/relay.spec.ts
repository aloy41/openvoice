/**
 * TURN relay validation: both clients connect with ?forceRelay=1, which
 * restricts ICE to relay candidates — the call can only succeed if LiveKit's
 * embedded TURN server allocates and relays media. Asserts the same media
 * proofs as media-flow.spec.ts (server VAD + subscriber-side energy).
 *
 * Gated behind RUN_RELAY=1 (needs LIVEKIT_NODE_IP set to a LAN IP):
 *   RUN_RELAY=1 npx playwright test relay
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { E2E_PASSWORD, measureRemoteAudio, uniqueName } from "./helpers";

test.skip(process.env.RUN_RELAY !== "1", "set RUN_RELAY=1 to run TURN relay validation");

async function registerRelayed(page: Page, prefix: string): Promise<string> {
  const username = uniqueName(prefix);
  await page.goto("/?forceRelay=1");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Join voice" })).toBeVisible({
    timeout: 15_000,
  });
  return username;
}

test("a relay-only call succeeds through TURN with real media", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  const aliceName = await registerRelayed(alice, "relay-alice");
  await registerRelayed(bob, "relay-bob");

  for (const page of [alice, bob]) {
    await page.getByRole("button", { name: "Join voice" }).click();
    await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
      timeout: 30_000,
    });
  }

  const rowForAlice = bob
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ hasText: aliceName });
  await expect(rowForAlice).toBeVisible({ timeout: 15_000 });
  await expect(rowForAlice.getByText("speaking")).toBeAttached({ timeout: 20_000 });

  const result = await measureRemoteAudio(bob);
  expect(result.attached).toBeGreaterThan(0);
  expect(result.peak, "relayed audio must carry energy").toBeGreaterThan(0.02);

  await ctxA.close();
  await ctxB.close();
});
