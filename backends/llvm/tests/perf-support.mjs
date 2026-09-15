import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  decodeWire,
  encodeToWire,
  executeKVM,
  lowerToKVM,
  run,
  run_converged
} from "@fraczak/k/backend-api.mjs";
import {
  compileObjectBuffer,
  decodeObject,
  encodeObject
} from "@fraczak/k/object.mjs";

import { compileObjectToExecutable } from "../src/executable.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cachedBackendFingerprint = null;

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function backendFingerprint() {
  if (cachedBackendFingerprint != null) return cachedBackendFingerprint;
  const hash = crypto.createHash("sha256");
  for (const relPath of ["src/llvm.mjs", "src/executable.mjs", "runtime/krt.c", "runtime/krt.h"]) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relPath)));
    hash.update("\0");
  }
  cachedBackendFingerprint = hash.digest("hex").slice(0, 16);
  return cachedBackendFingerprint;
}

function cloneObjectPayload(object) {
  return decodeObject(encodeObject(object));
}

export function parsePositiveIntEnv(name, fallback) {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function parseNonNegativeIntEnv(name, fallback) {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export function csvEnv(name, fallback) {
  return (process.env[name] || fallback)
    .split(",")
    .map(text => text.trim())
    .filter(Boolean);
}

export function makeCacheDir(prefix) {
  if (process.env.K_LLVM_CACHE_DIR) {
    fs.mkdirSync(process.env.K_LLVM_CACHE_DIR, { recursive: true });
    return process.env.K_LLVM_CACHE_DIR;
  }
  const defaultDir = path.join(os.tmpdir(), prefix ? `${prefix}cache` : "k-llvm-perf-cache");
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

export function prepareRelation(state, relationName, { source = null, sourceLabel = "<benchmark>" } = {}) {
  const relHash = state.relAliases[relationName];
  if (!relHash) throw new Error(`Relation '${relationName}' not found`);
  const relDef = state.rels[relHash];
  if (!relDef) throw new Error(`Relation hash '${relHash}' not found`);
  const object = source == null
    ? prepareKObject(state, relationName, relHash)
    : decodeObject(compileObjectBuffer(source, { source: sourceLabel }));
  return {
    relationName: object.main || relationName,
    relHash,
    relDef,
    kvmFunc: lowerToKVM(relDef, relationName),
    object
  };
}

function prepareKObject(state, relationName, relHash) {
  return {
    format: "k-object",
    codes: state.codes,
    rels: state.rels,
    relAlias: {
      [relationName]: relHash
    },
    compileStats: { sccs: [], sccCount: 0 },
    meta: state.meta || {},
    main: relHash
  };
}

export function wireInput(value, pattern = value.pattern) {
  const inputWire = encodeToWire(value, pattern);
  return {
    inputWire,
    inputPattern: decodeWire(inputWire).pattern
  };
}

export function compileCaseExecutable({ object, relationName, relHash, inputPattern, cacheDir, sourceLabel, runtimeMode = "fast", clangOpt = "-O3" }) {
  const key = sha256([
    "k-llvm-perf-v1",
    backendFingerprint(),
    runtimeMode,
    clangOpt,
    sourceLabel,
    relationName,
    relHash,
    JSON.stringify(inputPattern)
  ].join("\0"));
  const exePath = path.join(cacheDir, `${key}.exe`);
  if (!fs.existsSync(exePath)) {
    const tmpPath = path.join(cacheDir, `${key}.${process.pid}.tmp`);
    compileObjectToExecutable(cloneObjectPayload(object), tmpPath, { relation: relationName, inputPattern, runtimeMode, clangOpt });
    fs.renameSync(tmpPath, exePath);
  }
  return exePath;
}

export function tryCompileCase(options) {
  try {
    return {
      status: "ok",
      exePath: compileCaseExecutable(options)
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.stack || error.message || String(error)
    };
  }
}

export function runExecutable(exePath, inputWire) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", status => {
      if (status !== 0) {
        reject(new Error(`${exePath} failed with status ${status}\n${Buffer.concat(stderr).toString("utf8")}`.trim()));
        return;
      }
      resolve(Buffer.concat(stdout));
    });

    child.stdin.end(inputWire);
  });
}

