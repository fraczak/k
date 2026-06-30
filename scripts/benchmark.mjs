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
  decodeWire,
  encodeToWire,
  evaluateInput,
  executeKVM,
  exportPatternGraph,
  lowerToKVM,
  objectToKVMArtifact,
  retypeObjectRelationForBackend,
  patternToPropertyList,
  propertyListToPattern,
  parseFloat64,
  run,
  run_converged,
  valueForCode,
  Value
} from "../backend-api.mjs";
import { parse as parseIntValue } from "../codecs/int.mjs";
import {
  compileObjectBuffer as compileBackendObjectBuffer,
  decodeObject as decodeBackendObject
} from "../object.mjs";
import {
  compileWasmArtifactFromKVM,
  metadataFromModule,
  readArenaValue as readWasmArenaValue,
  wasmPtr,
  writeValueToArena as writeWasmValueToArena
} from "../backends/wasm/src/wasm.mjs";
import { emitLLVMModule } from "../backends/llvm/src/llvm.mjs";
import { compileLLVMToExecutable, stdioDriverSource } from "../backends/llvm/src/executable.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const kRoot = root;
const llvmRoot = path.join(root, "backends/llvm");
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
  { name: "kVM Interpreter (Env-Free)", kind: "kvm-free" },
  { name: "KIR-P Export", kind: "kir-p" },
  { name: "k-wasm", kind: "wasm" },
  { name: "k-llvm-jit", kind: "llvm-jit" }
];

let cachedLLVMBackendFingerprint = null;

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

