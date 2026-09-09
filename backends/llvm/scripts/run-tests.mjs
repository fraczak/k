#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tests = [
  ["tests/test-llvm.mjs", node, ["tests/test-llvm.mjs"]],
  ["tests/integration.sh", path.join(root, "tests/integration.sh"), []],
  ["scripts/conformance.mjs", node, ["scripts/conformance.mjs"]]
];

for (const [name, command, args] of tests) {
  console.log(`\n==> ${name}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nAll tests passed");
