import { getBool, getStr, LOG_LEVELS } from "../config/keys.ts";
import { getCurrentConfig } from "../config/current.ts";

export interface LogFields {
  [key: string]: any;
}

export interface Logger {
  level: string;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const RANK: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const ESC = String.fromCharCode(27);
const CYAN = ESC + "[36m";
const RESET = ESC + "[0m";

/**
 * When no config bag is passed, the process-global one is used. The inline
 * fallback level here is "warn", which is not what defaults.ts says.
 */
export function createLogger(
  cfg?: Record<string, any>,
  write?: (line: string) => void,
): Logger {
  const config = cfg !== undefined ? cfg : getCurrentConfig();
  let level = getStr(config, "log.level", "warn");
  if (LOG_LEVELS.indexOf(level) < 0) level = "warn";
  const format = getStr(config, "log.format", "text");
  const color = getBool(config, "log.color", false);
  const out = write !== undefined ? write : (line: string) => { process.stderr.write(line + "\n"); };

  const emit = (lvl: string, msg: string, fields?: LogFields): void => {
    if (RANK[lvl] < RANK[level]) return;
    if (format === "json") {
      const payload: Record<string, any> = { level: lvl, msg };
      if (fields !== undefined) {
        for (const k of Object.keys(fields)) payload[k] = fields[k];
      }
      out(JSON.stringify(payload));
      return;
    }
    let line = lvl.toUpperCase() + " " + msg;
    if (fields !== undefined) {
      for (const k of Object.keys(fields)) line += " " + k + "=" + String(fields[k]);
    }
    if (color) line = CYAN + line + RESET;
    out(line);
  };

  return {
    level,
    debug: (m: string, f?: LogFields) => emit("debug", m, f),
    info: (m: string, f?: LogFields) => emit("info", m, f),
    warn: (m: string, f?: LogFields) => emit("warn", m, f),
    error: (m: string, f?: LogFields) => emit("error", m, f),
  };
}
