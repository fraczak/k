import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createState, evaluateInput } from "../repl.mjs";
import * as djsonCodec from "../codecs/djson.mjs";
import btrieCodec, { indexToBitPath } from "../codecs/djson-btrie.mjs";
import ptrieCodec from "../codecs/djson-ptrie.mjs";
import {
  compileWasmArtifactFromObject,
  instantiateWasmArtifact,
  writeValueToArena
} from "../backends/wasm/src/wasm.mjs";
import {
  compileCaseExecutable,
  prepareRelation,
  runExecutableMainBench,
  wireInput
} from "../backends/llvm/tests/perf-support.mjs";

const llvmCacheDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "k-djson-bench-")
);

console.log("=== 1. Codec Round-Trip Verification ===");
const sampleJson = {
  name: "Alice",
  age: 30,
  active: true,
  nothing: null,
  scores: [10, 20, 30, 40, 50],
  nested: { a: 1, ab: 2, abc: 3, abd: 4, z: 99 }
};
const sampleStr = JSON.stringify(sampleJson);

for (const [label, c, pat] of [
  ["djson (cons-list)", djsonCodec, djsonCodec.DJSON_PATTERN],
  ["djson-btrie (bit-trie)", btrieCodec, btrieCodec.pattern],
  ["djson-ptrie (radix-trie)", ptrieCodec, ptrieCodec.pattern]
]) {
  const kVal = c.parse(sampleStr);
  const roundTrip = JSON.parse(c.print(kVal));
  assert.deepStrictEqual(
    roundTrip,
    sampleJson,
    `${label} round-trip failed`
  );
  console.log(
    `  [OK] ${label.padEnd(26)} pattern nodes: ${pat.length}`
  );
}

function indexToKLiteral(idx) {
  const bits = indexToBitPath(idx);
  const tags = bits.slice().reverse().map((b) => `|${b}`).join("");
  return `({}|_${tags})`;
}

async function setupBenchmarkState(kFile, benchSnippet) {
  const st = createState({ engine: "wasm" });
  await evaluateInput(`:load ${kFile}`, st);
  await evaluateInput(benchSnippet, st);
  return st;
}

async function benchRelationOnInput({
  state,
  relName,
  kInput,
  codec,
  expectedJson,
  calls = 1000
}) {
  const wire = wireInput(kInput, codec.pattern);
  const wireBytes = wire.inputWire.length;
  const prepared = prepareRelation(state, relName);

  // 1. Wasm Compilation & Execution
  const tWasmComp0 = performance.now();
  const wasmBytes = await compileWasmArtifactFromObject(prepared.object, {
    relation: prepared.relationName,
    inputEnvelopePattern: wire.inputPattern,
    usePKIR: false
  });
  const runner = await instantiateWasmArtifact(wasmBytes);
  const wasmCompileMs = performance.now() - tWasmComp0;

  // Verify output once
  const outVal = runner.executeValue(kInput);
  assert(outVal !== undefined, `${relName} Wasm returned undefined`);
  assert.deepStrictEqual(
    JSON.parse(codec.print(outVal)),
    expectedJson,
    `Wasm output mismatch for ${relName}`
  );

  // Write input once to arena, then loop N calls resetting arena mark
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

  // Warmup
  for (let i = 0; i < 20; i++) {
    runner.exports.arena_reset(mark);
    entryFn(ptrIn);
  }

  const tWasmExec0 = performance.now();
  for (let i = 0; i < calls; i++) {
    runner.exports.arena_reset(mark);
    entryFn(ptrIn);
  }
  const wasmExecNsPerCall =
    ((performance.now() - tWasmExec0) * 1e6) / calls;

  // 2. LLVM Compilation & Execution (-O3)
  const tLlvmComp0 = performance.now();
  const exePath = compileCaseExecutable({
    object: prepared.object,
    relationName: prepared.relationName,
    relHash: prepared.relHash,
    inputPattern: wire.inputPattern,
    cacheDir: llvmCacheDir,
    sourceLabel: relName,
    runtimeMode: "fast",
    clangOpt: "-O3",
    usePKIR: false
  });
  const llvmCompileMs = performance.now() - tLlvmComp0;
  const llvmRes = await runExecutableMainBench(
    exePath,
    wire.inputWire,
    calls
  );

  return {
    wireBytes,
    wasmBytes: wasmBytes.length,
    wasmCompileMs,
    wasmExecNsPerCall,
    llvmCompileMs,
    llvmExecNsPerCall: llvmRes.perCallNs
  };
}