function digestResult(value, relDef) {
  const outputPattern = relationPattern(relDef, 1);
  const wire = encodeToWire(value, outputPattern);
  return {
    digest: crypto.createHash("sha256").update(wire).digest("hex").slice(0, 16),
    bytes: wire.length
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

function sha256() {
  return crypto.createHash("sha256");
}

function suiteSourcePath(suite) {
  return path.join(kRoot, suite === "ieee" ? "Examples/ieee.k" : "Examples/arithmetics.k");
}

function sourceNameForSuite(suite) {
  return suite === "ieee" ? "Examples/ieee.k" : "Examples/arithmetics.k";
}

function stripTrailingUnitMain(source) {
  return source.replace(/\s*\(\)\s*$/, "\n");
}

function sourceForCase(testCase) {
  const sourcePath = suiteSourcePath(testCase.suite);
  const source = stripTrailingUnitMain(fs.readFileSync(sourcePath, "utf8"));
  return `${source}\n${testCase.rel}\n`;
}

function relationPattern(relDef, index) {
  const graph = relDef.typePatternGraph;
  const patternId = graph.find(relDef.def.patterns[index]);
  return patternToPropertyList(exportPatternGraph(graph, patternId));
}

function canonicalPattern(propertyList) {
  return patternToPropertyList(propertyListToPattern(propertyList));
}

function wireInput(inputVal, relDef) {
  const inputPattern = relationPattern(relDef, 0);
  const inputWire = encodeToWire(inputVal, inputPattern);
  return { inputPattern, inputWire };
}

function backendObjectForCase(testCase) {
  const source = sourceForCase(testCase);
  return decodeBackendObject(compileBackendObjectBuffer(source, {
    source: `${sourceNameForSuite(testCase.suite)}#${testCase.rel}`
  }));
}

function backendKIRP(testCase, inputPattern, object = null) {
  const backendObject = object || backendObjectForCase(testCase);
  return retypeObjectRelationForBackend(backendObject, backendObject.main, inputPattern, {
    source: `${sourceNameForSuite(testCase.suite)}#${testCase.rel}`
  }).kir;
}

function backendKVMArtifact(testCase, inputPattern, object = null) {
  const backendObject = object || backendObjectForCase(testCase);
  return objectToKVMArtifact(backendObject, backendObject.main, inputPattern, {
    source: `${sourceNameForSuite(testCase.suite)}#${testCase.rel}`
  });
}

function createTagRegistry(entries) {
  const tagToId = new Map();
  const idToTag = new Map();
  let nextId = 1;

  for (const entry of entries) {
    if (!entry || typeof entry.tag !== "string" || !Number.isInteger(entry.id) || entry.id < 1) {
      throw new Error("WebAssembly artifact metadata contains an invalid tag entry");
    }
    if (tagToId.has(entry.tag) || idToTag.has(entry.id)) {
      throw new Error("WebAssembly artifact metadata contains a duplicate tag entry");
    }
    tagToId.set(entry.tag, entry.id);
    idToTag.set(entry.id, entry.tag);
    nextId = Math.max(nextId, entry.id + 1);
  }

  return {
    getId(tag) {
      if (!tagToId.has(tag)) {
        tagToId.set(tag, nextId);
        idToTag.set(nextId, tag);
        nextId++;
      }
      return tagToId.get(tag);
    },
    getTag(id) {
      return idToTag.get(id) ?? null;
    }
  };
}

async function prepareWasmRunner(testCase, relation, inputVal, state) {
  const relDef = relation.relDef;
  const { inputPattern, inputWire } = wireInput(inputVal, relDef);
  const kvmArtifact = backendKVMArtifact(testCase, inputPattern);
  const artifact = await compileWasmArtifactFromKVM(kvmArtifact);
  const module = await WebAssembly.compile(artifact);
  const metadata = metadataFromModule(module);
  const instance = await WebAssembly.instantiate(module);
  const wasmExports = instance.exports;
  const tags = createTagRegistry(metadata.tags);
  const inputPatternGraph = propertyListToPattern(metadata.inputPattern);
  const outputPatternGraph = propertyListToPattern(metadata.outputPattern);
  const { value } = decodeWire(inputWire);
  const arenaInputValues = new Map();
  const inputPtr = writeWasmValueToArena(
    wasmExports,
    value,
    inputPatternGraph,
    0,
    arenaInputValues,
    tags,
    metadata.inputPattern
  );

  return {
    run() {
      const mark = typeof wasmExports.arena_mark === "function" ? wasmExports.arena_mark() : null;
      const result = wasmExports[metadata.entry](inputPtr);
      if (result[1] !== 1) {
        throw new Error("Wasm relation execution failed (returned false)");
      }
      const output = readWasmArenaValue(
        wasmExports,
        wasmPtr(result[0]),
        outputPatternGraph,
        0,
        metadata.outputPattern,
        new Map(arenaInputValues),
        tags
      );
      if (mark != null && typeof wasmExports.arena_reset === "function") {
        wasmExports.arena_reset(mark);
      }
      return output;
    },
    cleanup() {}
  };
}

function llvmBackendFingerprint() {
  if (cachedLLVMBackendFingerprint != null) return cachedLLVMBackendFingerprint;
  const hash = sha256();
  for (const relPath of ["src/llvm.mjs", "src/executable.mjs", "runtime/krt.c", "runtime/krt.h"]) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(llvmRoot, relPath)));
    hash.update("\0");
  }
  cachedLLVMBackendFingerprint = hash.digest("hex").slice(0, 16);
  return cachedLLVMBackendFingerprint;
}

function llvmRuntimeMode(suite) {
  if (suite === "ieee") {
    return process.env.K_LLVM_IEEE_RUNTIME_MODE || process.env.K_LLVM_RUNTIME_MODE || "compact";
  }
  return process.env.K_LLVM_RUNTIME_MODE || "fast";
}

function llvmClangOpt(suite) {
  if (suite === "ieee") {
    return process.env.K_LLVM_IEEE_CLANG_OPT || process.env.K_LLVM_CLANG_OPT || "-O0";
  }
  return process.env.K_LLVM_CLANG_OPT || "-O3";
}

