/**
 * Per-device identity: a browser registers exactly one device on sign-in and
 * can view/revoke devices. The private key lives in IndexedDB and is never
 * transmitted — we assert the registration payload carries only a public key.
 */
import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers";

test("a browser registers one device and can open the devices panel", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Capture the device-registration request to prove no private key is sent.
  const registrations: Array<Record<string, unknown>> = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/devices") && req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      registrations.push(body);
    }
  });

  await registerAndSignIn(page, "dev-user");

  // Registration happened with a public key only — no "private" field.
  await expect.poll(() => registrations.length).toBeGreaterThan(0);
  const reg = registrations[0]!;
  expect(reg.public_key).toBeTruthy();
  expect(reg.key_type).toBe("ecdsa-p256");
  expect(JSON.stringify(reg).toLowerCase()).not.toContain("private");

  await page.getByRole("button", { name: "Devices" }).click();
  const dialog = page.getByRole("dialog", { name: "Your devices" });
  await expect(dialog).toBeVisible();
  const list = dialog.getByRole("list", { name: "Devices" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("This device");

  // Escape closes the dialog.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  await ctx.close();
});

test("the device key persists across reloads (same device, not a new one)", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await registerAndSignIn(page, "persist-user");

  await page.getByRole("button", { name: "Devices" }).click();
  await expect(
    page.getByRole("dialog", { name: "Your devices" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Reload: the IndexedDB keypair is reused, so still exactly one device.
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit your profile" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Devices" }).click();
  await expect(
    page.getByRole("dialog", { name: "Your devices" }).getByRole("listitem"),
  ).toHaveCount(1);

  await ctx.close();
});
