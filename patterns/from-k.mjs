#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { patternFromFilter } from "../codecs/runtime/pattern-k.mjs";

function usage(prog) {
  console.error(`Usage: ${prog} [script-or-file]`);
  console.error("  Read a k script from a file argument or stdin.");
  console.error("  The main expression must be a filter or a type name.");
  console.error("  Output is the canonical property-list pattern array.");
  console.error("  Example:");
  console.error(`    cat pattern.k | ${prog}`);
  console.error(`    ${prog} '$ bits = < {} _, bits 0, bits 1 >; ?< {} nil, { $bits car, X cdr } cons > = X'`);
}

function maybeReadFile(s) {
  if (!s) return s;
  if (fs.existsSync(s) && fs.statSync(s).isFile()) {
    return fs.readFileSync(s, "utf8");
  }
  return s;
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

async function main() {
  const prog = argv[1];
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage(prog);
    return exit(0);
  }
  if (args.length > 1) {
    usage(prog);
    return exit(1);
  }

  const script = args.length === 1 ? maybeReadFile(args[0]) : await readAll(stdin);
  const propertyList = patternFromFilter(script);

  stdout.write(`${JSON.stringify(propertyList)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