function llvmCacheDir() {
  const dir = process.env.K_LLVM_CACHE_DIR || path.join(os.tmpdir(), "k-parent-benchmark-llvm-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function compileLLVMExecutable({ kvmArtifact, testCase }) {
  const runtimeMode = llvmRuntimeMode(testCase.suite);
  const clangOpt = llvmClangOpt(testCase.suite);
  const artifactBytes = Buffer.from(JSON.stringify(kvmArtifact));
  const hash = sha256();
  hash.update("k-parent-benchmark-llvm-jit-v3\0");
  hash.update(llvmBackendFingerprint());
  hash.update("\0");
  hash.update(runtimeMode);
  hash.update("\0");
  hash.update(clangOpt);
  hash.update("\0");
  hash.update(artifactBytes);
  const exePath = path.join(llvmCacheDir(), `${hash.digest("hex")}.exe`);
  if (!fs.existsSync(exePath)) {
    const tmpPath = path.join(llvmCacheDir(), `${path.basename(exePath)}.${process.pid}.tmp`);
    const llvm = emitLLVMModule(kvmArtifact.kir, {
      relation: kvmArtifact.relation,
      runtimeMode
    });
    compileLLVMToExecutable(llvm, tmpPath, {
      driver: stdioDriverSource({
        inputPattern: canonicalPattern(kvmArtifact.inputPattern),
        outputPattern: canonicalPattern(kvmArtifact.outputPattern)
      }),
      clangOpt
    });
    fs.renameSync(tmpPath, exePath);
  }
  return exePath;
}

class PersistentExecutable {
  constructor(exePath) {
    this.exePath = exePath;
    this.child = spawn(exePath, ["--server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.stderr = [];
    this.closed = false;

    this.child.stdout.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainOutput();
    });
    this.child.stderr.on("data", chunk => this.stderr.push(chunk));
    this.child.on("error", error => this.fail(error));
    this.child.on("close", (status, signal) => {
      this.closed = true;
      if (status !== 0) {
        const detail = signal == null ? `status ${status}` : `status ${status}, signal ${signal}`;
        this.fail(new Error(`${this.exePath} --server failed with ${detail}\n${Buffer.concat(this.stderr).toString("utf8")}`.trim()));
      } else if (this.pending.length > 0) {
        this.fail(new Error(`${this.exePath} --server closed with ${this.pending.length} pending request(s)`));
      }
    });
  }

  fail(error) {
    while (this.pending.length > 0) this.pending.shift().reject(error);
  }

  drainOutput() {
    while (this.pending.length > 0 && this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      this.pending.shift().resolve(Buffer.from(payload));
    }
  }

  request(inputWire) {
    if (this.closed) {
      return Promise.reject(new Error(`${this.exePath} --server is closed`));
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(inputWire.length);
    const frame = Buffer.concat([header, inputWire]);
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(frame, error => {
        if (error) {
          const index = this.pending.findIndex(entry => entry.resolve === resolve);
          if (index !== -1) this.pending.splice(index, 1);
          reject(error);
        }
      });
    });
  }

  close() {
    this.child.stdin.end();
  }
}

async function prepareLLVMJITRunner(testCase, relDef, inputVal, state) {
  const { inputPattern } = wireInput(inputVal, relDef);
  const kvmArtifact = backendKVMArtifact(testCase, inputPattern);
  const inputWire = encodeToWire(inputVal, canonicalPattern(kvmArtifact.inputPattern));
  const exePath = compileLLVMExecutable({ kvmArtifact, testCase });
  const runner = new PersistentExecutable(exePath);

  return {
    async run() {
      const outputWire = await runner.request(inputWire);
      return decodeWire(outputWire).value;
    },
    cleanup() {
      runner.close();
    }
  };
}

function prepareKIRPExportRunner(testCase, relDef, inputVal) {
  const { inputPattern } = wireInput(inputVal, relDef);
  const object = backendObjectForCase(testCase);
  return {
    run() {
      return backendKIRP(testCase, inputPattern, object);
    },
    cleanup() {}
  };
}

async function prepareBackendRunner(job, relation, inputVal, state) {
  if (job.mode.kind === "kir-p") {
    return prepareKIRPExportRunner(job.case, relation.relDef, inputVal);
  }
  if (job.mode.kind === "wasm") {
    return prepareWasmRunner(job.case, relation, inputVal, state);
  }
  if (job.mode.kind === "llvm-jit") {
    return prepareLLVMJITRunner(job.case, relation.relDef, inputVal, state);
  }
  return null;
}

async function prepareState(suite) {
  const state = createState();
  await evaluateInput(`:load ${suiteSourcePath(suite)}`, state);
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
    relHash: hash,
    relDef,
    kvmFunc: lowerToKVM(relDef, testCase.rel)
  };
}

async function runOnce(job, prepared) {
  const { relDef, kvmFunc, inputVal, state, backend } = prepared;
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

  if (job.mode.kind === "kir-p" || job.mode.kind === "wasm" || job.mode.kind === "llvm-jit") {
    return backend.run();
  }

  throw new Error(`Unknown benchmark mode '${job.mode.name}'`);
}

