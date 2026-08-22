export interface ReqCtx {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Header names are lowercased. */
  headers: Record<string, string>;
  body: string;
  remote: string;
}

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Handler = (ctx: ReqCtx) => Promise<Reply>;

/** Returns a Reply to short-circuit, or null to continue down the chain. */
export type Middleware = (ctx: ReqCtx) => Promise<Reply | null> | Reply | null;

export function reply(status: number, body: any, headers: Record<string, string> = {}): Reply {
  if (typeof body === "string") {
    return { status, headers: Object.assign({ "content-type": "text/plain" }, headers), body };
  }
  return {
    status,
    headers: Object.assign({ "content-type": "application/json" }, headers),
    body: JSON.stringify(body),
  };
}
