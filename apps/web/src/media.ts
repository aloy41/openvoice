/**
 * Inline media embeds for chat messages.
 *
 * Security/privacy posture (deliberate):
 * - Embeds are rendered CLIENT-SIDE (`<img src>`). The server never fetches
 *   the URL, so there is no SSRF surface (threat model: no server-side link
 *   fetching). Loading a remote image does reveal the viewer's IP to the
 *   image host — inherent to any image embed — so we only auto-embed https
 *   image files and a small allowlist of well-known GIF hosts, not arbitrary
 *   hosts, and always with referrerPolicy="no-referrer".
 * - Production deployments must include these hosts in the CSP `img-src`.
 */

const IMAGE_EXT = /\.(gif|png|jpe?g|webp|avif)(?:[?#]|$)/i;

// Direct-media hosts we trust to serve images/GIFs.
const MEDIA_HOSTS = new Set([
  "media.giphy.com",
  "media0.giphy.com",
  "media1.giphy.com",
  "media2.giphy.com",
  "media3.giphy.com",
  "media4.giphy.com",
  "i.giphy.com",
  "media.tenor.com",
  "c.tenor.com",
]);

/** Return a directly-embeddable image URL for `raw`, or null if it isn't one
 * we will inline. Handles Giphy share/page links by deriving the media URL. */
export function toEmbeddableImage(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // https only: avoids mixed-content and non-web schemes (javascript:, data:).
  if (url.protocol !== "https:") return null;

  if (MEDIA_HOSTS.has(url.hostname)) return url.toString();
  if (IMAGE_EXT.test(url.pathname)) return url.toString();

  // Giphy share/page/embed links → direct media URL derived from the id.
  if (url.hostname === "giphy.com" || url.hostname === "www.giphy.com") {
    const m = url.pathname.match(/\/(?:gifs|embed|clips)\/(?:.*-)?([A-Za-z0-9]{6,})\/?$/);
    if (m) return `https://media.giphy.com/media/${m[1]}/giphy.gif`;
  }
  return null;
}

/** Embeddable image URLs found in `text` (deduped, capped). */
export function extractEmbeds(text: string, max = 4): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(https?:\/\/[^\s<]+)/g)) {
    const src = toEmbeddableImage(m[0]);
    if (src && !out.includes(src)) out.push(src);
    if (out.length >= max) break;
  }
  return out;
}

/** True when the whole message is a single embeddable URL (so we can show
 * just the image and hide the raw link text). */
export function isOnlyEmbed(text: string): boolean {
  const t = text.trim();
  return !/\s/.test(t) && toEmbeddableImage(t) !== null;
}
