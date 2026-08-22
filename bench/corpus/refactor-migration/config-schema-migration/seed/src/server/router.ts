import { getStr } from "../config/keys.ts";
import type { Batcher } from "../pipeline/batcher.ts";
import { applyTransform } from "../pipeline/transform.ts";
import type { Logger } from "../observability/logger.ts";
import type { Metrics } from "../observability/metrics.ts";
import { RELAY_VERSION } from "../version.ts";
import type { Handler } from "./types.ts";
import { reply } from "./types.ts";
import { withAuth } from "./middleware/auth.ts";

export interface RouterDeps {
  cfg: Record<string, any>;
  batcher: Batcher;
  metrics: Metrics;
  logger: Logger;
}

export function createRouter(deps: RouterDeps): Handler {
  const cfg = deps.cfg;

  const ingest: Handler = async (ctx) => {
    let parsed: any = null;
    try {
      parsed = ctx.body === "" ? null : JSON.parse(ctx.body);
    } catch (err: any) {
      return reply(400, { error: "invalid JSON body" });
    }
    if (parsed === null) return reply(400, { error: "empty body" });

    const records: any[] = Array.isArray(parsed) ? parsed : [parsed];
    let accepted = 0;
    for (const record of records) {
      const transformed = applyTransform(record, cfg);
      await deps.batcher.push(transformed);
      accepted += 1;
    }
    deps.metrics.inc("records_accepted", accepted);
    deps.logger.debug("accepted records", { count: accepted });
    return reply(202, { accepted });
  };

  // The decorator captures configuration at wrap time, right here.
  const authedIngest = withAuth(ingest);

  return async (ctx) => {
    if (ctx.method === "GET" && ctx.path === "/healthz") {
      return reply(200, {
        status: "ok",
        version: RELAY_VERSION,
        sink: getStr(cfg, "sink.kind", "null"),
      });
    }
    if (ctx.method === "GET" && ctx.path === "/metrics") {
      if (!deps.metrics.enabled) return reply(404, { error: "metrics are disabled" });
      return reply(200, deps.metrics.render());
    }
    if (ctx.method === "POST" && ctx.path === "/ingest") {
      return authedIngest(ctx);
    }
    return reply(404, { error: "no route for " + ctx.method + " " + ctx.path });
  };
}
