import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  codes,
  decodeWire,
  encodeToWire,
  executeKVM
} from "../backend-api.mjs";
import { createState, evaluateInput } from "../repl.mjs";
import * as jsonCodec from "../codecs/json.mjs";
import * as djsonCodec from "../codecs/djson.mjs";
import btrieCodec, {
  bitPathToIndex,
  indexToBitPath
} from "../codecs/djson-btrie.mjs";
import ptrieCodec from "../codecs/djson-ptrie.mjs";
import {
  compileWasmArtifactFromObject,
  instantiateWasmArtifact,
  writeValueToArena
} from "../backends/wasm/src/wasm.mjs";
import {
  compileCaseExecutable,
  prepareRelation,
  runExecutable,
  runExecutableMainBench,
  wireInput
} from "../backends/llvm/tests/perf-support.mjs";

function printHelp() {
  console.log(`Usage: node scripts/perf-djson.mjs [options]

Dynamic JSON Codecs & Schemas Benchmark Suite.
Compares the three universal dynamic JSON implementations:
  - djson        (sorted cons-list objects & cons-list arrays)
  - djson-btrie  (uncompressed binary bit-trie objects & arrays)
  - djson-ptrie  (Patricia/Radix trie objects & arrays, trie-array style)
and contrasts codec wire sizes against the schema-specializing json codec.

Part 1 benchmarks codec operations (parse, encodeToWire, decodeWire,
print, and wire payload sizes) across 5 value categories:
  1. Shared-prefix objects
  2. Varied-key objects
  3. Short-key objects
  4. Homogeneous number arrays
  5. Mixed nested documents (arrays of objects)

Part 2 benchmarks K schema relations (dot, has_key?, nth, obj_size,
list_size, remove, put) across kVM, WebAssembly, PKIR (Wasm), and
LLVM -O3 native binaries.

Options:
  --sizes <csv>     Comma-separated sizes N (default: 10,100,500)
  --calls <n>       Calls per relation benchmark (default: 1000)
  --codec-iters <n> Iterations for codec timing (default: 100)
  --backends <csv>  Backends to run: kvm,wasm,pkir,llvm (default: all)
  --codecs-only     Run only Part 1 (Codec & Wire Format benchmark)
  --schemas-only    Run only Part 2 (Schema Relation Execution benchmark)
  --json            Print machine-readable JSON report at the end
  -h, --help        Show this help message and exit

Environment Variables:
  SIZES             Comma-separated sizes (e.g. SIZES=10,100,500)
  CALLS             Number of calls per relation case (default: 1000)
  CODEC_ITERS       Iterations for codec microbenchmarks (default: 100)
  BACKENDS          Target backends (e.g. BACKENDS=wasm,llvm)`);
}

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

const sizesRaw =
  getArgValue("--sizes") || process.env.SIZES || "10,100,500";
const SIZES = sizesRaw
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);

const CALLS = Number.parseInt(
  getArgValue("--calls") || process.env.CALLS || "1000",
  10
);
const CODEC_ITERS = Number.parseInt(
  getArgValue("--codec-iters") || process.env.CODEC_ITERS || "100",
  10
);

const backendsRaw = (
  getArgValue("--backends") ||
  process.env.BACKENDS ||
  "kvm,wasm,pkir,llvm"
).toLowerCase();
const BACKENDS = new Set(
  backendsRaw.split(",").map((s) => s.trim()).filter(Boolean)
);

const runCodecsPart = !process.argv.includes("--schemas-only");
const runSchemasPart = !process.argv.includes("--codecs-only");
const emitJson = process.argv.includes("--json");

// -------------------------------------------------------------------
// Dataset Generators
// -------------------------------------------------------------------

const WORDS = [
  "account", "balance", "category", "database", "endpoint",
  "filename", "geometry", "hostname", "identity", "journal",
  "keyboard", "language", "metadata", "network", "operator",
  "password", "quantity", "resource", "security", "template",
  "username", "validate", "workflow", "x509cert", "yearbook", "zoneinfo"
];

function makeSharedPrefixObject(n) {
  const obj = {};
  for (let i = 0; i < n; i++) {
    const k = `field_prefix_${String(i).padStart(4, "0")}`;
    obj[k] = i * 10;
  }
  return obj;
}