const SCHEMAS = [
  {
    name: "djson (cons)",
    kFile: "Examples/djson.k",
    codec: { ...djsonCodec, pattern: djsonCodec.DJSON_PATTERN },
    dotExpr:
      "bench_dot = json? { " +
      "/list /cons .car /string key, " +
      "/list /cons .cdr /cons .car /object object } dot json?;"
  },
  {
    name: "djson-btrie",
    kFile: "Examples/djson-btrie.k",
    codec: btrieCodec,
    dotExpr:
      "bench_dot = json? { " +
      "{ 0 index, /list list } nth /string key, " +
      "{ 1 index, /list list } nth /object object } dot json?;"
  },
  {
    name: "djson-ptrie",
    kFile: "Examples/djson-ptrie.k",
    codec: ptrieCodec,
    dotExpr:
      "bench_dot = json? { " +
      "{ 0 index, /list list } nth /string key, " +
      "{ 1 index, /list list } nth /object object } dot json?;"
  }
];

console.log(
  "\n=== 2A. Object Lookup (`dot`) — " +
  "Shared-Prefix Keys (Wasm vs LLVM -O3) ==="
);
for (const numKeys of [10, 100, 500]) {
  const obj = {};
  for (let i = 0; i < numKeys; i++) {
    const k = `field_prefix_${String(i).padStart(4, "0")}`;
    obj[k] = i * 10;
  }
  const targetKey =
    `field_prefix_${String(numKeys - 1).padStart(4, "0")}`;
  const expectedVal = (numKeys - 1) * 10;
  const inputJsonStr = JSON.stringify([targetKey, obj]);

  console.log(
    `\n--- Object with ${numKeys} shared-prefix keys ` +
    `(querying '${targetKey}') ---`
  );
  console.log(
    "Schema          | Wire (B) | Wasm (B) | " +
    "Wasm Comp | LLVM Comp | Wasm (ns/call) | LLVM (ns/call)"
  );
  console.log(
    "----------------+----------+----------+-" +
    "----------+-----------+----------------+---------------"
  );

  for (const s of SCHEMAS) {
    const st = await setupBenchmarkState(s.kFile, s.dotExpr);
    const kInput = s.codec.parse(inputJsonStr);
    const res = await benchRelationOnInput({
      state: st,
      relName: "bench_dot",
      kInput,
      codec: s.codec,
      expectedJson: expectedVal,
      calls: 1000
    });
    console.log(
      `${s.name.padEnd(15)} | ${String(res.wireBytes).padStart(8)} | ` +
      `${String(res.wasmBytes).padStart(8)} | ` +
      `${res.wasmCompileMs.toFixed(0).padStart(7)}ms | ` +
      `${res.llvmCompileMs.toFixed(0).padStart(7)}ms | ` +
      `${res.wasmExecNsPerCall.toFixed(0).padStart(14)} | ` +
      `${res.llvmExecNsPerCall.toFixed(0).padStart(14)}`
    );
  }
}

