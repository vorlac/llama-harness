// Fallback for build.sh when no TypeScript compiler is installed.
//
// It imports every module under src/, which forces Node to parse and type-strip
// each file. That catches syntax errors and non-erasable TypeScript (enums,
// namespaces, parameter properties, decorators) but nothing about types. Test
// files are deliberately excluded: importing one would run it.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
let failures = 0;

for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    failures += 1;
    process.stderr.write("parse-check: " + file + "\n  " + String(err && err.message) + "\n");
  }
}

process.stderr.write(
  "parse-check: " + String(files.length - failures) + "/" + String(files.length) + " modules parsed\n",
);
process.exit(failures === 0 ? 0 : 1);
