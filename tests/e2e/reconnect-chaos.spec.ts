/**
 * Reconnect chaos test: restart the LiveKit container mid-call and verify the
 * client surfaces "reconnecting" and then recovers to Connected (or, if the
 * SFU stays down too long, lands on the honest Disconnected + Rejoin state).
 *
 * Gated behind RUN_CHAOS=1 because it controls Docker on the host:
 *   RUN_CHAOS=1 npx playwright test reconnect-chaos
 */
import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";

import { setUpOwnerInVoice, uniqueName } from "./helpers";

const LIVEKIT_CONTAINER = process.env.LIVEKIT_CONTAINER ?? "openvoice-dev-livekit-1";

test.skip(process.env.RUN_CHAOS !== "1", "set RUN_CHAOS=1 to run docker-restart chaos tests");

test("client shows reconnecting and recovers after an SFU restart", async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();

  await setUpOwnerInVoice(page, "chaos", `Chaos ${uniqueName("lab")}`);

  execSync(`docker restart ${LIVEKIT_CONTAINER}`, { stdio: "inherit", timeout: 60_000 });

  // The drop must be surfaced honestly…
  await expect(page.getByTestId("connection-status")).toHaveText(/reconnecting|Disconnected/, {
    timeout: 30_000,
  });

  // …and the client must end in a usable state: either auto-recovered, or
  // offering an explicit rejoin.
  await expect
    .poll(
      async () => {
        const status = await page.getByTestId("connection-status").textContent();
        if (status?.includes("Connected") && !status.includes("Disconnected")) return "recovered";
        if (await page.getByRole("button", { name: "Rejoin voice" }).isVisible())
          return "rejoinable";
        return `waiting: ${status}`;
      },
      { timeout: 45_000 },
    )
    .toMatch(/recovered|rejoinable/);

  // If we only got to the rejoinable state, prove rejoin works.
  if (await page.getByRole("button", { name: "Rejoin voice" }).isVisible()) {
    await page.getByRole("button", { name: "Rejoin voice" }).click();
    await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
      timeout: 20_000,
    });
  }

  await ctx.close();
});
