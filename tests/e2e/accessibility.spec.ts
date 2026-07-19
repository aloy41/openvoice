/**
 * Automated accessibility checks (axe-core) for every screen of the current
 * slice: login, pre-join, and in-call. WCAG 2.1 A/AA rulesets. These are a
 * floor, not a ceiling — manual keyboard/screen-reader passes are still part
 * of the release checklist.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEV_PASSWORD = process.env.OPENVOICE_DEV_AUTH_PASSWORD ?? "";

test.skip(DEV_PASSWORD === "", "OPENVOICE_DEV_AUTH_PASSWORD is not set");

async function expectNoViolations(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Development password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Join voice" })).toBeVisible({
    timeout: 10_000,
  });
}

test("login screen has no axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expectNoViolations(page, "login");
});

test("pre-join and in-call screens have no axe violations", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await signIn(page, "a11y-user");
  await expectNoViolations(page, "pre-join");

  await page.getByRole("button", { name: "Join voice" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", {
    timeout: 20_000,
  });
  await expect(page.getByRole("list", { name: "Participants" })).toBeVisible();
  await expectNoViolations(page, "in-call");
  await ctx.close();
});
