import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getBool, getStr } from "../config/keys.ts";
import { getCurrentConfig } from "../config/current.ts";

export interface Spool {
  readonly enabled: boolean;
  readonly dir: string;
  readonly maxBytes: number;
  bytes: number;
  /** Returns false when the write was refused because the spool is full. */
  append(name: string, data: string): boolean;
  files(): string[];
}

/**
 * Scoped resource: opens the on-disk spool, hands it to fn, and tears it down
 * afterwards. The teardown removes the directory only if it is empty, so a
 * spool that actually buffered something survives a restart.
 *
 * It reads the process-global config rather than taking one, so it cannot be
 * used before setCurrentConfig has run. maxBytes is resolved with `||`, which
 * means an explicitly configured 0 silently becomes 10485760.
 */
export async function withSpool<T>(fn: (spool: Spool) => Promise<T>): Promise<T> {
  const cfg = getCurrentConfig();
  const enabled = getBool(cfg, "spool.enabled", false);
  const dir = getStr(cfg, "spool.dir", "./.relay-spool");
  const maxBytes = Number(cfg["spool.maxBytes"]) || 10485760;

  let created = false;
  if (enabled && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    created = true;
  }

  const spool: Spool = {
    enabled,
    dir,
    maxBytes,
    bytes: 0,
    append(name: string, data: string): boolean {
      if (!enabled) return false;
      const size = Buffer.byteLength(data, "utf8");
      if (spool.bytes + size > maxBytes) return false;
      appendFileSync(join(dir, name), data, "utf8");
      spool.bytes += size;
      return true;
    },
    files(): string[] {
      if (!enabled || !existsSync(dir)) return [];
      return readdirSync(dir).sort();
    },
  };

  try {
    return await fn(spool);
  } finally {
    if (enabled && existsSync(dir) && statSync(dir).isDirectory()) {
      if (readdirSync(dir).length === 0 && created) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}
