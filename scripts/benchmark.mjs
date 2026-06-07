#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  codes,
  createState,
  evaluateInput,
  executeKVM,
  lowerToKVM,
  parseFloat64,
  run,
  run_converged,
  valueForCode,
  Value
} from "../backend-api.mjs";
import { parse as parseIntValue } from "../codecs/int.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const resultsPath = path.join(root, "benchmark-results.json");

const bigA = "1234567890".repeat(22);
const bigB = "9876543210".repeat(22);
const gcdFactor = 1234567890123456789012345678901234567890n;
const gcdA = (gcdFactor * 123456789012345678901234567890123456789012345678901n).toString();
const gcdB = (gcdFactor * 987654321098765432109876543210987654321098765432109n).toString();

const cases = [
  { name: "ieee.add", suite: "ieee", rel: "add", input: { x: "0.5", y: "0.25" } },
  { name: "ieee.sub", suite: "ieee", rel: "sub", input: { x: "2", y: "4" } },
  { name: "ieee.mul", suite: "ieee", rel: "mul", input: { x: "-2", y: "4" } },
  { name: "ieee.div", suite: "ieee", rel: "div", input: { x: "1", y: "2" } },
  { name: "int.times.220d", suite: "arithmetics", rel: "times", input: { shape: "int-pair", x: bigA, y: bigB } },
  { name: "int.gcd.90d", suite: "arithmetics", rel: "gcd", input: { shape: "bits-pair", x: gcdA, y: gcdB } },
  { name: "int.factorial.101", suite: "arithmetics", rel: "factorial", input: { shape: "int", x: "101" } },
  { name: "int.factorial.242", suite: "arithmetics", rel: "factorial", input: { shape: "int", x: "242" } },
  { name: "int.factorial.1174", suite: "arithmetics", rel: "factorial", input: { shape: "int", x: "1174" } }
];

const modes = [
  { name: "Native JS (Envelope-Aware)", kind: "native-aware" },
  { name: "Native JS (Envelope-Free)", kind: "native-free" },
  { name: "kVM Interpreter (Env-Free)", kind: "kvm-free" }
];

