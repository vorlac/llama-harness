import { getList } from "../../config/keys.ts";
import type { Middleware } from "../types.ts";

/**
 * cors.origins has no entry in defaults.ts. The inline default lives here and
 * is ["*"]. It also cannot be set from the environment or the command line,
 * because it is missing from ENV_SETTABLE_KEYS and CLI_SETTABLE_KEYS.
 */
export function corsHeaders(cfg: Record<string, any>): Record<string, string> {
  const origins = getList(cfg, "cors.origins", ["*"]);
  return {
    "access-control-allow-origin": origins.join(","),
    "access-control-allow-headers": "content-type,x-relay-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

export function createCorsMiddleware(cfg: Record<string, any>): Middleware {
  const headers = corsHeaders(cfg);
  return (ctx) => {
    if (ctx.method !== "OPTIONS") return null;
    return { status: 204, headers, body: "" };
  };
}