function makeVariedKeyObject(n) {
  const obj = {};
  for (let i = 0; i < n; i++) {
    const w1 = WORDS[i % WORDS.length];
    const w2 = WORDS[Math.floor(i / WORDS.length) % WORDS.length];
    const k = `${w1}_${i}_${w2}_attr`;
    obj[k] = i * 10;
  }
  return obj;
}

function makeShortKeyObject(n) {
  const obj = {};
  for (let i = 0; i < n; i++) {
    obj[`k${i}`] = i * 10;
  }
  return obj;
}

function makeNumberArray(n) {
  return Array.from({ length: n }, (_, i) => i * 3);
}

function makeMixedNestedDoc(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      id: i,
      username: `user_${String(i).padStart(4, "0")}`,
      active: (i & 1) === 0,
      score: i * 1.5,
      meta: {
        role: i % 3 === 0 ? "admin" : "member",
        region: WORDS[i % 5]
      }
    });
  }
  return arr;
}

function indexToKLiteral(idx) {
  const bits = indexToBitPath(idx);
  const tags = bits.slice().reverse().map((b) => `|${b}`).join("");
  return `({}|_${tags})`;
}

function unfoldNatValue(val) {
  const bits = [];
  let cur = val;
  while (cur && typeof cur.tag === "string") {
    if (cur.tag === "_") break;
    bits.push(cur.tag === "1" ? 1 : 0);
    cur = cur.value;
  }
  return bitPathToIndex(bits);
}

// -------------------------------------------------------------------
// Part 1: Codec & Wire Representation Benchmark
// -------------------------------------------------------------------

const CODECS = [
  {
    name: "djson",
    desc: "Sorted cons-list",
    codec: djsonCodec,
    pattern: djsonCodec.DJSON_PATTERN
  },
  {
    name: "djson-btrie",
    desc: "Binary bit-trie",
    codec: btrieCodec,
    pattern: btrieCodec.pattern
  },
  {
    name: "djson-ptrie",
    desc: "Patricia/Radix trie",
    codec: ptrieCodec,
    pattern: ptrieCodec.pattern
  },
  {
    name: "json (spec)",
    desc: "Schema-specializing",
    codec: jsonCodec,
    pattern: null
  }
];

const WORKLOADS = [
  {
    id: "shared_obj",
    title: "1A. Shared-Prefix Objects",
    build: makeSharedPrefixObject
  },
  {
    id: "varied_obj",
    title: "1B. Varied-Key Objects",
    build: makeVariedKeyObject
  },
  {
    id: "short_obj",
    title: "1C. Short-Key Objects",
    build: makeShortKeyObject
  },
  {
    id: "num_array",
    title: "1D. Homogeneous Number Arrays",
    build: makeNumberArray
  },
  {
    id: "mixed_doc",
    title: "1E. Mixed Nested Documents (Array of Objects)",
    build: makeMixedNestedDoc
  }
];

function benchCodecOnJson(codecEntry, rawJsonObj, iters) {
  const rawStr = JSON.stringify(rawJsonObj);
  const jsonBytes = Buffer.byteLength(rawStr, "utf8");
  const { codec, pattern: fixedPattern } = codecEntry;

  // Warmup & correctness check
  const kVal = codec.parse(rawStr);
  const envPattern = fixedPattern || kVal.pattern;
  const wireStr = encodeToWire(kVal, envPattern);
  const decoded = decodeWire(wireStr);
  const printedStr = codec.print(decoded.value);
  assert.deepStrictEqual(
    JSON.parse(printedStr),
    rawJsonObj,
    `${codecEntry.name} round-trip mismatch`
  );

  const wireBytes = wireStr.length;
  const patNodes = envPattern ? envPattern.length : 0;

  // Scale iterations down for large payloads to keep runs fast
  const effectiveIters = Math.max(
    5,
    Math.min(iters, Math.floor((iters * 2000) / Math.max(200, jsonBytes)))
  );

  const tParse0 = performance.now();
  let lastVal = kVal;
  for (let i = 0; i < effectiveIters; i++) {
    lastVal = codec.parse(rawStr);
  }
  const parseUs = ((performance.now() - tParse0) * 1000) / effectiveIters;

  const tEnc0 = performance.now();
  let lastWire = wireStr;
  for (let i = 0; i < effectiveIters; i++) {
    lastWire = encodeToWire(lastVal, envPattern);
  }
  const encodeUs = ((performance.now() - tEnc0) * 1000) / effectiveIters;

  const tDec0 = performance.now();
  let lastDec = decoded;
  for (let i = 0; i < effectiveIters; i++) {
    lastDec = decodeWire(lastWire);
  }
  const decodeUs = ((performance.now() - tDec0) * 1000) / effectiveIters;

  const tPrint0 = performance.now();
  let lastStr = printedStr;
  for (let i = 0; i < effectiveIters; i++) {
    lastStr = codec.print(lastDec.value);
  }
  const printUs = ((performance.now() - tPrint0) * 1000) / effectiveIters;
  assert.strictEqual(lastStr.length, printedStr.length);

  return {
    codec: codecEntry.name,
    jsonBytes,
    patNodes,
    wireBytes,
    wireRatio: wireBytes / jsonBytes,
    parseUs,
    encodeUs,
    decodeUs,
    printUs,
    totalUs: parseUs + encodeUs + decodeUs + printUs
  };
}

