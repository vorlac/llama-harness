import { createServer } from "node:http";
import { getNum, getStr } from "../config/keys.ts";
import type { Logger } from "../observability/logger.ts";
import type { Handler, ReqCtx } from "./types.ts";

export interface HttpServerDeps {
  logger?: Logger;
}

export interface HttpServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  readonly port: number;
  readonly host: string;
}

/**
 * The socket-level read cap below reads server.maxBodyBytes with an inline
 * default of 2097152, while middleware/bodyLimit.ts reads the same key with an
 * inline default of 1048576. server.shutdownGraceMs has no entry in
 * defaults.ts at all.
 */
export function createHttpServer(
  cfg: Record<string, any>,
  handler: Handler,
  deps: HttpServerDeps = {},
): HttpServer {
  const host = getStr(cfg, "server.host", "127.0.0.1");
  const configuredPort = getNum(cfg, "server.port", 8080);
  const readCap = getNum(cfg, "server.maxBodyBytes", 2097152);
  const shutdownGraceMs = getNum(cfg, "server.shutdownGraceMs", 5000);
  const logger = deps.logger;

  let boundPort = 0;

  const server = createServer((req: any, res: any) => {
    const chunks: any[] = [];
    let size = 0;
    let aborted = false;

    req.on("data", (chunk: any) => {
      size += chunk.length;
      if (size > readCap) {
        aborted = true;
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "body too large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      const url = new URL(req.url || "/", "http://" + host);
      const headers: Record<string, string> = {};
      for (const name of Object.keys(req.headers)) {
        const value = req.headers[name];
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
      }
      const query: Record<string, string> = {};
      url.searchParams.forEach((value: string, key: string) => { query[key] = value; });

      const ctx: ReqCtx = {
        method: String(req.method || "GET").toUpperCase(),
        path: url.pathname,
        query,
        headers,
        body: Buffer.concat(chunks).toString("utf8"),
        remote: headers["x-forwarded-for"] || String(req.socket.remoteAddress || "unknown"),
      };

      handler(ctx).then(
        (r) => {
          res.writeHead(r.status, r.headers);
          res.end(r.body);
        },
        (err: any) => {
          if (logger !== undefined) logger.error("handler failed", { error: String(err && err.message) });
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        },
      );
    });
  });

  return {
    get port(): number {
      return boundPort;
    },
    get host(): string {
      return host;
    },
    start(): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(configuredPort, host, () => {
          const addr = server.address();
          boundPort = addr !== null && typeof addr === "object" ? addr.port : configuredPort;
          if (logger !== undefined) logger.info("listening", { host, port: boundPort });
          resolve(boundPort);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => { resolve(); }, shutdownGraceMs);
        if (timer !== null && typeof timer.unref === "function") timer.unref();
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
