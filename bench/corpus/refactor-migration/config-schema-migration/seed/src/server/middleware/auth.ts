import { getBool, getList, getStr } from "../../config/keys.ts";
import { getCurrentConfig } from "../../config/current.ts";
import type { Handler } from "../types.ts";
import { reply } from "../types.ts";

/**
 * Wraps a handler in token authentication.
 *
 * This is the awkward one. It is a decorator: it reads the process-global
 * config once, at wrap time, and closes over the result. Whatever the config
 * said when the route table was built is what the route enforces forever.
 *
 * auth.headerName has no entry in defaults.ts; the inline default is here.
 */
export function withAuth(next: Handler): Handler {
  const cfg = getCurrentConfig();
  const required = getBool(cfg, "auth.required", true);
  const headerName = getStr(cfg, "auth.headerName", "x-relay-token").toLowerCase();
  const tokens = getList(cfg, "auth.tokens", []);

  return async (ctx) => {
    if (!required) return next(ctx);
    const presented = ctx.headers[headerName];
    if (presented === undefined || presented === "") {
      return reply(401, { error: "missing " + headerName });
    }
    if (tokens.indexOf(presented) < 0) {
      return reply(401, { error: "invalid token" });
    }
    return next(ctx);
  };
}