function runPart1CodecBenchmarks() {
  const results = [];
  const bar = "=".repeat(74);
  console.log(bar);
  console.log("PART 1: CODEC & WIRE FORMAT BENCHMARK");
  console.log(bar);

  for (const wl of WORKLOADS) {
    console.log(`\n### ${wl.title}`);
    for (const n of SIZES) {
      const data = wl.build(n);
      const rawBytes = Buffer.byteLength(JSON.stringify(data), "utf8");
      console.log(`\n--- Size N = ${n} (Raw JSON: ${rawBytes} B) ---`);
      console.log(
        "Codec        | PatNodes | Wire (B) | Wire/JSON | Parse(µs) " +
        "| Enc(µs) | Dec(µs) | Print(µs) | Total(µs)"
      );
      console.log(
        "-------------+----------+----------+-----------+-----------" +
        "+---------+---------+-----------+----------"
      );

      for (const c of CODECS) {
        const r = benchCodecOnJson(c, data, CODEC_ITERS);
        results.push({ workload: wl.id, size: n, ...r });
        console.log(
          `${c.name.padEnd(12)} | ${String(r.patNodes).padStart(8)} | ` +
          `${String(r.wireBytes).padStart(8)} | ` +
          `${(r.wireRatio.toFixed(2) + "x").padStart(9)} | ` +
          `${r.parseUs.toFixed(1).padStart(9)} | ` +
          `${r.encodeUs.toFixed(1).padStart(7)} | ` +
          `${r.decodeUs.toFixed(1).padStart(7)} | ` +
          `${r.printUs.toFixed(1).padStart(9)} | ` +
          `${r.totalUs.toFixed(1).padStart(9)}`
        );
      }
    }
  }
  return results;
}

// -------------------------------------------------------------------
// Part 2: Schema Relation Execution Benchmark
// -------------------------------------------------------------------

const SCHEMAS = [
  {
    name: "djson",
    kFile: "Examples/djson.k",
    codec: djsonCodec,
    pattern: djsonCodec.DJSON_PATTERN,
    fst: "/list /cons .car",
    snd: "/list /cons .cdr /cons .car",
    trd: "/list /cons .cdr /cons .cdr /cons .car"
  },
  {
    name: "djson-btrie",
    kFile: "Examples/djson-btrie.k",
    codec: btrieCodec,
    pattern: btrieCodec.pattern,
    fst: "{ 0 index, /list list } nth",
    snd: "{ 1 index, /list list } nth",
    trd: "{ 0 |1 index, /list list } nth"
  },
  {
    name: "djson-ptrie",
    kFile: "Examples/djson-ptrie.k",
    codec: ptrieCodec,
    pattern: ptrieCodec.pattern,
    fst: "{ 0 index, /list list } nth",
    snd: "{ 1 index, /list list } nth",
    trd: "{ 0 |1 index, /list list } nth"
  }
];

async function buildSchemaState(schema, extraDefs = "") {
  const st = createState({ engine: "wasm" });
  await evaluateInput(`:load ${schema.kFile}`, st);
  const stdDefs = `
    fst = ${schema.fst};
    snd = ${schema.snd};
    trd = ${schema.trd};
    bench_dot = json? { fst /string key, snd /object object } dot json?;
    bench_has_key = json? <
      {
        { fst /string key, snd /object object } has_key? if,
        true then
      } .then,
      false
    > json?;
    bench_obj_size = json? /object obj_size;
    bench_list_size = json? /list list_size;
    bench_remove = json?
      { fst /string key, snd /object object } remove object;
    bench_put = json?
      { fst /string key, snd val, trd /object object } put object;
    ${extraDefs}
  `;
  await evaluateInput(stdDefs, st);
  return st;
}

