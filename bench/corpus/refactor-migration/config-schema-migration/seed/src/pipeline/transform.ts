import { getList } from "../config/keys.ts";

export const REDACTED = "[redacted]";

/**
 * Drops top-level fields and redacts matching keys at any depth.
 *
 * The inline fallback for transform.redactKeys here is ["password"], which is
 * not what defaults.ts says.
 */
export function applyTransform(record: any, cfg: Record<string, any>): any {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;

  const drop = getList(cfg, "transform.dropFields", []);
  const redact = getList(cfg, "transform.redactKeys", ["password"]);
  const redactLower = redact.map((k: string) => k.toLowerCase());

  const redactDeep = (value: any): any => {
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value === null || typeof value !== "object") return value;
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) {
      if (redactLower.indexOf(k.toLowerCase()) >= 0) {
        out[k] = REDACTED;
      } else {
        out[k] = redactDeep(value[k]);
      }
    }
    return out;
  };

  const out: Record<string, any> = {};
  for (const k of Object.keys(record)) {
    if (drop.indexOf(k) >= 0) continue;
    if (redactLower.indexOf(k.toLowerCase()) >= 0) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redactDeep(record[k]);
  }
  return out;
}
