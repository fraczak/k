#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const derivationTests = fs.readdirSync(path.join(root, "tests/code-derivation"))
  .filter((name) => name.endsWith(".mjs"))
  .sort()
  .map((name) => [`tests/code-derivation/${name}`, node, [`tests/code-derivation/${name}`]]);

const tests = [
  ["tests/test.mjs", node, ["tests/test.mjs"]],
  ...derivationTests,
  ["tests/test-fingerprint.mjs", node, ["tests/test-fingerprint.mjs"]],
  ["tests/test-hash-fuzz.mjs", node, ["tests/test-hash-fuzz.mjs"]],
  ["tests/test-hash-normalization.mjs", node, ["tests/test-hash-normalization.mjs"]],
  ["tests/test-structural-values.mjs", node, ["tests/test-structural-values.mjs"]],
  ["tests/test-deep-wire-value.mjs", node, ["tests/test-deep-wire-value.mjs"]],
  ["tests/test-k-object.mjs", node, ["tests/test-k-object.mjs"]],
  ["tests/test-kir.mjs", node, ["tests/test-kir.mjs"]],
  ["tests/test-validate-object.mjs", node, ["tests/test-validate-object.mjs"]],
  ["conformance/run.mjs", node, ["conformance/run.mjs"]],
  ["tests/test-repl.mjs", node, ["tests/test-repl.mjs"]],
  ["tests/test-kvm.mjs", node, ["tests/test-kvm.mjs"]],
  ["tests/test-arithmetics.mjs", node, ["tests/test-arithmetics.mjs"]],
  ["tests/test-ieee-arithmetic.mjs", node, ["tests/test-ieee-arithmetic.mjs"]],
  ["tests/integration.sh", path.join(root, "tests/integration.sh"), []]
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