async function compileRelationRunners(
  state,
  schema,
  relName,
  sampleInput,
  cacheDir
) {
  const prepared = prepareRelation(state, relName);
  const wire = wireInput(sampleInput, schema.pattern);

  let wasmArtifact = null;
  let wasmRunner = null;
  let wasmCompileMs = 0;
  if (BACKENDS.has("wasm")) {
    const t0 = performance.now();
    wasmArtifact = await compileWasmArtifactFromObject(prepared.object, {
      relation: prepared.relationName,
      inputEnvelopePattern: wire.inputPattern,
      usePKIR: false
    });
    wasmRunner = await instantiateWasmArtifact(wasmArtifact);
    wasmCompileMs = performance.now() - t0;
  }

  let pkirArtifact = null;
  let pkirRunner = null;
  let pkirCompileMs = 0;
  if (BACKENDS.has("pkir")) {
    const t0 = performance.now();
    pkirArtifact = await compileWasmArtifactFromObject(prepared.object, {
      relation: prepared.relationName,
      inputEnvelopePattern: wire.inputPattern,
      usePKIR: true
    });
    pkirRunner = await instantiateWasmArtifact(pkirArtifact);
    pkirCompileMs = performance.now() - t0;
  }

  let llvmExePath = null;
  let llvmCompileMs = 0;
  if (BACKENDS.has("llvm")) {
    const t0 = performance.now();
    llvmExePath = compileCaseExecutable({
      object: prepared.object,
      relationName: prepared.relationName,
      relHash: prepared.relHash,
      inputPattern: wire.inputPattern,
      cacheDir,
      sourceLabel: `${schema.name}_${relName}`,
      runtimeMode: "fast",
      clangOpt: "-O3",
      usePKIR: false
    });
    llvmCompileMs = performance.now() - t0;
    assert(
      typeof llvmExePath === "string" && llvmExePath.length > 0,
      `LLVM compilation failed for ${schema.name}:${relName}`
    );
  }

  return {
    state,
    schema,
    relName,
    prepared,
    wasmBytes: wasmArtifact ? wasmArtifact.length : 0,
    pkirBytes: pkirArtifact ? pkirArtifact.length : 0,
    wasmRunner,
    pkirRunner,
    llvmExePath,
    wasmCompileMs,
    pkirCompileMs,
    llvmCompileMs
  };
}

function benchWasmRunner(runner, kInput, verifyFn, calls) {
  const outVal = runner.executeValue(kInput);
  assert(outVal !== undefined, "Wasm execution returned undefined");
  verifyFn(outVal, "Wasm");

  const ptrIn = writeValueToArena(
    runner.exports,
    kInput,
    runner.inputPattern,
    0,
    new Map(),
    runner.tags,
    runner.metadata.inputPattern
  );
  const mark = runner.exports.arena_mark();
  const entryFn = runner.exports[runner.metadata.entry];

  // Warmup and measure single call latency
  runner.exports.arena_reset(mark);
  const tWarm0 = performance.now();
  entryFn(ptrIn);
  const singleMs = Math.max(0.001, performance.now() - tWarm0);

  // Target ~50ms total execution time for timing loop
  const effectiveCalls = Math.max(
    10,
    Math.min(calls, Math.floor(50 / singleMs))
  );

  const t0 = performance.now();
  for (let i = 0; i < effectiveCalls; i++) {
    runner.exports.arena_reset(mark);
    const resPtr = entryFn(ptrIn);
    if (resPtr < 0) throw new Error("Wasm entryFn failed");
  }
  return ((performance.now() - t0) * 1e6) / effectiveCalls;
}

