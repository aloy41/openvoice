/**
 * Inline media/GIF embeds: pasting a Giphy/image link renders an <img> in
 * chat (client-side; the server never fetches it). We assert the element and
 * its derived src, not that the network image loads.
 */
import { expect, test } from "@playwright/test";

import { createCommunity, registerAndSignIn, uniqueName } from "./helpers";

test("a pasted Giphy/image link renders an inline image", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await registerAndSignIn(page, "gif-user");
  await createCommunity(page, `Gifs ${uniqueName("hub")}`);
  await page.getByRole("button", { name: "Text channel general" }).click();
  await expect(page.getByRole("form", { name: "Send a message" })).toBeVisible();

  // A Giphy share link — the client derives the direct media URL.
  await page.getByPlaceholder(/Message #/).fill("https://giphy.com/gifs/party-time-aBcD1234");
  await page.getByRole("button", { name: "Send" }).click();

  const img = page.getByRole("img", { name: "Shared media" });
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect(img).toHaveAttribute(
    "src",
    "https://media.giphy.com/media/aBcD1234/giphy.gif",
  );
  await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(img).toHaveAttribute("loading", "lazy");

  // A plain (non-image) link does NOT embed — just a normal link.
  await page.getByPlaceholder(/Message #/).fill("read https://news.example.com/story");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("link", { name: "https://news.example.com/story" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Shared media" })).toHaveCount(1);

  await ctx.close();
});
