/**
 * Typed API client generated from the backend OpenAPI contract.
 *
 * `schema.d.ts` is GENERATED from `apps/api/openapi.json` — never edit it or
 * hand-write duplicate request/response types. Regenerate with:
 *   npm run generate -w packages/api-client
 * CI fails on drift between the API code, the committed schema, and this
 * package.
 */
import createClient from "openapi-fetch";

import type { paths } from "./schema";

export type { components, paths } from "./schema";

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(baseUrl: string = "/") {
  return createClient<paths>({ baseUrl });
}

/** Structured error body returned by every API error response. */
export interface ApiErrorBody {
  code: string;
  message: string;
  request_id?: string;
  field_errors?: Array<{ loc: (string | number)[]; msg: string; type: string }>;
}
