// conductor/tools/g5-equivalence.ts — the G5 equivalence driver (plan 2884-2888).
//
// "Run Task 13.1's scripted e2e twice — once with the router in the loop, once
// with --no-router — and assert the same terminal state, the same item
// dispositions, and the same commit set."
//
// This is the WITH arm's home, and it is a driver rather than a test on purpose
// (G5-SG-1): it starts a real C++ llama-router, and conductor/tests/*.test.ts
// must keep running in a fresh worktree that has no submodules and no built
// binary. The WITHOUT arm needs neither, so it also lives in the node suite as
// [13.1-router-absent-fail-soft]; here it is run again as the second half of the
// pair so the two arms are measured under one comparison.
//
// WHAT MAKES THE TWO ARMS TWO ARMS. conductor_report takes Task 7.2's
// fetchMetricsSummary as its `metrics` input and e2e.test.ts now passes the real
// one, aimed at CONDUCTOR_E2E_ROUTER_PORT. With the router up, a real
// MetricsSummary crosses a real socket into every report; with nothing
// listening, the same unstubbed call returns null and the report says so. That
// is the only difference between the arms, it is a difference the code reads,
// and it is the reason the three compared facts are worth comparing at all.
//
// WHAT IS COMPARED, and it is exactly the plan's three (G5-SG-2): terminal
// state, item dispositions, commit set. The metrics section is NOT compared —
// it is the half that must differ.
//
//   node conductor/tools/g5-equivalence.ts [--port 8391] [--upstream-port 8399]
//        [--router-bin .out/build/clang-relwdebinfo/llama-router]
//        [--artifact docs/build/artifacts/12.1-g5-equivalence.md]
//
// It starts one process, kills it before it exits, and writes nothing outside
// the artifact and its own temp dir. It never starts a model and never needs
// one: llama-router serves /conductor/health and /conductor/metrics from its own
// state, and requests it cannot forward become the 502s this driver seeds it
// with deliberately.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { checkG5Artifact, G5_MARKERS } from "./g5-artifact-check.ts";

interface Disposition {
  id: string;
  state: string;
  blocked: boolean;
  deferred: boolean;
}

interface ScenarioFacts {
  scenario: string;
  seam: string;
  terminalState: string;
  dispositions: Disposition[];
  commitSet: string[];
  commitCount: number;
  metricsAvailable: boolean | null;
  metricsSummary: Record<string, unknown> | null;
}

interface ArmFacts {
  seamPortFromEnv: string | null;
  seamHost: string;
  seamPort: number;
  seamCalls: Array<{ port: number; available: boolean }>;
  scenarios: ScenarioFacts[];
}

interface ArmRun {
  label: string;
  command: string;
  exitCode: number;
  tapTrailer: string;
  facts: ArmFacts;
}

interface HttpResult {
  status: number;
  body: string;
}

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf("--" + name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1] ?? fallback;
  return fallback;
}