function csvEnv(name, fallback) {
  return (process.env[name] || fallback)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function selectedCases() {
  const selected = csvEnv("BENCHMARK_CASES", cases.map(testCase => testCase.name).join(","));
  const byName = new Map(cases.map(testCase => [testCase.name, testCase]));
  return selected.map((name) => {
    const testCase = byName.get(name);
    if (!testCase) throw new Error(`Unknown benchmark case '${name}'`);
    return testCase;
  });
}

function selectedModes() {
  const selected = csvEnv("BENCHMARK_MODES", modes.map(mode => mode.name).join(","));
  const byName = new Map(modes.map(mode => [mode.name, mode]));
  return selected.map((name) => {
    const mode = byName.get(name);
    if (!mode) throw new Error(`Unknown benchmark mode '${name}'`);
    return mode;
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxRssMiB(maxRSS) {
  return process.platform === "darwin" ? maxRSS / 1024 / 1024 : maxRSS / 1024;
}

function digestValue(value) {
  const json = JSON.stringify(value);
  return {
    digest: crypto.createHash("sha256").update(json).digest("hex").slice(0, 16),
    bytes: Buffer.byteLength(json)
  };
}

function formatMs(value) {
  return value == null ? "-" : value.toFixed(2);
}

function formatMiB(value) {
  return value == null ? "-" : value.toFixed(1);
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

async function prepareState(suite) {
  const state = createState();
  const source = suite === "ieee" ? "Examples/ieee.k" : "Examples/arithmetics.k";
  await evaluateInput(`:load ${path.join(root, source)}`, state);
  return state;
}

function ieeeInput(testCase, state) {
  const float64Hash = state.typeAliases.float64;
  const floatPairHash = state.typeAliases.float_pair;
  const float64 = text => valueForCode(parseFloat64(text), float64Hash, codes.find);
  return valueForCode(Value.product({
    x: float64(testCase.input.x),
    y: float64(testCase.input.y)
  }), floatPairHash, codes.find);
}

function arithmeticInput(testCase) {
  const { shape } = testCase.input;
  if (shape === "int") {
    return parseIntValue(testCase.input.x);
  }
  if (shape === "int-pair") {
    return Value.product({
      x: parseIntValue(testCase.input.x),
      y: parseIntValue(testCase.input.y)
    });
  }
  if (shape === "bits-pair") {
    return Value.product({
      x: parseIntValue(testCase.input.x).value,
      y: parseIntValue(testCase.input.y).value
    });
  }
  throw new Error(`Unknown arithmetic input shape '${shape}'`);
}

function prepareRelation(testCase, state) {
  const hash = state.relAliases[testCase.rel];
  if (!hash) throw new Error(`Relation '${testCase.rel}' not found`);
  const relDef = state.rels[hash];
  if (!relDef) throw new Error(`Relation hash '${hash}' not found`);
  return {
    relDef,
    kvmFunc: lowerToKVM(relDef, testCase.rel)
  };
}

function runOnce(job, prepared) {
  const { relDef, kvmFunc, inputVal, state } = prepared;
  run.defs = state;
  run_converged.defs = state;

  if (job.mode.kind === "native-aware") {
    return run(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
  }

  if (job.mode.kind === "native-free") {
    return run_converged(codes.find, relDef.def, inputVal, relDef.typePatternGraph);
  }

  if (job.mode.kind === "kvm-free") {
    return executeKVM(kvmFunc, inputVal, {
      rels: state.rels,
      findCode: codes.find,
      options: { envelopeFree: true }
    });
  }

  throw new Error(`Unknown benchmark mode '${job.mode.name}'`);
}

async function workerMain() {
  const job = JSON.parse(process.env.K_BENCHMARK_JOB);
  const setupStartedAt = performance.now();
  const state = await prepareState(job.case.suite);
  const relation = prepareRelation(job.case, state);
  const inputVal = job.case.suite === "ieee" ? ieeeInput(job.case, state) : arithmeticInput(job.case);
  const prepared = { ...relation, inputVal, state };
  const setupMs = performance.now() - setupStartedAt;

  const samples = [];
  let lastResult;
  const runStartedHeap = process.memoryUsage().heapUsed;
  for (let i = 0; i < job.samples; i++) {
    const startedAt = performance.now();
    lastResult = runOnce(job, prepared);
    samples.push(performance.now() - startedAt);
    if (lastResult === undefined) {
      throw new Error("benchmark operation returned undefined");
    }
  }

  const resultInfo = digestValue(lastResult);
  const memory = process.memoryUsage();
  const usage = process.resourceUsage();
  process.stdout.write(JSON.stringify({
    status: "ok",
    mode: job.mode.name,
    case: job.case.name,
    samples,
    avgMs: mean(samples),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    setupMs,
    maxRssMiB: maxRssMiB(usage.maxRSS),
    heapUsedMiB: memory.heapUsed / 1024 / 1024,
    heapDeltaMiB: (memory.heapUsed - runStartedHeap) / 1024 / 1024,
    resultDigest: resultInfo.digest,
    resultBytes: resultInfo.bytes
  }) + "\n");
}

function spawnJob(job, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, "--worker"], {
      cwd: root,
      env: {
        ...process.env,
        K_BENCHMARK_WORKER: "1",
        K_BENCHMARK_JOB: JSON.stringify(job)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 1000).unref();
    }, timeoutMs);

    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ status: "timeout", mode: job.mode.name, case: job.case.name, timeoutMs });
        return;
      }
      if (code !== 0) {
        resolve({
          status: "failed",
          mode: job.mode.name,
          case: job.case.name,
          code,
          signal,
          stderr: stderr.trim() || stdout.trim()
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split("\n").at(-1)));
      } catch (error) {
        resolve({
          status: "failed",
          mode: job.mode.name,
          case: job.case.name,
          stderr: `Could not parse worker output: ${error.message}\n${stdout}\n${stderr}`
        });
      }
    });
  });
}

