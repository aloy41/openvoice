import { createApiClient } from "@openvoice/api-client";

/** Single API client instance. All requests go through the reverse proxy at
 * the site origin, so the base URL is simply "/" and session cookies are
 * sent automatically (same-origin). */
export const api = createApiClient("/");

function readCookie(name: string): string | null {
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Double-submit CSRF: echo the ov_csrf cookie (set by the API on any
// response) on every state-changing request.
api.use({
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method)) {
      const token = readCookie("ov_csrf");
      if (token) request.headers.set("x-csrf-token", token);
    }
    return request;
  },
});
