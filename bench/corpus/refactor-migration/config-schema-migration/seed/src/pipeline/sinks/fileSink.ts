import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { getStr } from "../../config/keys.ts";
import type { Sink } from "./types.ts";

/**
 * Appends NDJSON.
 *
 * sink.file.rotateBytes has no entry in defaults.ts; the inline default here is
 * 0, which this module reads as "never rotate". It tests for undefined rather
 * than using ||, so an explicit 0 survives, unlike storage/spool.ts.
 */
export function createFileSink(cfg: Record<string, any>): Sink {
  const path = getStr(cfg, "sink.file.path", "./relay-out.ndjson");
  const rotateBytes = cfg["sink.file.rotateBytes"] !== undefined
    ? Number(cfg["sink.file.rotateBytes"])
    : 0;

  const dir = dirname(path);
  if (dir !== "" && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const maybeRotate = (): void => {
    if (rotateBytes <= 0) return;
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size < rotateBytes) return;
    renameSync(path, path + ".1");
  };

  return {
    name: "file",
    async write(records: any[]): Promise<number> {
      if (records.length === 0) return 0;
      maybeRotate();
      let payload = "";
      for (const r of records) payload += JSON.stringify(r) + "\n";
      appendFileSync(path, payload, "utf8");
      return records.length;
    },
    async close(): Promise<void> {
      return;
    },
  };
}