console.log(
  "\n=== 2B. Object Lookup (`dot`) — " +
  "Distinct/Varied Keys (Wasm vs LLVM -O3) ==="
);
const WORDS = [
  "account", "balance", "category", "database", "endpoint",
  "filename", "geometry", "hostname", "identity", "journal",
  "keyboard", "language", "metadata", "network", "operator",
  "password", "quantity", "resource", "security", "template",
  "username", "validate", "workflow", "x509cert", "yearbook", "zoneinfo"
];
for (const numKeys of [10, 100, 500]) {
  const obj = {};
  for (let i = 0; i < numKeys; i++) {
    const w1 = WORDS[i % WORDS.length];
    const w2 = WORDS[Math.floor(i / WORDS.length) % WORDS.length];
    const k = `${w1}_${i}_${w2}_attr`;
    obj[k] = i * 10;
  }
  const targetKey = Object.keys(obj).sort().at(-1);
  const expectedVal = obj[targetKey];
  const inputJsonStr = JSON.stringify([targetKey, obj]);

  console.log(
    `\n--- Object with ${numKeys} varied keys ` +
    `(querying '${targetKey}') ---`
  );
  console.log(
    "Schema          | Wire (B) | Wasm (B) | " +
    "Wasm Comp | LLVM Comp | Wasm (ns/call) | LLVM (ns/call)"
  );
  console.log(
    "----------------+----------+----------+-" +
    "----------+-----------+----------------+---------------"
  );

  for (const s of SCHEMAS) {
    const st = await setupBenchmarkState(s.kFile, s.dotExpr);
    const kInput = s.codec.parse(inputJsonStr);
    const res = await benchRelationOnInput({
      state: st,
      relName: "bench_dot",
      kInput,
      codec: s.codec,
      expectedJson: expectedVal,
      calls: 1000
    });
    console.log(
      `${s.name.padEnd(15)} | ${String(res.wireBytes).padStart(8)} | ` +
      `${String(res.wasmBytes).padStart(8)} | ` +
      `${res.wasmCompileMs.toFixed(0).padStart(7)}ms | ` +
      `${res.llvmCompileMs.toFixed(0).padStart(7)}ms | ` +
      `${res.wasmExecNsPerCall.toFixed(0).padStart(14)} | ` +
      `${res.llvmExecNsPerCall.toFixed(0).padStart(14)}`
    );
  }
}

console.log(
  "\n=== 3. List Element Lookup (`nth`) Benchmark (Wasm vs LLVM -O3) ==="
);
for (const len of [10, 100, 500]) {
  const arr = Array.from({ length: len }, (_, i) => i * 3);
  const targetIdx = len - 1;
  const expectedVal = targetIdx * 3;
  const inputJsonStr = JSON.stringify(arr);
  const idxLit = indexToKLiteral(targetIdx);
  const nthExpr =
    `bench_nth = json? { ${idxLit} index, /list list } nth json?;`;

  console.log(
    `\n--- Array with ${len} elements ` +
    `(querying index ${targetIdx}) ---`
  );
  console.log(
    "Schema          | Wire (B) | Wasm (B) | " +
    "Wasm Comp | LLVM Comp | Wasm (ns/call) | LLVM (ns/call)"
  );
  console.log(
    "----------------+----------+----------+-" +
    "----------+-----------+----------------+---------------"
  );

  for (const s of SCHEMAS) {
    const st = await setupBenchmarkState(s.kFile, nthExpr);
    const kInput = s.codec.parse(inputJsonStr);
    const res = await benchRelationOnInput({
      state: st,
      relName: "bench_nth",
      kInput,
      codec: s.codec,
      expectedJson: expectedVal,
      calls: 1000
    });
    console.log(
      `${s.name.padEnd(15)} | ${String(res.wireBytes).padStart(8)} | ` +
      `${String(res.wasmBytes).padStart(8)} | ` +
      `${res.wasmCompileMs.toFixed(0).padStart(7)}ms | ` +
      `${res.llvmCompileMs.toFixed(0).padStart(7)}ms | ` +
      `${res.wasmExecNsPerCall.toFixed(0).padStart(14)} | ` +
      `${res.llvmExecNsPerCall.toFixed(0).padStart(14)}`
    );
  }
}

fs.rmSync(llvmCacheDir, { recursive: true, force: true });
