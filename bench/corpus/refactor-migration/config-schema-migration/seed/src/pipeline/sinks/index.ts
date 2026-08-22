import { getStr } from "../../config/keys.ts";
import type { Sink } from "./types.ts";
import { createNullSink } from "./nullSink.ts";
import { createFileSink } from "./fileSink.ts";
import { createHttpSink } from "./httpSink.ts";
import type { HttpSinkDeps } from "./httpSink.ts";

export type { Sink } from "./types.ts";
export { createNullSink } from "./nullSink.ts";
export { createFileSink } from "./fileSink.ts";
export { createHttpSink } from "./httpSink.ts";

export function createSink(cfg: Record<string, any>, deps: HttpSinkDeps = {}): Sink {
  const kind = getStr(cfg, "sink.kind", "null");
  if (kind === "file") return createFileSink(cfg);
  if (kind === "http") return createHttpSink(cfg, deps);
  // Anything unrecognised quietly becomes the null sink. Nothing is logged.
  return createNullSink();
}
