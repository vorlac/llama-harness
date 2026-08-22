import type { Sink } from "./types.ts";

/** Discards everything. The default sink, and what the tests use most. */
export function createNullSink(): Sink & { written: any[] } {
  const written: any[] = [];
  return {
    name: "null",
    written,
    async write(records: any[]): Promise<number> {
      for (const r of records) written.push(r);
      return records.length;
    },
    async close(): Promise<void> {
      return;
    },
  };
}
