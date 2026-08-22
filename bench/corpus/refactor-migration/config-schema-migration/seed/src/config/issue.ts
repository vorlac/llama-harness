// The one piece of structured error reporting the pre-migration loader has.
// Only three checks in loader.ts produce these today; everything else fails
// silently or coerces to a fallback.

export interface ConfigIssue {
  /** Where the offending value came from: "cli" | "env" | "file" | "default" | "override". */
  source: string;
  /** Canonical dotted key, e.g. "server.port". */
  key: string;
  /** Human-readable explanation. */
  message: string;
}

export function issue(source: string, key: string, message: string): ConfigIssue {
  return { source, key, message };
}

export function formatIssue(i: ConfigIssue): string {
  return i.source + ":" + i.key + ": " + i.message;
}
