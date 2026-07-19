import { describe, expect, it } from "vitest";

import { extractEmbeds, isOnlyEmbed, toEmbeddableImage } from "../media";

describe("toEmbeddableImage", () => {
  it("embeds direct image/GIF files over https", () => {
    expect(toEmbeddableImage("https://example.com/cat.gif")).toBe("https://example.com/cat.gif");
    expect(toEmbeddableImage("https://x.io/a/b.png?v=2")).toBe("https://x.io/a/b.png?v=2");
    expect(toEmbeddableImage("https://x.io/pic.WEBP")).toBe("https://x.io/pic.WEBP");
  });

  it("embeds known Giphy/Tenor media hosts", () => {
    const g = "https://media.giphy.com/media/abc123/giphy.gif";
    expect(toEmbeddableImage(g)).toBe(g);
    const t = "https://c.tenor.com/xyz/tenor.gif";
    expect(toEmbeddableImage(t)).toBe(t);
  });

  it("derives the media URL from a Giphy share/page link", () => {
    expect(toEmbeddableImage("https://giphy.com/gifs/funny-cat-aBcD1234")).toBe(
      "https://media.giphy.com/media/aBcD1234/giphy.gif",
    );
    expect(toEmbeddableImage("https://giphy.com/embed/aBcD1234")).toBe(
      "https://media.giphy.com/media/aBcD1234/giphy.gif",
    );
  });

  it("refuses non-image pages, http, and dangerous schemes", () => {
    expect(toEmbeddableImage("https://example.com/article")).toBeNull();
    expect(toEmbeddableImage("http://example.com/cat.gif")).toBeNull(); // not https
    expect(toEmbeddableImage("javascript:alert(1)")).toBeNull();
    expect(toEmbeddableImage("data:image/gif;base64,AAAA")).toBeNull();
    expect(toEmbeddableImage("not a url")).toBeNull();
  });
});

describe("extractEmbeds / isOnlyEmbed", () => {
  it("finds and dedupes embeddable URLs in a message", () => {
    const text = "look https://x.io/a.gif and https://x.io/a.gif and https://x.io/b.png";
    expect(extractEmbeds(text)).toEqual(["https://x.io/a.gif", "https://x.io/b.png"]);
  });

  it("ignores non-embeddable links", () => {
    expect(extractEmbeds("see https://news.example.com/story")).toEqual([]);
  });

  it("detects a message that is only an embeddable URL", () => {
    expect(isOnlyEmbed("  https://media.giphy.com/media/abc123/giphy.gif  ")).toBe(true);
    expect(isOnlyEmbed("nice https://x.io/a.gif")).toBe(false);
    expect(isOnlyEmbed("just text")).toBe(false);
  });
});