export function runExecutableMainBench(exePath, inputWire, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, ["--bench-main", String(calls)], { stdio: ["pipe", "ignore", "pipe"] });
    const stderr = [];

    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", status => {
      const text = Buffer.concat(stderr).toString("utf8");
      if (status !== 0) {
        reject(new Error(`${exePath} --bench-main failed with status ${status}\n${text}`.trim()));
        return;
      }
      const match = text.match(/K_(?:LLVM|ARM64)_BENCH_MAIN calls=(\d+) total_ns=(\d+) per_call_ns=([0-9.]+)/);
      if (!match) {
        reject(new Error(`${exePath} --bench-main did not report timing\n${text}`.trim()));
        return;
      }
      resolve({
        calls: Number(match[1]),
        totalNs: Number(match[2]),
        perCallNs: Number(match[3])
      });
    });

    child.stdin.end(inputWire);
  });
}

export function parseTraceLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "K_TRACE_PHASES") return null;
  const result = {};
  for (let i = 1; i < parts.length; i++) {
    const [key, val] = parts[i].split("=");
    if (!key || val == null) continue;
    if (key === "backend") {
      result.backend = val;
    } else {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = Number(val);
    }
  }
  return result;
}

export function runExecutableWithTrace(exePath, inputWire) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, K_TRACE: "1" }
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", status => {
      const errText = Buffer.concat(stderr).toString("utf8");
      if (status !== 0) {
        reject(new Error(`${exePath} failed with status ${status}\n${errText}`.trim()));
        return;
      }
      let trace = null;
      for (const line of errText.split("\n")) {
        if (line.trim().startsWith("K_TRACE_PHASES ")) {
          trace = parseTraceLine(line);
          break;
        }
      }
      resolve({
        payload: Buffer.concat(stdout),
        trace
      });
    });

    child.stdin.end(inputWire);
  });
}

export class PersistentExecutable {
  constructor(exePath) {
    this.exePath = exePath;
    this.child = spawn(exePath, ["--server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, K_TRACE: "1" }
    });
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.stderr = [];
    this.stderrRemainder = "";
    this.traces = [];
    this.waitingForTrace = [];
    this.closed = false;

    this.child.stdout.on("data", chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainOutput();
    });
    this.child.stderr.on("data", chunk => {
      this.stderr.push(chunk);
      this.stderrRemainder += chunk.toString("utf8");
      let idx;
      while ((idx = this.stderrRemainder.indexOf("\n")) !== -1) {
        const line = this.stderrRemainder.slice(0, idx).trim();
        this.stderrRemainder = this.stderrRemainder.slice(idx + 1);
        if (line.startsWith("K_TRACE_PHASES ")) {
          const parsed = parseTraceLine(line);
          if (parsed) {
            if (this.waitingForTrace.length > 0) {
              const item = this.waitingForTrace.shift();
              item.resolve({ payload: item.payload, trace: parsed });
            } else {
              this.traces.push(parsed);
            }
          }
        }
      }
    });
    this.child.on("error", error => this.fail(error));
    this.child.on("close", status => {
      this.closed = true;
      if (status !== 0) {
        this.fail(new Error(`${this.exePath} --server failed with status ${status}\n${Buffer.concat(this.stderr).toString("utf8")}`.trim()));
      } else if (this.pending.length > 0 || this.waitingForTrace.length > 0) {
        this.fail(new Error(`${this.exePath} --server closed with pending request(s)`));
      }
    });
  }

  fail(error) {
    while (this.pending.length > 0) this.pending.shift().reject(error);
    while (this.waitingForTrace.length > 0) this.waitingForTrace.shift().reject(error);
  }

  drainOutput() {
    while (this.pending.length > 0 && this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) return;
      const payload = Buffer.from(this.buffer.subarray(4, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);
      const req = this.pending.shift();
      if (!req.includeTrace) {
        req.resolve(payload);
      } else if (this.traces.length > 0) {
        const trace = this.traces.shift();
        req.resolve({ payload, trace });
      } else {
        this.waitingForTrace.push({ payload, resolve: req.resolve, reject: req.reject });
      }
    }
  }

  request(inputWire) {
    return this._sendRequest(inputWire, false);
  }

  requestWithTrace(inputWire) {
    return this._sendRequest(inputWire, true);
  }

  _sendRequest(inputWire, includeTrace) {
    if (this.closed) {
      return Promise.reject(new Error(`${this.exePath} --server is closed`));
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(inputWire.length);
    const frame = Buffer.concat([header, inputWire]);
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject, includeTrace });
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

