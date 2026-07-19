/**
 * Automated accessibility checks (axe-core) for every screen of the current
 * slice: auth, pre-join, and in-call. WCAG 2.1 A/AA rulesets. These are a
 * floor, not a ceiling — manual keyboard/screen-reader passes are still part
 * of the release checklist.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { joinVoice, registerAndSignIn } from "./helpers";

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

test("auth screen (sign in and create account) has no axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expectNoViolations(page, "sign-in");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await expectNoViolations(page, "create-account");
});

test("pre-join and in-call screens have no axe violations", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  await registerAndSignIn(page, "a11y");
  await expectNoViolations(page, "pre-join");

  await joinVoice(page);
  await expect(page.getByRole("list", { name: "Participants" })).toBeVisible();
  await expectNoViolations(page, "in-call");
  await ctx.close();
});
