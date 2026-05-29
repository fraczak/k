#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_EXAMPLES = [
  "Examples/nat.k",
  "Examples/byte.k",
  "Examples/bnat.k",
  "Examples/arithmetics.k",
  "Examples/ieee.k"
];

const iterations = Number(process.env.K_BENCH_ITERATIONS || 5);
const examples = process.argv.slice(2);
const benchmarkExamples = examples.length > 0 ? examples : DEFAULT_EXAMPLES;

function run(args) {
  const result = spawnSync("node", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatMs(value) {
  return `${Math.round(value)} ms`;
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KiB`;
  return `${value} B`;
}

console.log(`compile-lib/decompile round-trip benchmark (${iterations} iterations)`);
console.log("example, median, min, max, object");

for (const example of benchmarkExamples) {
  const times = [];
  let size = 0;

  for (let i = 0; i < iterations; i++) {
    const out = mkdtempSync(join(tmpdir(), `k-idempotency-bench-${example.replaceAll("/", "_")}-`));
    const t0 = performance.now();
    run(["objects/compile-lib.mjs", example, join(out, "1.klib")]);
    run(["objects/decompile.mjs", join(out, "1.klib"), join(out, "1.k")]);
    run(["objects/compile-lib.mjs", join(out, "1.k"), join(out, "2.klib")]);
    run(["objects/decompile.mjs", join(out, "2.klib"), join(out, "2.k")]);
    times.push(performance.now() - t0);
    size = statSync(join(out, "1.klib")).size;
  }

  console.log([
    example,
    formatMs(median(times)),
    formatMs(Math.min(...times)),
    formatMs(Math.max(...times)),
    formatBytes(size)
  ].join(", "));
}
