import { readFileSync, existsSync } from "node:fs";
import type { ConfigIssue } from "./issue.ts";
import { issue } from "./issue.ts";

export interface FileLayer {
  values: Record<string, any>;
  issues: ConfigIssue[];
  /** Keys present in the file that no module is known to read. Ignored today. */
  unknown: string[];
}

/**
 * Flatten a nested config object into dotted keys. Arrays are values, not
 * containers, so they are not descended into. Keys that already contain a dot
 * are passed through unchanged, which is how a file may mix both styles:
 *
 *   { "server": { "port": 9000 }, "log.level": "warn" }
 */
export function flattenConfigObject(obj: any, prefix: string = ""): Record<string, any> {
  const out: Record<string, any> = {};
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const rawKey of Object.keys(obj)) {
    const value = obj[rawKey];
    const key = prefix === "" ? rawKey : prefix + "." + rawKey;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenConfigObject(value, key);
      for (const k of Object.keys(nested)) out[k] = nested[k];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Turn an already-parsed JSON object into a config layer. */
export function fileLayerFromObject(obj: any, knownKeys: string[]): FileLayer {
  const issues: ConfigIssue[] = [];
  const unknown: string[] = [];
  if (obj === null || obj === undefined) {
    return { values: {}, issues, unknown };
  }
  if (typeof obj !== "object" || Array.isArray(obj)) {
    issues.push(issue("file", "<root>", "config file must contain a JSON object"));
    return { values: {}, issues, unknown };
  }
  const flat = flattenConfigObject(obj);
  const values: Record<string, any> = {};
  for (const key of Object.keys(flat)) {
    if (knownKeys.indexOf(key) < 0) {
      // Silently tolerated. Forward-compatible config files rely on this.
      unknown.push(key);
      continue;
    }
    values[key] = flat[key];
  }
  return { values, issues, unknown };
}

/** Read a JSON config file from disk. A missing file is not an error. */
export function readConfigFile(path: string, knownKeys: string[]): FileLayer {
  if (!existsSync(path)) {
    return { values: {}, issues: [], unknown: [] };
  }
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch (err: any) {
    return {
      values: {},
      issues: [issue("file", "<root>", "cannot read " + path + ": " + String(err && err.message))],
      unknown: [],
    };
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    return {
      values: {},
      issues: [issue("file", "<root>", "invalid JSON in " + path + ": " + String(err && err.message))],
      unknown: [],
    };
  }
  return fileLayerFromObject(parsed, knownKeys);
}
