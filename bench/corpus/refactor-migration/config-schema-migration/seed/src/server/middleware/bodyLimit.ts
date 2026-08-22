import { getNum } from "../../config/keys.ts";
import type { Middleware } from "../types.ts";
import { reply } from "../types.ts";

/**
 * Rejects oversized bodies. server.maxBodyBytes has no entry in defaults.ts,
 * and httpServer.ts reads the same key with a different inline default
 * (2097152) for its socket-level read cap, so today the in-process limit and
 * the socket limit are 1 MiB and 2 MiB respectively.
 */
export function createBodyLimit(cfg: Record<string, any>): Middleware {
  const maxBodyBytes = getNum(cfg, "server.maxBodyBytes", 1048576);
  return (ctx) => {
    if (ctx.body === "") return null;
    const size = Buffer.byteLength(ctx.body, "utf8");
    if (size > maxBodyBytes) {
      return reply(413, { error: "body too large", limit: maxBodyBytes });
    }
    return null;
  };
}
