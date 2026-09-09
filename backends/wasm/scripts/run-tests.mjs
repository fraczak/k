#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tests = [
  ["tests/test-wasm.mjs", node, ["tests/test-wasm.mjs"]],
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
