/**
 * Multi-client soak test toward the Milestone 1 exit gate ("four clients
 * complete a stable one-hour call"). Duration is parameterized so CI can run
 * a short version and release validation can run the full hour:
 *   SOAK_MINUTES=60 npx playwright test soak
 * Every client must remain Connected, seeing all participants, for the whole
 * duration; any reconnect that does not recover fails the test.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const DEV_PASSWORD = process.env.OPENVOICE_DEV_AUTH_PASSWORD ?? "";
const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? "0");
const CLIENTS = 4;
const CHECK_INTERVAL_MS = 15_000;

test.skip(SOAK_MINUTES <= 0, "set SOAK_MINUTES to a positive number to run the soak");
test.skip(DEV_PASSWORD === "", "OPENVOICE_DEV_AUTH_PASSWORD is not set");

test(`${CLIENTS} clients hold a stable ${SOAK_MINUTES}-minute call`, async ({ browser }) => {
  test.setTimeout((SOAK_MINUTES * 60 + 300) * 1000);

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    const ctx = await browser.newContext({ permissions: ["microphone"] });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByLabel("Username").fill(`soak-user-${i + 1}`);
    await page.getByLabel("Development password").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Join voice" }).click();
    await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
      timeout: 20_000,
    });
    contexts.push(ctx);
    pages.push(page);
  }

  // Everyone sees everyone.
  for (const page of pages) {
    for (let i = 0; i < CLIENTS; i++) {
      await expect(page.getByRole("list", { name: "Participants" })).toContainText(
        `soak-user-${i + 1}`,
        { timeout: 20_000 },
      );
    }
  }

  const deadline = Date.now() + SOAK_MINUTES * 60_000;
  let checks = 0;
  while (Date.now() < deadline) {
    await pages[0]!.waitForTimeout(Math.min(CHECK_INTERVAL_MS, deadline - Date.now()));
    for (const [i, page] of pages.entries()) {
      await expect
        .soft(page.getByTestId("connection-status"), `client ${i + 1} at check ${checks}`)
        .toHaveText("Connected");
      const count = await page.getByRole("list", { name: "Participants" }).getByRole("listitem").count();
      expect.soft(count, `client ${i + 1} participant count at check ${checks}`).toBe(CLIENTS);
    }
    checks++;
    expect(test.info().errors, `failures by check ${checks}`).toHaveLength(0);
  }

  // eslint-disable-next-line no-console
  console.log(`soak complete: ${CLIENTS} clients, ${SOAK_MINUTES} min, ${checks} checks`);
  for (const ctx of contexts) await ctx.close();
});
