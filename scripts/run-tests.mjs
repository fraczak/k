#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const derivationTests = fs.readdirSync(path.join(root, "Code-derivation-tests"))
  .filter((name) => name.endsWith(".mjs"))
  .sort()
  .map((name) => [`Code-derivation-tests/${name}`, node, [`Code-derivation-tests/${name}`]]);

const tests = [
  ["test.mjs", node, ["test.mjs"]],
  ...derivationTests,
  ["test-fingerprint.mjs", node, ["test-fingerprint.mjs"]],
  ["test-hash-fuzz.mjs", node, ["test-hash-fuzz.mjs"]],
  ["test-hash-normalization.mjs", node, ["test-hash-normalization.mjs"]],
  ["test-k-object.mjs", node, ["test-k-object.mjs"]],
  ["test-repl.mjs", node, ["test-repl.mjs"]],
  ["test-ieee-arithmetic.mjs", node, ["test-ieee-arithmetic.mjs"]],
  ["tests.sh", path.join(root, "tests.sh"), []]
];

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds.toFixed(0)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

const suiteStarted = performance.now();
for (const [name, command, args] of tests) {
  console.log(`\n==> ${name}`);
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });
  const duration = formatDuration(performance.now() - started);

  if (result.error) {
    console.error(`<== ${name} FAILED (${duration})`);
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`<== ${name} FAILED (${duration})`);
    process.exit(result.status ?? 1);
  }
  console.log(`<== ${name} passed (${duration})`);
}

console.log(`\nAll tests passed (${formatDuration(performance.now() - suiteStarted)})`);
