import { createApiClient } from "@openvoice/api-client";

/** Single API client instance. All requests go through the reverse proxy at
 * the site origin, so the base URL is simply "/". */
export const api = createApiClient("/");
