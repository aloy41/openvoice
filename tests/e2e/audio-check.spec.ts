/**
 * Audio feedback regression tests.
 *
 * The mic test must show a live input level (Chromium's fake capture file is
 * a 440 Hz tone) and must KEEP running after first use — granting permission
 * refreshes the device list and changes the selected device id, which
 * previously self-stopped the test and made it look like the mic was dead.
 */
import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

test("mic test shows a live level and survives the permission-grant device refresh", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await registerAndSignIn(page, "audio-a");

  await page.getByRole("button", { name: "Test microphone" }).click();

  const meter = page.getByRole("meter", { name: "Microphone input level" });
  await expect
    .poll(async () => Number(await meter.getAttribute("aria-valuenow")), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Regression: the test must still be running (not self-stopped) well after
  // the device-list refresh that follows the permission grant.
  await page.waitForTimeout(2000);
  await expect(page.getByRole("button", { name: "Stop mic test" })).toBeVisible();
  await expect
    .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Stop mic test" }).click();
  await expect(page.getByRole("button", { name: "Test microphone" })).toBeVisible();
  await ctx.close();
});

test("output test plays a chime without error", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await registerAndSignIn(page, "audio-b");

  await page.getByRole("button", { name: "Play test sound" }).click();
  // The chime lasts ~0.8 s; the button re-enables when it finishes and no
  // error alert may appear.
  await expect(page.getByRole("button", { name: "Play test sound" })).toBeEnabled({
    timeout: 5_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await ctx.close();
});