function http(
  method: string,
  port: number,
  pathName: string,
  body?: string,
  timeoutMs = 4000,
): Promise<HttpResult | null> {
  return new Promise<HttpResult | null>((resolve) => {
    let settled = false;
    const finish = (value: HttpResult | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: pathName,
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => finish(null));
      },
    );
    req.on("error", () => finish(null));
    const timer = setTimeout(() => {
      req.destroy();
      finish(null);
    }, timeoutMs);
    timer.unref();
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function canonical(value: Record<string, unknown> | null): string {
  if (value === null) return "null";
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

function tapTrailerOf(output: string): string {
  return output
    .split("\n")
    .filter((line) => /^# (tests|pass|fail|cancelled|skipped|todo) /.test(line))
    .join(" | ");
}

function quoteCommand(env: Array<[string, string]>, argv: string[]): string {
  return [...env.map(([k, v]) => `${k}=${v}`), ...argv].join(" ");
}

let router: ChildProcess | null = null;
function stopRouter(): void {
  if (router === null) return;
  const proc = router;
  router = null;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}
process.on("exit", stopRouter);

async function main(): Promise<number> {
  const repoRoot = process.cwd();
  const routerPort = Number.parseInt(arg("port", "8391"), 10);
  const upstreamPort = Number.parseInt(arg("upstream-port", "8399"), 10);
  const routerBin = path.resolve(repoRoot, arg("router-bin", ".out/build/clang-relwdebinfo/llama-router"));
  const schemaPath = path.resolve(repoRoot, arg("schema", "router/tests/schemas/RouterConfig.schema.json"));
  const artifactPath = path.resolve(repoRoot, arg("artifact", "docs/build/artifacts/12.1-g5-equivalence.md"));
  const e2ePath = "conductor/tests/e2e.test.ts";

  const say = (line: string): void => {
    process.stdout.write(line + "\n");
  };

  if (!existsSync(routerBin)) {
    say(`FAIL: no llama-router binary at ${routerBin} — build it, or pass --router-bin`);
    return 1;
  }
  if (!existsSync(schemaPath)) {
    say(`FAIL: no RouterConfig schema at ${schemaPath}`);
    return 1;
  }

  // The router must be OURS. A port already answering is someone else's process,
  // and killing it is not this driver's business.
  for (const port of [routerPort, upstreamPort]) {
    const probe = await http("GET", port, "/conductor/health", undefined, 1000);
    if (probe !== null) {
      say(`FAIL: something is already listening on 127.0.0.1:${String(port)} — choose another port`);
      return 1;
    }
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "g5-equivalence-"));
  const configPath = path.join(workDir, "router.json");
  const ledgerPath = path.join(workDir, "metrics.jsonl");
  const withFactsPath = path.join(workDir, "facts-with-router.json");
  const withoutFactsPath = path.join(workDir, "facts-without-router.json");

  // The upstream port is deliberately DEAD: this driver forwards no model
  // traffic and wants none. What it wants is for the router to have a state of
  // its own that could not have come from anywhere else, and a request the
  // router answers 502 is recorded on its ledger exactly like one it relays.
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: 1,
        listen: { host: "127.0.0.1", port: routerPort },
        upstream: { host: "127.0.0.1", port: upstreamPort },
        admission: { maxInflightPerModel: 2, maxQueued: 8, queueTimeoutMs: 1000 },
        priorities: { interactive: 0, review: 1, batch: 2 },
        affinity: { header: "X-Conductor-Group", contiguousDequeue: true },
        schema: { observeHeader: "X-Conductor-Schema", validateResponses: false, rejectOnMissing: false },
        metrics: { ledgerPath },
        logging: { level: "info" },
      },
      null,
      2,
    ) + "\n",
  );

  const routerArgv = [routerBin, "--config", configPath, "--schema", schemaPath];
  say("== G5 equivalence driver ==");
  say(`repo root: ${repoRoot}`);
  say(`router:    ${routerArgv.join(" ")}`);

  const routerLog: string[] = [];
  router = spawn(routerArgv[0] ?? "", routerArgv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  router.stdout?.on("data", (c: Buffer) => routerLog.push(c.toString("utf8")));
  router.stderr?.on("data", (c: Buffer) => routerLog.push(c.toString("utf8")));
  const routerPid = router.pid ?? -1;
  let routerExit: number | null = null;
  router.on("exit", (code) => {
    routerExit = code;
  });

  const failures: string[] = [];
  let armWith: ArmRun | null = null;
  let armWithout: ArmRun | null = null;
  let seededRequests = 0;
  let ledgerRows = 0;
  let fingerprint: Record<string, unknown> | null = null;
  let afterArmSummary: Record<string, unknown> | null = null;
  let healthBody = "";

  const runArm = (label: string, extraEnv: Array<[string, string]>, factsPath: string): ArmRun => {
    const argv = [process.execPath, "--test", "--test-reporter=tap", e2ePath];
    const command = quoteCommand(extraEnv, argv);
    say("");
    say(`-- ${label} --`);
    say(`$ ${command}`);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env["CONDUCTOR_E2E_ROUTER_PORT"];
    delete env["CONDUCTOR_E2E_FACTS"];
    for (const [k, v] of extraEnv) env[k] = v;
    const res = spawnSync(argv[0] ?? "", argv.slice(1), {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    const output = (res.stdout ?? "") + (res.stderr ?? "");
    const trailer = tapTrailerOf(output);
    say(`exit=${String(res.status)}  ${trailer}`);
    if (res.status !== 0) {
      failures.push(`${label}: the e2e exited ${String(res.status)}`);
      say(output.split("\n").filter((l) => !l.startsWith("ok ")).slice(-25).join("\n"));
    }
    if (!existsSync(factsPath)) {
      failures.push(`${label}: the run wrote no facts file at ${factsPath}`);
      return {
        label,
        command,
        exitCode: res.status ?? -1,
        tapTrailer: trailer,
        facts: { seamPortFromEnv: null, seamHost: "", seamPort: -1, seamCalls: [], scenarios: [] },
      };
    }
    const facts = JSON.parse(readFileSync(factsPath, "utf8")) as ArmFacts;
    return { label, command, exitCode: res.status ?? -1, tapTrailer: trailer, facts };
  };

  try {
    // ---- the router is really up, and it is really ours ---------------------
    let health: HttpResult | null = null;
    for (let i = 0; i < 60 && health === null; i += 1) {
      await sleep(250);
      if (routerExit !== null) break;
      health = await http("GET", routerPort, "/conductor/health", undefined, 1000);
    }
    if (health === null || health.status !== 200) {
      say(`FAIL: llama-router did not serve /conductor/health on ${String(routerPort)}`);
      say(`router exit=${String(routerExit)}; output:\n${routerLog.join("")}`);
      return 1;
    }
    healthBody = health.body.trim();
    say(`router pid ${String(routerPid)} healthy: ${healthBody}`);

    // ---- give the router a state nothing else could have ---------------------
    // A random count, so the fingerprint the WITH arm's report must carry belongs
    // to THIS process instance and to no other.
    seededRequests = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < seededRequests; i += 1) {
      const res = await http(
        "POST",
        routerPort,
        "/v1/chat/completions",
        JSON.stringify({ model: "g5-probe", messages: [{ role: "user", content: "g5" }] }),
        8000,
      );
      if (res === null || res.status !== 502) {
        failures.push(`seeding: expected the router's own 502 (upstream is deliberately down), got ${JSON.stringify(res)}`);
        break;
      }
    }
    const served = await http("GET", routerPort, "/conductor/metrics", undefined, 4000);
    if (served === null || served.status !== 200) {
      say(`FAIL: the router did not serve /conductor/metrics: ${JSON.stringify(served)}`);
      return 1;
    }
    fingerprint = JSON.parse(served.body) as Record<string, unknown>;
    say(`seeded ${String(seededRequests)} requests; router now serves: ${canonical(fingerprint)}`);
    ledgerRows = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim().length > 0).length
      : 0;
    if (ledgerRows !== seededRequests) {
      failures.push(`the router's own ledger holds ${String(ledgerRows)} rows, expected ${String(seededRequests)}`);
    }

    // ---- ARM 1: the router IS in the loop ------------------------------------
    armWith = runArm(
      "ARM WITH ROUTER",
      [
        ["CONDUCTOR_E2E_ROUTER_PORT", String(routerPort)],
        ["CONDUCTOR_E2E_FACTS", withFactsPath],
      ],
      withFactsPath,
    );

    // The counter moves AFTER the arm, so the value the arm's reports carry is
    // one only a live read during the arm's own window could have produced.
    for (let i = 0; i < 2; i += 1) {
      await http(
        "POST",
        routerPort,
        "/v1/chat/completions",
        JSON.stringify({ model: "g5-probe", messages: [{ role: "user", content: "after" }] }),
        8000,
      );
    }
    const after = await http("GET", routerPort, "/conductor/metrics", undefined, 4000);
    afterArmSummary = after === null ? null : (JSON.parse(after.body) as Record<string, unknown>);
    say(`after the arm the same router serves: ${canonical(afterArmSummary)}`);
  } finally {
    stopRouter();
  }

  // ---- the router is really GONE before arm 2 -------------------------------
  await sleep(500);
  const dead = await http("GET", routerPort, "/conductor/health", undefined, 1000);
  if (dead !== null) {
    failures.push(`the router was still answering on ${String(routerPort)} when the WITHOUT arm started`);
  }
  say("");
  say(`router killed; probe of 127.0.0.1:${String(routerPort)}/conductor/health -> ${dead === null ? "no listener" : JSON.stringify(dead)}`);

  // ---- ARM 2: nothing listening --------------------------------------------
  armWithout = runArm("ARM WITHOUT ROUTER", [["CONDUCTOR_E2E_FACTS", withoutFactsPath]], withoutFactsPath);

  // ---- the comparison the plan names ---------------------------------------
  const byScenario = (facts: ArmFacts): Map<string, ScenarioFacts> =>
    new Map(facts.scenarios.map((s) => [s.scenario, s]));
  const withMap = byScenario(armWith?.facts ?? { seamPortFromEnv: null, seamHost: "", seamPort: -1, seamCalls: [], scenarios: [] });
  const withoutMap = byScenario(armWithout.facts);

  const scenarios = [...new Set([...withMap.keys(), ...withoutMap.keys()])].sort();
  if (scenarios.length === 0) failures.push("neither arm recorded a single scenario's facts");
  const rows: string[] = [];
  say("");
  say("-- the three compared facts (plan 2884-2888) --");
  for (const name of scenarios) {
    const a = withMap.get(name);
    const b = withoutMap.get(name);
    if (a === undefined || b === undefined) {
      failures.push(`scenario ${name} was recorded by only one arm`);
      continue;
    }
    const same =
      a.terminalState === b.terminalState &&
      JSON.stringify(a.dispositions) === JSON.stringify(b.dispositions) &&
      JSON.stringify(a.commitSet) === JSON.stringify(b.commitSet) &&
      a.commitCount === b.commitCount;
    if (!same) {
      failures.push(
        `scenario ${name} DIFFERS across the arms:\n  with:    ${JSON.stringify({ t: a.terminalState, d: a.dispositions, c: a.commitSet, n: a.commitCount })}\n  without: ${JSON.stringify({ t: b.terminalState, d: b.dispositions, c: b.commitSet, n: b.commitCount })}`,
      );
    }
    const dispo = a.dispositions.map((d) => `${d.id}=${d.state}${d.blocked ? "+blocked" : ""}${d.deferred ? "+deferred" : ""}`).join(" ");
    const line = [
      `### ${name}${same ? "  — IDENTICAL" : "  — **DIFFERS**"}`,
      `- terminal state:    with=${a.terminalState}   without=${b.terminalState}`,
      `- item dispositions: with=${dispo || "(none)"}   without=${b.dispositions.map((d) => `${d.id}=${d.state}${d.blocked ? "+blocked" : ""}${d.deferred ? "+deferred" : ""}`).join(" ") || "(none)"}`,
      `- commit set (${String(a.commitCount)} commit${a.commitCount === 1 ? "" : "s"}): with=${JSON.stringify(a.commitSet)}`,
      `- commit set (${String(b.commitCount)} commit${b.commitCount === 1 ? "" : "s"}): without=${JSON.stringify(b.commitSet)}`,
      `- metrics (NOT compared, G5-SG-2): with=${a.metricsAvailable === null ? "no report" : canonical(a.metricsSummary)}   without=${b.metricsAvailable === null ? "no report" : canonical(b.metricsSummary)}`,
    ].join("\n");
    rows.push(line);
    say(line);
  }

  // ---- the router was CONTACTED, not merely running -------------------------
  const ambientWith = (armWith?.facts.scenarios ?? []).filter((s) => s.seam === "ambient");
  const ambientWithout = armWithout.facts.scenarios.filter((s) => s.seam === "ambient");
  if (ambientWith.length === 0) failures.push("the WITH arm ran no scenario whose report used the ambient router seam");
  for (const s of ambientWith) {
    if (s.metricsAvailable !== true) {
      failures.push(`WITH arm, scenario ${s.scenario}: no MetricsSummary reached the report — the router was up but never in the loop`);
      continue;
    }
    if (canonical(s.metricsSummary) !== canonical(fingerprint)) {
      failures.push(
        `WITH arm, scenario ${s.scenario}: the report's summary ${canonical(s.metricsSummary)} is not what the router served (${canonical(fingerprint)})`,
      );
    }
  }
  for (const s of ambientWithout) {
    if (s.metricsAvailable !== false || s.metricsSummary !== null) {
      failures.push(`WITHOUT arm, scenario ${s.scenario}: a summary arrived with nothing listening (${canonical(s.metricsSummary)})`);
    }
  }
  const withSeamHits = (armWith?.facts.seamCalls ?? []).filter((c) => c.available).length;
  const withoutSeamHits = armWithout.facts.seamCalls.filter((c) => c.available).length;
  if (withSeamHits === 0) failures.push("the WITH arm crossed the metrics seam but never got an answer");
  if (withoutSeamHits !== 0) failures.push("the WITHOUT arm got an answer from a router that was not running");
  if (armWithout.facts.seamCalls.length === 0) failures.push("the WITHOUT arm never crossed the metrics seam at all");

  say("");
  say("-- the router was contacted, not merely alive --");
  say(`router served (driver-side GET, before the arm): ${canonical(fingerprint)}`);
  say(`summary that reached the WITH arm's reports:     ${canonical(ambientWith[0]?.metricsSummary ?? null)}`);
  say(`summary that reached the WITHOUT arm's reports:  ${canonical(ambientWithout[0]?.metricsSummary ?? null)}`);
  say(`seam crossings: with=${String((armWith?.facts.seamCalls ?? []).length)} (${String(withSeamHits)} answered)  without=${String(armWithout.facts.seamCalls.length)} (${String(withoutSeamHits)} answered)`);

  // ---- the artifact, written from what was measured -------------------------
  const md = renderArtifact({
    repoRoot,
    routerArgv,
    routerPid,
    routerPort,
    upstreamPort,
    healthBody,
    seededRequests,
    fingerprint,
    afterArmSummary,
    armWith,
    armWithout,
    ambientWith,
    ambientWithout,
    rows,
    failures,
    configPath,
    ledgerPath,
    ledgerRows,
    deadProbe: dead === null ? "no listener" : JSON.stringify(dead),
  });
  writeFileSync(artifactPath, md);
  say("");
  say(`artifact written: ${artifactPath}`);

  const check = checkG5Artifact(md, repoRoot);
  say(`artifact self-check: ${check.ok ? "PASS" : "FAIL"}  (differing env: ${JSON.stringify(check.differingEnvNames)}; read by source: ${JSON.stringify(check.envNamesReadBySource)})`);
  for (const v of check.violations) say(`  violation: ${v}`);
  if (!check.ok) failures.push("the artifact fails its own anti-tautology check");

  rmSync(workDir, { recursive: true, force: true });

  say("");
  if (failures.length === 0) {
    say("G5 EQUIVALENCE: PASS");
    return 0;
  }
  say("G5 EQUIVALENCE: FAIL");
  for (const f of failures) say("  - " + f);
  return 1;
}