export function runTimedIterations(iterations, body) {
  const iterationTimes = [];
  const startedAt = performance.now();

  for (let i = 0; i < iterations; i++) {
    const iterationStartedAt = performance.now();
    body();
    iterationTimes.push(performance.now() - iterationStartedAt);
  }

  return {
    time: performance.now() - startedAt,
    iterationTimes
  };
}

export async function runTimedIterationsAsync(iterations, body) {
  const iterationTimes = [];
  const startedAt = performance.now();

  for (let i = 0; i < iterations; i++) {
    const iterationStartedAt = performance.now();
    await body();
    iterationTimes.push(performance.now() - iterationStartedAt);
  }

  return {
    time: performance.now() - startedAt,
    iterationTimes
  };
}

export function runNativeAwareIterations(iterations, testSuite, relations, state, codes) {
  return runTimedIterations(iterations, () => {
    for (const tc of testSuite) {
      const relDef = relations[tc.op].relDef;
      run.defs = state;
      const result = run(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
      if (result === undefined) throw new Error(`${tc.op}(${tc.label}) returned undefined`);
    }
  });
}

export function runNativeFreeIterations(iterations, testSuite, relations, state, codes) {
  return runTimedIterations(iterations, () => {
    for (const tc of testSuite) {
      const relDef = relations[tc.op].relDef;
      run_converged.defs = state;
      const result = run_converged(codes.find, relDef.def, tc.inputVal, relDef.typePatternGraph);
      if (result === undefined) throw new Error(`${tc.op}(${tc.label}) returned undefined`);
    }
  });
}

export function runKVMIterations(iterations, testSuite, relations, state, codes) {
  const contextFree = {
    rels: state.rels,
    findCode: codes.find,
    options: { envelopeFree: true }
  };

  return runTimedIterations(iterations, () => {
    for (const tc of testSuite) {
      const result = executeKVM(relations[tc.op].kvmFunc, tc.inputVal, contextFree);
      if (result === undefined) throw new Error(`${tc.op}(${tc.label}) returned undefined`);
    }
  });
}

export function runKVMCase(testCase, relations, state, codes) {
  return executeKVM(relations[testCase.op].kvmFunc, testCase.inputVal, {
    rels: state.rels,
    findCode: codes.find,
    options: { envelopeFree: true }
  });
}

async function runLLVMSpawnIterations(iterations, testSuite) {
  const llvmCases = testSuite.filter(tc => tc.llvm?.status === "ok");
  if (llvmCases.length === 0) return null;

  return runTimedIterationsAsync(iterations, async () => {
    for (const tc of llvmCases) {
      await runExecutable(tc.llvm.exePath, tc.inputWire);
    }
  });
}

async function runLLVMPersistentIterations(iterations, testSuite) {
  const runner = createLLVMPersistentRunner(testSuite);
  try {
    return await runner.run(iterations);
  } finally {
    runner.close();
  }
}

function createLLVMPersistentRunner(testSuite) {
  const llvmCases = testSuite.filter(tc => tc.llvm?.status === "ok");
  const servers = new Map();
  function serverFor(exePath) {
    let server = servers.get(exePath);
    if (server == null) {
      server = new PersistentExecutable(exePath);
      servers.set(exePath, server);
    }
    return server;
  }

  return {
    async run(iterations) {
      if (llvmCases.length === 0) return null;
      return runTimedIterationsAsync(iterations, async () => {
        if (process.env.LLVM_PIPELINE === "1") {
          const pending = [];
          for (const tc of llvmCases) {
            pending.push(serverFor(tc.llvm.exePath).request(tc.inputWire));
          }
          await Promise.all(pending);
          return;
        }
        for (const tc of llvmCases) {
          await serverFor(tc.llvm.exePath).request(tc.inputWire);
        }
      });
    },
    close() {
      for (const server of servers.values()) server.close();
    }
  };
}

export function createLLVMRunner(testSuite) {
  if (process.env.LLVM_SPAWN_PER_CALL === "1") {
    return {
      run(iterations) {
        return runLLVMSpawnIterations(iterations, testSuite);
      },
      close() {}
    };
  }
  return createLLVMPersistentRunner(testSuite);
}

export async function runLLVMIterations(iterations, testSuite) {
  const runner = createLLVMRunner(testSuite);
  try {
    return await runner.run(iterations);
  } finally {
    runner.close();
  }
}

export async function runLLVMMainBench(testSuite, calls) {
  const llvmCases = testSuite.filter(tc => tc.llvm?.status === "ok");
  if (llvmCases.length === 0) return null;
  const results = [];
  for (const tc of llvmCases) {
    const timing = await runExecutableMainBench(tc.llvm.exePath, tc.inputWire, calls);
    results.push({ testCase: tc, timing });
  }
  const totalNs = results.reduce((sum, item) => sum + item.timing.totalNs, 0);
  return {
    calls,
    cases: results.length,
    totalNs,
    perIterationMs: totalNs / calls / 1000000,
    results
  };
}

export function llvmLaneName() {
  if (process.env.LLVM_SPAWN_PER_CALL === "1") return "LLVM Executable (spawn/call)";
  return process.env.LLVM_PIPELINE === "1"
    ? "LLVM Executable (persistent, pipelined)"
    : "LLVM Executable (persistent)";
}

export function arm64LaneName(optLevel = "-O2") {
  const mode = process.env.ARM64_SPAWN_PER_CALL === "1"
    ? "spawn/call"
    : (process.env.ARM64_PIPELINE === "1" ? "persistent, pipelined" : "persistent");
  return `Linux ARM64 ${optLevel} (${mode})`;
}

export function createARM64Runner(testSuite) {
  const arm64Cases = testSuite.filter(tc => tc.arm64?.status === "ok");
  if (process.env.ARM64_SPAWN_PER_CALL === "1") {
    return {
      run(iterations) {
        if (arm64Cases.length === 0) return null;
        return runTimedIterationsAsync(iterations, async () => {
          for (const tc of arm64Cases) {
            await runExecutable(tc.arm64.exePath, tc.inputWire);
          }
        });
      },
      close() {}
    };
  }

  const servers = new Map();
  function serverFor(exePath) {
    let server = servers.get(exePath);
    if (server == null) {
      server = new PersistentExecutable(exePath);
      servers.set(exePath, server);
    }
    return server;
  }

  return {
    async run(iterations) {
      if (arm64Cases.length === 0) return null;
      return runTimedIterationsAsync(iterations, async () => {
        if (process.env.ARM64_PIPELINE === "1") {
          const pending = [];
          for (const tc of arm64Cases) {
            pending.push(serverFor(tc.arm64.exePath).request(tc.inputWire));
          }
          await Promise.all(pending);
          return;
        }
        for (const tc of arm64Cases) {
          await serverFor(tc.arm64.exePath).request(tc.inputWire);
        }
      });
    },
    close() {
      for (const server of servers.values()) server.close();
    }
  };
}

export function average(times) {
  return times.reduce((sum, time) => sum + time, 0) / times.length;
}

export function formatTiming(result) {
  if (result == null) return "unavailable";
  const samples = result.iterationTimes.map(time => time.toFixed(2)).join(", ");
  return `(${samples}) ~ ${average(result.iterationTimes).toFixed(2)} ms/iteration`;
}

export function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

export function printCompileFailures(testSuite, limit = 3) {
  const failed = testSuite.filter(tc => tc.llvm?.status === "failed");
  if (failed.length === 0) return;

  console.log(`==> LLVM compile failures: ${failed.length}/${testSuite.length} cases`);
  for (const tc of failed.slice(0, limit)) {
    const firstLines = tc.llvm.error.split("\n").slice(0, 8).join("\n");
    console.log(`-- ${tc.op}(${tc.label})`);
    console.log(firstLines);
  }
  if (failed.length > limit) {
    console.log(`-- ${failed.length - limit} more failures omitted`);
  }
}

export function shouldStrictFail(testSuite) {
  return process.env.LLVM_STRICT === "1" &&
    testSuite.some(tc => tc.llvm?.status !== "ok" || tc.llvmConformance !== "ok");
}
