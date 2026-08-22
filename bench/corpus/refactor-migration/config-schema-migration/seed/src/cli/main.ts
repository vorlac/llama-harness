import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loader.ts";
import { formatIssue } from "../config/issue.ts";
import { CONFIG_KEYS } from "../config/keys.ts";
import { createApp } from "../app.ts";
import { withSpool } from "../storage/spool.ts";
import { RELAY_VERSION } from "../version.ts";

const USAGE = [
  "relay " + RELAY_VERSION,
  "",
  "usage: relay [options]",
  "",
  "  --config <path>          JSON config file (default: ./config/relay.config.json)",
  "  --port, -p <n>           listen port",
  "  --host, -h <addr>        listen address",
  "  --log-level, -l <level>  debug|info|warn|error",
  "  --sink-kind <kind>       null|file|http",
  "  --endpoint <url>         HTTP sink endpoint",
  "  --no-metrics-enabled     turn metrics off",
  "  --check-config           print the effective configuration and exit",
  "  --demo                   start, self-test over the loopback, and exit",
  "  --version                print the version and exit",
  "  --help                   print this message and exit",
].join("\n");

/** Pull --config out of argv before the generic parser sees it. */
function extractConfigPath(argv: string[]): { path: string | null; rest: string[] } {
  const rest: string[] = [];
  let path: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--config") {
      path = argv[i + 1] !== undefined ? argv[i + 1] : null;
      i += 2;
      continue;
    }
    if (arg.indexOf("--config=") === 0) {
      path = arg.slice("--config=".length);
      i += 1;
      continue;
    }
    rest.push(arg);
    i += 1;
  }
  return { path, rest };
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const extracted = extractConfigPath(argv);
  const filePath = extracted.path !== null ? extracted.path : "./config/relay.config.json";
  const result = loadConfig({ filePath, env, argv: extracted.rest });

  if (result.flags["help"]) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (result.flags["version"]) {
    process.stdout.write(RELAY_VERSION + "\n");
    return 0;
  }

  for (const name of result.unknown.cli) {
    process.stderr.write("warning: unrecognised option " + name + "\n");
  }

  if (!result.ok) {
    for (const i of result.issues) process.stderr.write("config error: " + formatIssue(i) + "\n");
    return 2;
  }

  if (result.flags["check-config"]) {
    for (const key of CONFIG_KEYS) {
      const value = result.config[key];
      const source = result.sources[key] !== undefined ? result.sources[key] : "unset";
      process.stdout.write(key + " = " + JSON.stringify(value) + "  (" + source + ")\n");
    }
    return 0;
  }

  const app = createApp(result);
  const port = await app.listen();

  if (result.flags["demo"]) {
    return await withSpool(async (spool) => {
      const base = "http://" + app.config["server.host"] + ":" + String(port);
      const health = await fetch(base + "/healthz");
      process.stdout.write("healthz " + String(health.status) + " " + (await health.text()) + "\n");
      process.stdout.write("sink " + app.sink.name + "\n");
      process.stdout.write("spool enabled=" + String(spool.enabled) + " dir=" + spool.dir + "\n");
      await app.close();
      return 0;
    });
  }

  process.stdout.write("relay listening on " + app.config["server.host"] + ":" + String(port) + "\n");
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2), process.env).then(
    (code: number) => { process.exitCode = code; },
    (err: any) => {
      process.stderr.write("relay: " + String(err && err.message ? err.message : err) + "\n");
      process.exitCode = 1;
    },
  );
}