async function runPool(jobs, concurrency, timeoutMs) {
  const results = [];
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const result = await spawnJob(job, timeoutMs);
      results.push(result);
      const label = `${result.mode}/${result.case}`;
      if (result.status === "ok") {
        console.log(`[ok]      ${label} ${formatMs(result.avgMs)} ms avg, ${formatMiB(result.maxRssMiB)} MiB max RSS`);
      } else {
        console.log(`[${result.status}] ${label}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function resultDocument(results, metadata) {
  const sorted = [...results].sort((a, b) => a.case.localeCompare(b.case) || a.mode.localeCompare(b.mode));
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpuCount: os.availableParallelism(),
    samples: metadata.samples,
    timeoutMs: metadata.timeoutMs,
    parallelJobs: metadata.concurrency,
    results: sorted
  };
}

function writeResultsFile(document) {
  fs.writeFileSync(resultsPath, JSON.stringify(document, null, 2) + "\n");
}

function printSummary(document) {
  console.log("\n==================== K BENCHMARK SUMMARY ====================");
  console.log(`samples/job: ${document.samples}`);
  console.log(`timeout/job: ${(document.timeoutMs / 1000 / 60).toFixed(1)} min`);
  console.log(`parallel jobs: ${document.parallelJobs}`);
  console.log(`results file: ${path.relative(root, resultsPath)}`);
  console.log("-------------------------------------------------------------");
  console.log(`${pad("case", 20)} ${pad("mode", 24)} ${pad("status", 8)} ${pad("avg ms", 10)} ${pad("min", 9)} ${pad("max", 9)} ${pad("rss MiB", 9)} ${pad("heap MiB", 9)} digest`);
  for (const result of document.results) {
    console.log([
      pad(result.case, 20),
      pad(result.mode, 24),
      pad(result.status, 8),
      pad(formatMs(result.avgMs), 10),
      pad(formatMs(result.minMs), 9),
      pad(formatMs(result.maxMs), 9),
      pad(formatMiB(result.maxRssMiB), 9),
      pad(formatMiB(result.heapUsedMiB), 9),
      result.resultDigest || ""
    ].join(" "));
  }

  const failures = document.results.filter(result => result.status !== "ok");
  if (failures.length > 0) {
    console.log("-------------------------------------------------------------");
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`- ${failure.mode}/${failure.case}: ${failure.status}`);
      if (failure.stderr) console.log(failure.stderr.split("\n").slice(0, 12).map(line => `  ${line}`).join("\n"));
    }
  }
  console.log("=============================================================\n");
}

async function main() {
  if (process.env.K_BENCHMARK_WORKER === "1" || process.argv.includes("--worker")) {
    await workerMain();
    return;
  }

  const selected = selectedCases();
  const selectedBenchmarkModes = selectedModes();
  const samples = process.env.BENCHMARK_SAMPLES ? Number(process.env.BENCHMARK_SAMPLES) : 3;
  const timeoutMs = process.env.BENCHMARK_TIMEOUT_MS ? Number(process.env.BENCHMARK_TIMEOUT_MS) : 2 * 60 * 1000;
  const requestedJobs = process.env.BENCHMARK_JOBS ? Number(process.env.BENCHMARK_JOBS) : os.availableParallelism();
  const concurrency = Math.max(1, Math.min(requestedJobs, os.availableParallelism(), selected.length * selectedBenchmarkModes.length));

  if (!Number.isInteger(samples) || samples <= 0) throw new Error("BENCHMARK_SAMPLES must be a positive integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("BENCHMARK_TIMEOUT_MS must be a positive integer");

  const jobs = [];
  for (const testCase of selected) {
    for (const mode of selectedBenchmarkModes) {
      jobs.push({ case: testCase, mode, samples });
    }
  }

  console.log("==> k benchmark");
  console.log(`cases: ${selected.map(testCase => testCase.name).join(", ")}`);
  console.log(`modes: ${selectedBenchmarkModes.map(mode => mode.name).join(", ")}`);
  console.log(`jobs: ${jobs.length}; parallelism: ${concurrency}; timeout/job: ${timeoutMs} ms`);

  const results = await runPool(jobs, concurrency, timeoutMs);
  const document = resultDocument(results, { samples, timeoutMs, concurrency });
  writeResultsFile(document);
  printSummary(document);

  if (process.env.BENCHMARK_STRICT === "1" && results.some(result => result.status !== "ok")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
