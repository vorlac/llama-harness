// Vendored ambient declarations for the Node builtins this project uses.
//
// The project has no node_modules and no network access, so @types/node is not
// available. These declarations exist for one reason only: so that `tsc` can be
// run over the tree without resolving external packages. They are deliberately
// loose (`any`), because the type safety this project cares about is the shape
// of its *configuration*, not the shape of Node's stdlib.
//
// Do not "fix" a config type error by weakening something here.

declare module "node:http" {
  const http: any;
  export default http;
  export const createServer: any;
  export const request: any;
  export type IncomingMessage = any;
  export type ServerResponse = any;
  export type Server = any;
}

declare module "node:fs" {
  const fs: any;
  export default fs;
  export const existsSync: any;
  export const mkdirSync: any;
  export const readFileSync: any;
  export const writeFileSync: any;
  export const appendFileSync: any;
  export const statSync: any;
  export const rmSync: any;
  export const renameSync: any;
  export const readdirSync: any;
  export const mkdtempSync: any;
}

declare module "node:path" {
  const path: any;
  export default path;
  export const join: any;
  export const resolve: any;
  export const dirname: any;
  export const basename: any;
  export const extname: any;
  export const sep: string;
}

declare module "node:os" {
  const os: any;
  export default os;
  export const tmpdir: any;
  export const hostname: any;
}

declare module "node:url" {
  const url: any;
  export default url;
  export const fileURLToPath: any;
  export const pathToFileURL: any;
}

declare module "node:events" {
  const events: any;
  export default events;
  export const EventEmitter: any;
  export const once: any;
}

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:test" {
  const test: any;
  export default test;
  export const describe: any;
  export const it: any;
  export const before: any;
  export const after: any;
  export const beforeEach: any;
  export const afterEach: any;
}

declare module "node:timers/promises" {
  export const setTimeout: any;
}

declare var process: any;
declare var console: any;
declare var Buffer: any;
declare var fetch: any;
declare var AbortController: any;
declare var AbortSignal: any;
declare var URL: any;
declare var URLSearchParams: any;
declare var setTimeout: any;
declare var clearTimeout: any;
declare var setInterval: any;
declare var clearInterval: any;
declare var structuredClone: any;
declare var globalThis: any;

interface ImportMeta {
  url: string;
}