async function executeRelationBench(compiled, kInput, verifyFn, calls) {
  const {
    state,
    schema,
    prepared,
    wasmRunner,
    pkirRunner,
    llvmExePath
  } = compiled;
  const wire = wireInput(kInput, schema.pattern);
  const wireBytes = wire.inputWire.length;

  let kvmNs = null;
  if (BACKENDS.has("kvm")) {
    const ctx = {
      rels: state.rels,
      codes: state.codes,
      findCode: (h) =>
        codes.find(h) ||
        state.codes[String(h).replace(/^@/, "")] ||
        state.codes[h],
      options: { envelopeFree: true }
    };
    const outVal = executeKVM(prepared.kvmFunc, kInput, ctx);
    assert(outVal !== undefined, "kVM returned undefined");
    verifyFn(outVal, "kVM");

    const kvmCalls = Math.max(5, Math.min(200, Math.floor(calls / 5)));
    for (let i = 0; i < 3; i++) {
      executeKVM(prepared.kvmFunc, kInput, ctx);
    }
    const t0 = performance.now();
    for (let i = 0; i < kvmCalls; i++) {
      executeKVM(prepared.kvmFunc, kInput, ctx);
    }
    kvmNs = ((performance.now() - t0) * 1e6) / kvmCalls;
  }

  let wasmNs = null;
  if (wasmRunner) {
    wasmNs = benchWasmRunner(wasmRunner, kInput, verifyFn, calls);
  }

  let pkirNs = null;
  if (pkirRunner) {
    pkirNs = benchWasmRunner(pkirRunner, kInput, verifyFn, calls);
  }

  let llvmNs = null;
  if (llvmExePath) {
    const llvmOutWire = await runExecutable(llvmExePath, wire.inputWire);
    const llvmDecoded = decodeWire(llvmOutWire);
    verifyFn(llvmDecoded.value, "LLVM");

    const llvmCalls = Math.max(
      10,
      Math.min(calls, Math.floor(100_000_000 / (wasmNs || 50_000)))
    );
    const llvmBench = await runExecutableMainBench(
      llvmExePath,
      wire.inputWire,
      llvmCalls
    );
    llvmNs = llvmBench.perCallNs;
  }

  return {
    wireBytes,
    wasmBytes: compiled.wasmBytes,
    pkirBytes: compiled.pkirBytes,
    wasmCompileMs: compiled.wasmCompileMs,
    llvmCompileMs: compiled.llvmCompileMs,
    kvmNs,
    wasmNs,
    pkirNs,
    llvmNs
  };
}