interface RenderInput {
  repoRoot: string;
  routerArgv: string[];
  routerPid: number;
  routerPort: number;
  upstreamPort: number;
  healthBody: string;
  seededRequests: number;
  fingerprint: Record<string, unknown> | null;
  afterArmSummary: Record<string, unknown> | null;
  armWith: ArmRun | null;
  armWithout: ArmRun;
  ambientWith: ScenarioFacts[];
  ambientWithout: ScenarioFacts[];
  rows: string[];
  failures: string[];
  configPath: string;
  ledgerPath: string;
  ledgerRows: number;
  deadProbe: string;
}

function renderArtifact(input: RenderInput): string {
  // Assembled, never written contiguously in this file: g5-artifact-check.ts
  // greps the source trees (conductor/tools/ included) for the variables the two
  // arms differ in, and a mention of the DEAD variable here would make it look
  // read. Same convention the purity guard uses for its forbidden tokens.
  const legacyVar = "CONDUCTOR_OPENAI" + "_BASE_URL";
  const now = new Date().toISOString();
  const withCmd = input.armWith?.command ?? "(the WITH arm did not run)";
  const withoutCmd = input.armWithout.command;
  const reportWith = canonical(input.ambientWith[0]?.metricsSummary ?? null);
  const reportWithout = canonical(input.ambientWithout[0]?.metricsSummary ?? null);
  return `# Task 12.1 — G5 equivalence: the scripted e2e with the router in the loop and without it

Plan lines 2884-2888: *"run Task 13.1's scripted e2e twice — once with the router in the
loop, once with \`--no-router\` — and assert the same terminal state, the same item
dispositions, and the same commit set. 'The identical process runs without the router' is
a claim this plan makes in five places; this is the one test that makes it true rather
than aspirational."*

Generated by \`conductor/tools/g5-equivalence.ts\` — every number below is written by the
driver from what it measured, in the same process that measured it. Nothing here is typed
by hand.

Run ${now}, repo root \`${input.repoRoot}\`.

**Result: ${input.failures.length === 0 ? "PASS" : "FAIL"}.**

---

## What the previous record got wrong, and why this file has markers

The superseded 2026-08-14 record ran these two arms:

    ${legacyVar}=http://127.0.0.1:8088/v1 node --test conductor/tests/e2e.test.ts
    ${legacyVar}=http://127.0.0.1:8080/v1 node --test conductor/tests/e2e.test.ts

\`grep -rn ${legacyVar} conductor/ scripts/\` returns zero hits: nothing reads
that variable, so those were the same command run twice, and the e2e had no router
touchpoint of any kind to be affected even if something had. The equivalence was a
tautology on two counts.

Both holes are closed at the source. \`conductor/tests/e2e.test.ts\` now passes the REAL
\`fetchMetricsSummary\` (adapter/router-client.ts) as conductor_report's \`metrics\` input,
aimed at \`CONDUCTOR_E2E_ROUTER_PORT\`; and the \`ARM-*\` / \`REPORT-METRICS-*\` lines below are
machine-checked by \`conductor/tools/g5-artifact-check.ts\`, which is run by
\`conductor/tests/g5-artifact.test.ts\` on every gate. That check FAILS if the two arms are
byte-identical, if their only difference is a variable no source file reads, if the WITH
arm's report carries no real summary, or if the WITHOUT arm's carries one.

## 1. The router: real, ours, and started without a model

\`\`\`
$ ${input.routerArgv.join(" ")}
router pid ${String(input.routerPid)}

$ curl -s http://127.0.0.1:${String(input.routerPort)}/conductor/health
${input.healthBody}
\`\`\`

Its config (written to \`${input.configPath}\`, a temp dir — nothing under \`.data/\` was
touched) points upstream at 127.0.0.1:${String(input.upstreamPort)}, where nothing is
listening ON PURPOSE. No model is started and none is needed: the router serves
\`/conductor/health\` and \`/conductor/metrics\` from its own state, and requests it cannot
forward are answered 502 by the router itself and recorded on its own ledger.

## 2. The router is given a state nothing else could have

${String(input.seededRequests)} requests were sent through the proxy path — a count chosen at random for this
run — and each came back 502 from the router itself, because the upstream it was pointed
at does not exist. The router's OWN ledger \`${input.ledgerPath}\`
then held ${String(input.ledgerRows)} rows, which is the router-side half of the same
observation. The aggregate it serves is therefore a fingerprint of THIS process instance —
a counter that reads what it reads only because this driver seeded it, moments earlier:

\`\`\`
ROUTER-SERVED-SUMMARY: ${canonical(input.fingerprint)}
\`\`\`

## 3. The two arms, verbatim

\`\`\`
ARM-WITH-ROUTER-CMD: ${withCmd}
ARM-WITHOUT-ROUTER-CMD: ${withoutCmd}
\`\`\`

The arms differ in \`CONDUCTOR_E2E_ROUTER_PORT\`, which \`conductor/tests/e2e.test.ts\` reads
to aim the report's metrics seam, and in \`CONDUCTOR_E2E_FACTS\`, which the same file reads
to write the run's facts out. Both names appear in shipped source; that is the property
\`${legacyVar}\` never had.

\`\`\`
$ ${withCmd}
exit=${String(input.armWith?.exitCode ?? -1)}  ${input.armWith?.tapTrailer ?? ""}

$ curl -s -m 2 http://127.0.0.1:${String(input.routerPort)}/conductor/health   # after the router was killed
${input.deadProbe}

$ ${withoutCmd}
exit=${String(input.armWithout.exitCode)}  ${input.armWithout.tapTrailer}
\`\`\`

The \`--no-router\` arm is the WITHOUT arm here: with the router process gone, the plugin's
only router touchpoint — \`fetchMetricsSummary\` — meets a refused connection, which is
exactly the wiring \`scripts/serve.py --no-router\` produces for a session (no router
listening on the router port). The e2e sends no model traffic in either arm by
construction (Task 13.1: no model, the fake SDK is the only fake), so the router seam is
the whole of the difference, and it is a real one.

## 4. The router was CONTACTED, not merely running

\`\`\`
REPORT-METRICS-WITH: ${reportWith}
REPORT-METRICS-WITHOUT: ${reportWithout}
\`\`\`

The WITH arm's reports carry the router's fingerprint from section 2 — the same object,
field for field. A router that had started and never been asked would have left the report
carrying \`null\`, which is precisely what the WITHOUT arm's reports carry. The summary is
not inferred from the process being alive: it is the body the router served, arriving
inside a report that the pipeline wrote.

The counter is live, and it moved after the arm finished:

\`\`\`
$ curl -s http://127.0.0.1:${String(input.routerPort)}/conductor/metrics   # after arm 1
${canonical(input.afterArmSummary)}
\`\`\`

so the value the arm's reports carry could only have been read from this process during
the arm's own window.

Seam crossings recorded inside the runs: WITH = ${String(input.armWith?.facts.seamCalls.length ?? 0)} calls, ${String((input.armWith?.facts.seamCalls ?? []).filter((c) => c.available).length)} answered; WITHOUT = ${String(input.armWithout.facts.seamCalls.length)} calls, ${String(input.armWithout.facts.seamCalls.filter((c) => c.available).length)} answered.

## 5. The three facts the plan compares

Terminal state, item dispositions, commit set — per scenario, from the PERSISTED run
state, the persisted items and real \`git log\`, in both arms. The metrics section is shown
but NOT compared: it is the half that must differ (G5-SG-2).

${input.rows.join("\n\n")}

## 6. Teardown

\`\`\`
SIGTERM -> pid ${String(input.routerPid)}   (the driver kills what it started, on every exit path)
$ curl -s -m 2 http://127.0.0.1:${String(input.routerPort)}/conductor/health
${input.deadProbe}
\`\`\`

${input.failures.length === 0 ? "" : "## Failures\n\n" + input.failures.map((f) => "- " + f).join("\n") + "\n"}
## Limitations (stated, not softened)

1. **The scripted e2e sends no model traffic**, so the router relays none of it. Its
   sub-sessions come from the fake SDK by design. What crosses the router in the WITH arm
   is the §4.4 metrics request every closing report makes — the plugin's only router
   touchpoint — and that is what the arms are compared on.
2. **This is not a load test.** It shows the router does not change the outcome of a run;
   admission behaviour under pressure is §4.4's own tests and Phase 14's job.
3. **The WITHOUT arm also runs inside the node suite** as \`[13.1-router-absent-fail-soft]\`,
   where it needs no C++ binary. The WITH arm cannot: a test that spawns llama-router
   would make every fresh-worktree verification depend on a C++ build (G5-SG-1).

## Reproducing

\`\`\`
$ node conductor/tools/g5-equivalence.ts
\`\`\`

It starts one llama-router, runs both arms, compares the three facts, rewrites this file
and kills what it started.
`;
}

main()
  .then((code) => {
    stopRouter();
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    stopRouter();
    process.stdout.write("G5 EQUIVALENCE: FAIL (driver threw)\n" + String(err) + "\n");
    process.exitCode = 1;
  });