async function workerMain() {
  const job = JSON.parse(process.env.K_BENCHMARK_JOB);
  const setupStartedAt = performance.now();
  const state = await prepareState(job.case.suite);
  const relation = prepareRelation(job.case, state);
  const inputVal = job.case.suite === "ieee" ? ieeeInput(job.case, state) : arithmeticInput(job.case);
  const backend = await prepareBackendRunner(job, relation, inputVal, state);
  const prepared = { ...relation, inputVal, state, backend };
  const setupMs = performance.now() - setupStartedAt;

  const samples = [];
  let lastResult;
  let warmupMs = 0;
  let runStartedHeap = process.memoryUsage().heapUsed;
  try {
    const warmupStartedAt = performance.now();
    const warmupResult = await runOnce(job, prepared);
    warmupMs = performance.now() - warmupStartedAt;
    if (warmupResult === undefined) {
      throw new Error("benchmark warmup operation returned undefined");
    }
    runStartedHeap = process.memoryUsage().heapUsed;

    for (let i = 0; i < job.samples; i++) {
      const startedAt = performance.now();
      lastResult = await runOnce(job, prepared);
      samples.push(performance.now() - startedAt);
      if (lastResult === undefined) {
        throw new Error("benchmark operation returned undefined");
      }
    }
  } finally {
    backend?.cleanup();
  }

  const resultInfo = job.mode.kind === "kir-p"
    ? digestValue(lastResult)
    : digestResult(lastResult, relation.relDef);
  const memory = process.memoryUsage();
  const usage = process.resourceUsage();
  const payload = {
    status: "ok",
    mode: job.mode.name,
    case: job.case.name,
    samples,
    avgMs: mean(samples),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    setupMs,
    warmupMs,
    maxRssMiB: maxRssMiB(usage.maxRSS),
    heapUsedMiB: memory.heapUsed / 1024 / 1024,
    heapDeltaMiB: (memory.heapUsed - runStartedHeap) / 1024 / 1024,
    resultDigest: resultInfo.digest,
    resultBytes: resultInfo.bytes
  };
  const output = JSON.stringify(payload) + "\n";
  if (process.env.K_BENCHMARK_RESULT_PATH) {
    fs.writeFileSync(process.env.K_BENCHMARK_RESULT_PATH, output);
  } else {
    await new Promise((resolve, reject) => {
      process.stdout.write(output, (error) => error ? reject(error) : resolve());
    });
  }
}

function spawnJob(job, timeoutMs) {
  return new Promise((resolve) => {
    const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-benchmark-job-"));
    const resultPath = path.join(resultDir, "result.json");
    const child = spawn(process.execPath, [scriptPath, "--worker"], {
      cwd: root,
      env: {
        ...process.env,
        K_BENCHMARK_WORKER: "1",
        K_BENCHMARK_JOB: JSON.stringify(job),
        K_BENCHMARK_RESULT_PATH: resultPath
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
      const resultText = fs.existsSync(resultPath)
        ? fs.readFileSync(resultPath, "utf8")
        : stdout;
      fs.rmSync(resultDir, { recursive: true, force: true });
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
        resolve(JSON.parse(resultText.trim().split("\n").at(-1)));
      } catch (error) {
        resolve({
          status: "failed",
          mode: job.mode.name,
          case: job.case.name,
          stderr: `Could not parse worker output: ${error.message}\n${resultText}\n${stderr}`
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
        console.log(`[ok]      ${label} ${formatMs(result.avgMs)} ms avg, ${formatMs(result.warmupMs)} ms warmup, ${formatMiB(result.maxRssMiB)} MiB max RSS`);
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
  console.log(`${pad("case", 20)} ${pad("mode", 24)} ${pad("status", 8)} ${pad("avg ms", 10)} ${pad("min", 9)} ${pad("max", 9)} ${pad("warmup", 9)} ${pad("rss MiB", 9)} ${pad("heap MiB", 9)} digest`);
  for (const result of document.results) {
    console.log([
      pad(result.case, 20),
      pad(result.mode, 24),
      pad(result.status, 8),
      pad(formatMs(result.avgMs), 10),
      pad(formatMs(result.minMs), 9),
      pad(formatMs(result.maxMs), 9),
      pad(formatMs(result.warmupMs), 9),
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
  const requestedJobs = process.env.BENCHMARK_JOBS ? Number(process.env.BENCHMARK_JOBS) : 1;
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