function formatNs(ns) {
  if (ns === null || ns === undefined) return "     n/a";
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2).padStart(6)}ms`;
  if (ns >= 1e4) return `${(ns / 1e3).toFixed(1).padStart(6)}µs`;
  return `${ns.toFixed(0).padStart(6)}ns`;
}

function formatSpeedup(baseNs, curNs) {
  if (!baseNs || !curNs) return "   n/a";
  const ratio = baseNs / curNs;
  return `${ratio.toFixed(1).padStart(5)}x`;
}

function printRelationTableHeader() {
  console.log(
    "Schema       | Wire (B) | Wasm (B) |   kVM    |   Wasm   |   " +
    "PKIR   | LLVM -O3 | Wasm Spd | LLVM Spd"
  );
  console.log(
    "-------------+----------+----------+----------+----------+---" +
    "-------+----------+----------+---------"
  );
}

function printRelationRow(schemaName, res, baseRes) {
  const wasmSpd = baseRes
    ? formatSpeedup(baseRes.wasmNs, res.wasmNs)
    : "  1.0x";
  const llvmSpd = baseRes
    ? formatSpeedup(baseRes.llvmNs, res.llvmNs)
    : "  1.0x";
  console.log(
    `${schemaName.padEnd(12)} | ${String(res.wireBytes).padStart(8)} | ` +
    `${String(res.wasmBytes).padStart(8)} | ` +
    `${formatNs(res.kvmNs)} | ` +
    `${formatNs(res.wasmNs)} | ` +
    `${formatNs(res.pkirNs)} | ` +
    `${formatNs(res.llvmNs)} | ` +
    `${wasmSpd.padStart(8)} | ` +
    `${llvmSpd.padStart(8)}`
  );
}

async function runPart2SchemaBenchmarks() {
  const cacheDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "k-perf-djson-")
  );
  const results = [];

  try {
    const bar = "=".repeat(74);
    console.log(`\n${bar}`);
    console.log("PART 2: SCHEMA RELATION EXECUTION BENCHMARK");
    console.log(bar);

    // Build extra nth definitions for each size N
    const nthTargets = new Map();
    for (const n of SIZES) {
      nthTargets.set(`nth_first_${n}`, 0);
      nthTargets.set(`nth_mid_${n}`, Math.floor(n / 2));
      nthTargets.set(`nth_last_${n}`, n - 1);
    }
    const extraNthDefs = Array.from(nthTargets.entries())
      .map(
        ([relName, idx]) =>
          `${relName} = json? { ` +
          `${indexToKLiteral(idx)} index, /list list } nth json?;`
      )
      .join("\n");

    console.log(
      "\n==> Compiling schema relations (Wasm, PKIR, LLVM -O3)..."
    );
    const compiledBySchema = new Map();
    const samplePair = ["alpha", { alpha: 1, beta: 2 }];
    const sampleTriple = ["gamma", 99, { alpha: 1, beta: 2 }];
    const sampleObj = { alpha: 1, beta: 2 };
    const sampleArr = [10, 20, 30];

    for (const s of SCHEMAS) {
      const st = await buildSchemaState(s, extraNthDefs);
      const map = new Map();
      map.set(
        "bench_dot",
        await compileRelationRunners(
          st,
          s,
          "bench_dot",
          s.codec.parse(JSON.stringify(samplePair)),
          cacheDir
        )
      );
      map.set(
        "bench_has_key",
        await compileRelationRunners(
          st,
          s,
          "bench_has_key",
          s.codec.parse(JSON.stringify(samplePair)),
          cacheDir
        )
      );
      map.set(
        "bench_obj_size",
        await compileRelationRunners(
          st,
          s,
          "bench_obj_size",
          s.codec.parse(JSON.stringify(sampleObj)),
          cacheDir
        )
      );
      map.set(
        "bench_list_size",
        await compileRelationRunners(
          st,
          s,
          "bench_list_size",
          s.codec.parse(JSON.stringify(sampleArr)),
          cacheDir
        )
      );
      map.set(
        "bench_remove",
        await compileRelationRunners(
          st,
          s,
          "bench_remove",
          s.codec.parse(JSON.stringify(samplePair)),
          cacheDir
        )
      );
      map.set(
        "bench_put",
        await compileRelationRunners(
          st,
          s,
          "bench_put",
          s.codec.parse(JSON.stringify(sampleTriple)),
          cacheDir
        )
      );

      for (const n of SIZES) {
        const arrN = makeNumberArray(n);
        const kArrN = s.codec.parse(JSON.stringify(arrN));
        for (const pos of ["first", "mid", "last"]) {
          const relName = `nth_${pos}_${n}`;
          map.set(
            relName,
            await compileRelationRunners(st, s, relName, kArrN, cacheDir)
          );
        }
      }
      compiledBySchema.set(s.name, map);
    }

    // ---------------------------------------------------------------
    // 2A. Object Lookup (`dot`) — Shared-Prefix Keys
    // ---------------------------------------------------------------
    console.log("\n### 2A. Object Lookup (`dot`) — Shared-Prefix Keys");
    for (const n of SIZES) {
      const obj = makeSharedPrefixObject(n);
      const keys = Object.keys(obj).sort();
      const queries = [
        ["first", keys[0]],
        ["mid", keys[Math.floor(n / 2)]],
        ["last", keys[n - 1]]
      ];
      for (const [posLabel, targetKey] of queries) {
        const expectedVal = obj[targetKey];
        console.log(
          `\n--- Shared-Prefix Object N = ${n}, ` +
          `key = ${posLabel} ('${targetKey}') ---`
        );
        printRelationTableHeader();
        let baseRes = null;
        for (const s of SCHEMAS) {
          const compiled = compiledBySchema.get(s.name).get("bench_dot");
          const kInput = s.codec.parse(JSON.stringify([targetKey, obj]));
          const res = await executeRelationBench(
            compiled,
            kInput,
            (val, backend) => {
              assert.strictEqual(
                JSON.parse(s.codec.print(val)),
                expectedVal,
                `${s.name} (${backend}) dot mismatch`
              );
            },
            CALLS
          );
          if (!baseRes) baseRes = res;
          printRelationRow(s.name, res, baseRes);
          results.push({
            section: "dot_shared",
            size: n,
            position: posLabel,
            schema: s.name,
            ...res
          });
        }
      }
    }

    // ---------------------------------------------------------------
    // 2B. Object Lookup (`dot`) — Varied Keys
    // ---------------------------------------------------------------
    console.log("\n### 2B. Object Lookup (`dot`) — Varied Keys");
    for (const n of SIZES) {
      const obj = makeVariedKeyObject(n);
      const keys = Object.keys(obj).sort();
      const queries = [
        ["first", keys[0]],
        ["mid", keys[Math.floor(n / 2)]],
        ["last", keys[n - 1]]
      ];
      for (const [posLabel, targetKey] of queries) {
        const expectedVal = obj[targetKey];
        console.log(
          `\n--- Varied-Key Object N = ${n}, ` +
          `key = ${posLabel} ('${targetKey}') ---`
        );
        printRelationTableHeader();
        let baseRes = null;
        for (const s of SCHEMAS) {
          const compiled = compiledBySchema.get(s.name).get("bench_dot");
          const kInput = s.codec.parse(JSON.stringify([targetKey, obj]));
          const res = await executeRelationBench(
            compiled,
            kInput,
            (val, backend) => {
              assert.strictEqual(
                JSON.parse(s.codec.print(val)),
                expectedVal,
                `${s.name} (${backend}) dot mismatch`
              );
            },
            CALLS
          );
          if (!baseRes) baseRes = res;
          printRelationRow(s.name, res, baseRes);
          results.push({
            section: "dot_varied",
            size: n,
            position: posLabel,
            schema: s.name,
            ...res
          });
        }
      }
    }

    // ---------------------------------------------------------------
    // 2C. Key Membership Filter (`has_key?`) — Hit vs Miss
    // ---------------------------------------------------------------
    console.log(
      "\n### 2C. Object Membership (`has_key?`) — Hit (last) vs Miss"
    );
    for (const n of SIZES) {
      const obj = makeVariedKeyObject(n);
      const keys = Object.keys(obj).sort();
      const cases = [
        ["hit", keys[n - 1], true],
        ["miss", "zzzz_nonexistent_key", false]
      ];
      for (const [caseLabel, queryKey, expectedBool] of cases) {
        console.log(
          `\n--- Varied-Key Object N = ${n}, ` +
          `case = ${caseLabel} ('${queryKey}') ---`
        );
        printRelationTableHeader();
        let baseRes = null;
        for (const s of SCHEMAS) {
          const compiled = compiledBySchema
            .get(s.name)
            .get("bench_has_key");
          const kInput = s.codec.parse(JSON.stringify([queryKey, obj]));
          const res = await executeRelationBench(
            compiled,
            kInput,
            (val, backend) => {
              assert.strictEqual(
                JSON.parse(s.codec.print(val)),
                expectedBool,
                `${s.name} (${backend}) has_key? mismatch`
              );
            },
            CALLS
          );
          if (!baseRes) baseRes = res;
          printRelationRow(s.name, res, baseRes);
          results.push({
            section: "has_key",
            size: n,
            position: caseLabel,
            schema: s.name,
            ...res
          });
        }
      }
    }

    // ---------------------------------------------------------------
    // 2D. Array Element Lookup (`nth`) — First, Middle, Last Index
    // ---------------------------------------------------------------
    console.log(
      "\n### 2D. Array Element Lookup (`nth`) — First, Mid, Last Index"
    );
    for (const n of SIZES) {
      const arr = makeNumberArray(n);
      const positions = [
        ["first", 0],
        ["mid", Math.floor(n / 2)],
        ["last", n - 1]
      ];
      for (const [posLabel, targetIdx] of positions) {
        const expectedVal = arr[targetIdx];
        const relName = `nth_${posLabel}_${n}`;
        console.log(
          `\n--- Array N = ${n}, index = ${posLabel} (${targetIdx}) ---`
        );
        printRelationTableHeader();
        let baseRes = null;
        for (const s of SCHEMAS) {
          const compiled = compiledBySchema.get(s.name).get(relName);
          const kInput = s.codec.parse(JSON.stringify(arr));
          const res = await executeRelationBench(
            compiled,
            kInput,
            (val, backend) => {
              assert.strictEqual(
                JSON.parse(s.codec.print(val)),
                expectedVal,
                `${s.name} (${backend}) nth mismatch`
              );
            },
            CALLS
          );
          if (!baseRes) baseRes = res;
          printRelationRow(s.name, res, baseRes);
          results.push({
            section: "nth",
            size: n,
            position: posLabel,
            schema: s.name,
            ...res
          });
        }
      }
    }

    // ---------------------------------------------------------------
    // 2E. Subtree Cardinality Queries (`obj_size` and `list_size`)
    // ---------------------------------------------------------------
    console.log(
      "\n### 2E. Cardinality Queries (`obj_size` & `list_size`: " +
      "O(N) vs O(1) in djson-ptrie)"
    );
    for (const n of SIZES) {
      const obj = makeVariedKeyObject(n);
      console.log(`\n--- Object Size Query (obj_size) for N = ${n} ---`);
      printRelationTableHeader();
      let baseObjRes = null;
      for (const s of SCHEMAS) {
        const compiled = compiledBySchema
          .get(s.name)
          .get("bench_obj_size");
        const kInput = s.codec.parse(JSON.stringify(obj));
        const res = await executeRelationBench(
          compiled,
          kInput,
          (val, backend) => {
            assert.strictEqual(
              unfoldNatValue(val),
              n,
              `${s.name} (${backend}) obj_size mismatch`
            );
          },
          CALLS
        );
        if (!baseObjRes) baseObjRes = res;
        printRelationRow(s.name, res, baseObjRes);
        results.push({
          section: "obj_size",
          size: n,
          schema: s.name,
          ...res
        });
      }

      const arr = makeNumberArray(n);
      console.log(`\n--- Array Size Query (list_size) for N = ${n} ---`);
      printRelationTableHeader();
      let baseListRes = null;
      for (const s of SCHEMAS) {
        const compiled = compiledBySchema
          .get(s.name)
          .get("bench_list_size");
        const kInput = s.codec.parse(JSON.stringify(arr));
        const res = await executeRelationBench(
          compiled,
          kInput,
          (val, backend) => {
            assert.strictEqual(
              unfoldNatValue(val),
              n,
              `${s.name} (${backend}) list_size mismatch`
            );
          },
          CALLS
        );
        if (!baseListRes) baseListRes = res;
        printRelationRow(s.name, res, baseListRes);
        results.push({
          section: "list_size",
          size: n,
          schema: s.name,
          ...res
        });
      }
    }

    // ---------------------------------------------------------------
    // 2F. Object Key Removal (`remove`) and Insertion (`put`)
    // ---------------------------------------------------------------
    console.log("\n### 2F. Object Update Operations (`remove` & `put`)");
    for (const n of SIZES) {
      const obj = makeVariedKeyObject(n);
      const keys = Object.keys(obj).sort();
      const targetKey = keys[n - 1];
      const expectedAfterRem = { ...obj };
      delete expectedAfterRem[targetKey];

      console.log(
        `\n--- Object Key Removal (remove '${targetKey}') ` +
        `for N = ${n} ---`
      );
      printRelationTableHeader();
      let baseRemRes = null;
      for (const s of SCHEMAS) {
        const compiled = compiledBySchema
          .get(s.name)
          .get("bench_remove");
        const kInput = s.codec.parse(JSON.stringify([targetKey, obj]));
        const res = await executeRelationBench(
          compiled,
          kInput,
          (val, backend) => {
            assert.deepStrictEqual(
              JSON.parse(s.codec.print(val)),
              expectedAfterRem,
              `${s.name} (${backend}) remove mismatch`
            );
          },
          CALLS
        );
        if (!baseRemRes) baseRemRes = res;
        printRelationRow(s.name, res, baseRemRes);
        results.push({
          section: "remove",
          size: n,
          schema: s.name,
          ...res
        });
      }

      const newKey = " middle_inserted_key_attr";
      const newVal = 777;
      const expectedAfterPut = { ...obj, [newKey]: newVal };
      console.log(
        `\n--- Object Key Insertion (put '${newKey}') for N = ${n} ---`
      );
      printRelationTableHeader();
      let basePutRes = null;
      for (const s of SCHEMAS) {
        const compiled = compiledBySchema
          .get(s.name)
          .get("bench_put");
        const kInput = s.codec.parse(
          JSON.stringify([newKey, newVal, obj])
        );
        const res = await executeRelationBench(
          compiled,
          kInput,
          (val, backend) => {
            assert.deepStrictEqual(
              JSON.parse(s.codec.print(val)),
              expectedAfterPut,
              `${s.name} (${backend}) put mismatch`
            );
          },
          CALLS
        );
        if (!basePutRes) basePutRes = res;
        printRelationRow(s.name, res, basePutRes);
        results.push({
          section: "put",
          size: n,
          schema: s.name,
          ...res
        });
      }
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  return results;
}

// -------------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------------

const summaryReport = {};
if (runCodecsPart) {
  summaryReport.codecs = runPart1CodecBenchmarks();
}
if (runSchemasPart) {
  summaryReport.schemas = await runPart2SchemaBenchmarks();
}

if (emitJson) {
  console.log("\n=== JSON REPORT ===");
  console.log(JSON.stringify(summaryReport, null, 2));
}
