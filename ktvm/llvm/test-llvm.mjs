/**
 * Native C99 / LLVM Backend Test Suite (`k/ktvm/llvm/test-llvm.mjs`).
 *
 * Verifies 100% bit-exact C99 + `clang -O3` native compilation & execution across:
 *   1. Accelerated streaming kernels (`lsb_add` 512b, `lsb_trim` 4,096b, `half_max_tally` SWAR)
 *   2. Polymorphic & opaque payload execution (`lib/generic.k` `reverse`)
 *   3. Full stdlib parity (`lib/integer.k` incl. Karatsuba `times`/`div`/`gcd`,
 *      `lib/ieee.k` `bits_to_float64` & `ratio_to_float64`, `lib/djson.k` RFC 8259 `parse_json`)
 *   4. Persistent `--server` protocol (`K_TRACE=1`), general non-canonical `k-wire` header
 *      verification (without preset hint), quotas, malformed wire rejection, and `spec` rollback /
 *      upstream abort / `after %tok`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import k from "../../index.mjs";
import codes from "../../codes.mjs";
import { Value } from "../../Value.mjs";
import { compileLibrary, loadLibrary } from "../../object.mjs";
import { encodeToWire, decodeWire } from "../../codecs/runtime/prefix-codec.mjs";
import { parse as parseIntVal } from "../../codecs/int.mjs";
import { textToStringValue } from "../../codecs/string-codec.mjs";
import { useSpecsFor } from "../../tests/helpers/cli.mjs";
import { relationPatternPropertyList } from "../../kir.mjs";
import { PersistentExecutable } from "../../harness/persistent.mjs";

import {
  compileKTVMToExecutable,
  compileObjectToKTVMExecutable,
  executeKTVMExecutable,
  executeKTVMWire,
  isClangAvailable,
  parseModule
} from "../index.mjs";

if (!isClangAvailable("clang")) {
  console.log("SKIP: clang not found in PATH; skipping kTVM C/LLVM native test suite.");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ktvm-llvm-test-"));
const UNIT = Value.product({});

function bitsFromStr(str) {
  let v = Value.variant("_", UNIT);
  for (let i = str.length - 1; i >= 0; i--) v = Value.variant(str[i], v);
  return v;
}

function makeList(items) {
  let v = Value.variant("nil", UNIT);
  for (let i = items.length - 1; i >= 0; i--) {
    v = Value.variant("cons", Value.product({ car: items[i], cdr: v }));
  }
  return v;
}

function plainValue(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v.toJSON()));
}

const coreLib = loadLibrary(compileLibrary(readSrc("core.k"), { source: "core.k" }));
const genericLib = loadLibrary(compileLibrary(readSrc("lib/generic.k"), {
  source: "lib/generic.k", libraries: [coreLib], use: useSpecsFor("lib/generic.k")
}));
const integerLib = loadLibrary(compileLibrary(readSrc("lib/integer.k"), {
  source: "lib/integer.k", libraries: [coreLib], use: useSpecsFor("lib/integer.k")
}));
const ieeeLib = loadLibrary(compileLibrary(readSrc("lib/ieee.k"), {
  source: "lib/ieee.k", libraries: [coreLib], use: useSpecsFor("lib/ieee.k")
}));
const djsonLib = loadLibrary(compileLibrary(readSrc("lib/djson.k"), {
  source: "lib/djson.k", libraries: [coreLib, genericLib, ieeeLib], use: useSpecsFor("lib/djson.k")
}));
const streamLib = loadLibrary(compileLibrary(readSrc("ktvm/fixtures/integer-streaming.k"), {
  source: "ktvm/fixtures/integer-streaming.k", libraries: [coreLib], use: useSpecsFor("lib/integer.k")
}));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

try {
  console.log("\n=== 1. Accelerated Native C/LLVM Kernels (chunk_table, stack_table, SWAR) ===");

  await test("Native lsb_add (512b carry chain + persistent --server + K_TRACE=1)", async () => {
    codes.load(streamLib.codes);
    const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_add], 0);
    const exe = path.join(tmpDir, "lsb_add.exe");
    const art = compileObjectToKTVMExecutable(streamLib, "lsb_add", inPat, exe, { optimize: true });

    const srv = new PersistentExecutable(exe);
    try {
      for (const [a, b] of [["0", "0"], ["255", "1"], [String((1n << 512n) - 1n), "1"]]) {
        const val = Value.product({ x: parseIntVal(a).value, y: parseIntVal(b).value });
        const wire = encodeToWire(val, inPat);
        const jsRef = executeKTVMWire(art.ktvmModule, wire, { entry: art.entry, validate: false });
        const { payload, trace } = await srv.requestWithTrace(wire);
        assert.deepEqual(Buffer.from(payload), Buffer.from(jsRef.wire));
        assert.ok(trace && trace.evalNs >= 0 && trace.totalNs >= 0);
      }
    } finally {
      srv.close();
    }

    // Verify CLI telemetry reports chunk_table_step lookups
    const bigWire = encodeToWire(Value.product({
      x: parseIntVal(String((1n << 128n) - 1n)).value,
      y: parseIntVal(String((1n << 128n) - 1n)).value
    }), inPat);
    const cli = executeKTVMExecutable(exe, bigWire, { telemetry: true });
    assert.equal(cli.status, "OK");
    assert.ok(cli.telemetry.tableLookups >= 10, "native chunk_table_step must fire");
  });

  await test("Native lsb_trim (virtual LIFO BitStack + stack_table on 4,096-bit stream)", async () => {
    codes.load(streamLib.codes);
    const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_trim], 0);
    const exe = path.join(tmpDir, "lsb_trim.exe");
    const art = compileObjectToKTVMExecutable(streamLib, "lsb_trim", inPat, exe, { optimize: true });

    for (const s of ["", "0", "00000", "1", "001001000", "0".repeat(2000) + "1" + "0".repeat(2095)]) {
      const wire = encodeToWire(bitsFromStr(s), inPat);
      const jsRef = executeKTVMWire(art.ktvmModule, wire, { entry: art.entry, validate: false, decodeValue: false });
      const res = executeKTVMExecutable(exe, wire, { telemetry: s.length > 1000 });
      assert.equal(res.status, "OK");
      assert.deepEqual(Buffer.from(res.wire), Buffer.from(jsRef.wire));
      if (s.length > 1000) assert.ok(res.telemetry.tableLookups >= 500);
    }
  });

  await test("Native half_max_tally (SWAR compressed unshift chunk_table)", async () => {
    codes.load(integerLib.codes);
    const inPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.half_max_tally], 0);
    const exe = path.join(tmpDir, "half_max_tally.exe");
    const art = compileObjectToKTVMExecutable(integerLib, "half_max_tally", inPat, exe, { optimize: true });

    for (const [a, b] of [["0", "0"], ["101010", "11"], ["1".repeat(80), "0".repeat(55)]]) {
      const wire = encodeToWire(Value.product({ x: bitsFromStr(a), y: bitsFromStr(b) }), inPat);
      const jsRef = executeKTVMWire(art.ktvmModule, wire, { entry: art.entry, validate: false, decodeValue: false });
      const res = executeKTVMExecutable(exe, wire, { telemetry: true });
      assert.equal(res.status, "OK");
      assert.deepEqual(Buffer.from(res.wire), Buffer.from(jsRef.wire));
    }
  });

  console.log("\n=== 2. Full Stdlib Parity in Native C/LLVM (generic, integer, ieee, djson) ===");

  await test("Native lib/generic.k: opaque product list reverse + unminimized open-union header check", async () => {
    codes.load(genericLib.codes);
    const prodList = makeList([
      Value.product({ a: bitsFromStr("101010"), b: bitsFromStr("101") }),
      Value.product({ a: bitsFromStr("111"), b: bitsFromStr("00") }),
      Value.product({ a: bitsFromStr("0001"), b: bitsFromStr("1") })
    ]);
    const prodListPat = [
      ["closed-union", [["cons", 1], ["nil", 4]]],
      ["closed-product", [["car", 2], ["cdr", 0]]],
      ["closed-product", [["a", 3], ["b", 3]]],
      ["closed-union", [["0", 3], ["1", 3], ["_", 4]]],
      ["closed-product", []]
    ];
    // Compile executable WITHOUT passing the open-union unminimized header as a preset,
    // proving the C runtime's general header parser & coinductive equivalence checker works!
    const exe = path.join(tmpDir, "reverse.exe");
    compileObjectToKTVMExecutable(genericLib, "reverse", prodListPat, exe, { optimize: true });

    const nonMinPat = [
      ["open-union", [["cons", 1], ["nil", 5]]],
      ["open-product", [["car", 2], ["cdr", 0]]],
      ["open-product", [["a", 3], ["b", 4]]],
      ["open-union", [["0", 3], ["1", 3], ["_", 5]]],
      ["open-union", [["0", 4], ["1", 4], ["_", 5]]],
      ["closed-product", []]
    ];
    const wire = encodeToWire(prodList, nonMinPat);
    const res = executeKTVMExecutable(exe, wire);
    const ref = k.compile(genericLib.relAlias.reverse, { libraries: [genericLib] })(prodList);
    assert.equal(res.status, "OK");
    assert.deepEqual(plainValue(decodeWire(res.wire, { eager: true }).value), plainValue(ref));
  });

  await test("Native lib/integer.k: plus, minus, times (Karatsuba), div, gcd, cmp", async () => {
    codes.load(integerLib.codes);
    for (const [op, val] of [
      ["plus", Value.product({ x: parseIntVal("123456789"), y: parseIntVal("-987654321") })],
      ["minus", Value.product({ x: parseIntVal("100000"), y: parseIntVal("1") })],
      ["times", Value.product({ x: parseIntVal("65537"), y: parseIntVal("123456") })],
      ["div", Value.product({ x: parseIntVal("987654321"), y: parseIntVal("12345") })],
      ["gcd", Value.product({ x: parseIntVal("1071"), y: parseIntVal("462") })],
      ["cmp", Value.product({ x: parseIntVal("-42"), y: parseIntVal("17") })]
    ]) {
      const inPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias[op]], 0);
      const exe = path.join(tmpDir, `int_${op}.exe`);
      compileObjectToKTVMExecutable(integerLib, op, inPat, exe, { optimize: true });
      const ref = k.compile(integerLib.relAlias[op], { libraries: [integerLib] })(val);
      const res = executeKTVMExecutable(exe, encodeToWire(val, inPat));
      assert.equal(res.status, "OK", `native integer.${op} failed: ${res.stderr}`);
      assert.deepEqual(plainValue(decodeWire(res.wire, { eager: true }).value), plainValue(ref));
    }
  });

  await test("Native lib/ieee.k: bits_to_float64 & ratio_to_float64", async () => {
    codes.load(ieeeLib.codes);
    const fPat = relationPatternPropertyList(ieeeLib.rels[ieeeLib.relAlias.bits_to_float64], 0);
    const fExe = path.join(tmpDir, "ieee_f64.exe");
    compileObjectToKTVMExecutable(ieeeLib, "bits_to_float64", fPat, fExe, { optimize: true });
    const fVal = parseIntVal(String((1n << 53n) + 3n)).value;
    const fRef = k.compile(ieeeLib.relAlias.bits_to_float64, { libraries: [ieeeLib] })(fVal);
    const fRes = executeKTVMExecutable(fExe, encodeToWire(fVal, fPat));
    assert.equal(fRes.status, "OK");
    assert.deepEqual(plainValue(decodeWire(fRes.wire, { eager: true }).value), plainValue(fRef));

    const rPat = [
      ["closed-product", [["den", 1], ["num", 1], ["sign", 2]]],
      ["closed-union", [["0", 1], ["1", 1], ["_", 3]]],
      ["closed-union", [["0", 3], ["1", 3]]],
      ["closed-product", []]
    ];
    const rVal = Value.product({
      sign: Value.variant("0", UNIT),
      num: parseIntVal("355").value,
      den: parseIntVal("113").value
    });
    const rExe = path.join(tmpDir, "ieee_ratio.exe");
    compileObjectToKTVMExecutable(ieeeLib, "ratio_to_float64", rPat, rExe, { optimize: true });
    const rRef = k.compile(ieeeLib.relAlias.ratio_to_float64, { libraries: [ieeeLib] })(rVal);
    const rRes = executeKTVMExecutable(rExe, encodeToWire(rVal, rPat));
    assert.equal(rRes.status, "OK");
    assert.deepEqual(plainValue(decodeWire(rRes.wire, { eager: true }).value), plainValue(rRef));
  });

  await test("Native lib/djson.k: full RFC 8259 parse_json (valid JSON + invalid JSON rejection)", async () => {
    codes.load(djsonLib.codes);
    const inPat = relationPatternPropertyList(djsonLib.rels[djsonLib.relAlias.parse_json], 0);
    const exe = path.join(tmpDir, "djson_parse.exe");
    compileObjectToKTVMExecutable(djsonLib, "parse_json", inPat, exe, { optimize: true });

    const srv = new PersistentExecutable(exe);
    try {
      for (const txt of ["{\"a\":[1,-3.5,true,null,\"hi\\n\"]}", "[10, 20]"]) {
        const val = textToStringValue(txt);
        const ref = k.compile(djsonLib.relAlias.parse_json, { libraries: [djsonLib] })(val);
        const payload = await srv.request(encodeToWire(val, inPat));
        assert.deepEqual(plainValue(decodeWire(payload, { eager: true }).value), plainValue(ref), `djson(${txt})`);
      }
    } finally {
      srv.close();
    }

    // Invalid JSON -> normal partial FAILED (exit 1, code -1)
    const badRes = executeKTVMExecutable(exe, encodeToWire(textToStringValue("{ invalid"), inPat));
    assert.equal(badRes.status, "FAILED");
  });

  console.log("\n=== 3. Quotas, Malformed Wire & Spec Semantics ===");

  await test("Native enforces quotas and rejects malformed k-wire / incompatible schema", async () => {
    codes.load(streamLib.codes);
    const inPat = relationPatternPropertyList(streamLib.rels[streamLib.relAlias.lsb_trim], 0);
    const exe = path.join(tmpDir, "lsb_trim_q.exe");
    compileObjectToKTVMExecutable(streamLib, "lsb_trim", inPat, exe, { optimize: false });

    const longWire = encodeToWire(bitsFromStr("0".repeat(200) + "1"), inPat);
    const qStep = executeKTVMExecutable(exe, longWire, { quota: { maxSteps: 5 } });
    assert.equal(qStep.status, "ERROR");
    assert.equal(qStep.errorCode, -2);

    // Incompatible schema -> KTVM_ERR_SCHEMA (-8)
    const wrongPat = [["closed-union", [["a", 1], ["b", 1]]], ["closed-product", []]];
    const wrongWire = encodeToWire(Value.variant("a", UNIT), wrongPat);
    const sErr = executeKTVMExecutable(exe, wrongWire);
    assert.equal(sErr.status, "ERROR");
    assert.equal(sErr.errorCode, -8);

    // Truncated wire -> KTVM_ERR_MALFORMED (-6)
    const mErr = executeKTVMExecutable(exe, longWire.subarray(0, longWire.length - 5));
    assert.equal(mErr.status, "ERROR");
    assert.equal(mErr.errorCode, -6);
  });

  await test("Native spec: local rollback, upstream failure abort, and after %tok", async () => {
    const src = `
      ktvm 0.1 mono entry @main;
      schema $bit = union { 0: unit, 1: unit };
      schema $pair = product { a: $bit, b: $bit };
      proc @fail_zero(%x: $bit) -> (%y: $bit) {
        chan %u: unit;
        match /1 %x -> %u;
        wrap |1 %u -> %y;
      }
      proc @main(%in: $pair) -> (%out: $bit) {
        chan %a: $bit; chan %b: $bit;
        demux %in : $pair -> (a: %a, b: %b);
        chan %a_ok: $bit;
        spawn @fail_zero(%a) -> (%a_ok) as %tok1;
        chan %b_pass: $bit;
        spawn @id_b(%b) -> (%b_pass) after %tok1;
        spec (%a_ok, %b_pass) -> (%out) {
          branch 0: {
            chan %u0: unit;
            match /0 %b_pass -> %u0;
            barrier %bar0;
            drain %u0 : unit -> %bar0;
            gate %bar0, %a_ok -> %out;
          }
          branch 1: {
            chan %u1: unit;
            match /1 %b_pass -> %u1;
            barrier %bar1;
            drain %u1 : unit -> %bar1;
            gate %bar1, %a_ok -> %out;
          }
        }
      }
      proc @id_b(%x: $bit) -> (%y: $bit) { splice %x -> %y; }
    `;
    const mod = parseModule(src);
    const exe = path.join(tmpDir, "spec_test.exe");
    compileKTVMToExecutable(mod, exe, { optimize: false });

    const pat = [
      ["closed-product", [["a", 1], ["b", 1]]],
      ["closed-union", [["0", 2], ["1", 2]]],
      ["closed-product", []]
    ];
    // (a=1, b=1): branch 0 fails locally -> rolls back & succeeds in branch 1!
    const okWire = encodeToWire(Value.product({ a: Value.variant("1", UNIT), b: Value.variant("1", UNIT) }), pat);
    const okRes = executeKTVMExecutable(exe, okWire, { telemetry: true });
    assert.equal(okRes.status, "OK");
    assert.equal(okRes.telemetry.specRollbacks, 1);
    assert.equal(okRes.telemetry.afterSettlements, 1);

    // (a=0, b=1): upstream %a_ok fails -> spec aborts immediately without rollback!
    const upFailWire = encodeToWire(Value.product({ a: Value.variant("0", UNIT), b: Value.variant("1", UNIT) }), pat);
    const failRes = executeKTVMExecutable(exe, upFailWire, { telemetry: true });
    assert.equal(failRes.status, "FAILED");
    assert.equal(failRes.telemetry.specUpstreamAborts, 1);
    assert.equal(failRes.telemetry.specRollbacks, 0);
  });

  await test("Native slab allocator & strict mux->demux fusion bound nodes and buffers on Karatsuba & spec stress", async () => {
    // 1. 10,000-bit recursive flip with 5,000 spec rollbacks
    const flipSrc = `
      ktvm 0.1 mono entry @flip;
      schema $bits = union { 0: $bits, 1: $bits, _: unit };
      proc @flip(%x: $bits) -> (%out: $bits) {
        switch (%x) {
          case (/0): {
            chan %rest : $bits; chan %flipped : $bits;
            spec (%x) -> (%rest) {
              branch 0: { chan %bad : $bits; match /1 %x -> %bad; splice %bad -> %rest; }
              branch 1: { match /0 %x -> %rest; }
            }
            spawn @flip(%rest) -> (%flipped);
            wrap |1 %flipped -> %out;
          }
          case (/1): {
            chan %rest : $bits; chan %flipped : $bits;
            match /1 %x -> %rest;
            spawn @flip(%rest) -> (%flipped);
            wrap |0 %flipped -> %out;
          }
          case (/_): { splice %x -> %out; }
        }
      }
    `;
    const flipExe = path.join(tmpDir, "flip_slab.exe");
    const flipMod = parseModule(flipSrc);
    compileKTVMToExecutable(flipMod, flipExe, { optimize: false });
    const bitsPat = [
      ["closed-union", [["0", 0], ["1", 0], ["_", 1]]],
      ["closed-product", []]
    ];
    const flipWire = encodeToWire(bitsFromStr("01".repeat(5000)), bitsPat);
    const flipRes = executeKTVMExecutable(flipExe, flipWire, { telemetry: true });
    assert.equal(flipRes.status, "OK");
    assert.equal(flipRes.telemetry.specRollbacks, 5000);
    assert.ok(flipRes.telemetry.peakBytes <= 65536, `expected bounded buffers <= 64 KiB, got ${flipRes.telemetry.peakBytes}`);

    // 2. Karatsuba 256b*256b: strict zero-copy mux->demux fusion keeps peak_nodes & peak_bytes tiny
    codes.load(integerLib.codes);
    const timesPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.times], 0);
    const mulExe = path.join(tmpDir, "times_slab.exe");
    compileObjectToKTVMExecutable(integerLib, "times", timesPat, mulExe, { optimize: true });
    const mulIn = Value.product({
      x: parseIntVal(String((1n << 255n) - 987654321n)),
      y: parseIntVal(String((1n << 255n) - 123456789n))
    });
    const mulRes = executeKTVMExecutable(mulExe, encodeToWire(mulIn, timesPat), { telemetry: true });
    assert.equal(mulRes.status, "OK");
    assert.ok(mulRes.telemetry.peakNodes <= 400, `expected bounded Karatsuba nodes <= 400, got ${mulRes.telemetry.peakNodes}`);
    assert.ok(mulRes.telemetry.peakBytes <= 16384, `expected bounded Karatsuba buffers <= 16 KiB, got ${mulRes.telemetry.peakBytes}`);
  });

  await test("Native fixed-width DPDA skip/copy & eager const/wrap/splice parity on 4,096-bit fanout and fixed-width products", async () => {
    const fwSrc = `
      ktvm 0.1 mono entry @main;
      schema $bit = union { 0: unit, 1: unit };
      schema $byte = product { b0: $bit, b1: $bit, b2: $bit, b3: $bit, b4: $bit, b5: $bit, b6: $bit, b7: $bit };
      schema $bytes = union { cons: product { car: $byte, cdr: $bytes }, nil: unit };
      schema $pair = product { a: $bytes, b: $bytes };
      proc @main(%in: $bytes) -> (%out: $pair) {
        chan %t0: $bytes; chan %t1: $bytes; chan %t2: $bytes;
        tee %in -> (%t0, %t1, %t2);
        barrier %bar;
        drain %t2 : $bytes -> %bar;
        chan %packed: $pair;
        mux (a: %t0, b: %t1) -> %packed : $pair;
        chan %p0: $pair; chan %p1: $pair;
        tee %packed -> (%p0, %p1);
        drain %p1 : $pair -> %bar;
        chan %da: $bytes; chan %db: $bytes;
        demux %p0 : $pair -> (a: %da, b: %db);
        chan %res: $pair;
        mux (a: %da, b: %db) -> %res : $pair;
        gate %bar, %res -> %out;
      }
    `;
    const fwExe = path.join(tmpDir, "dpda_fixed_width.exe");
    compileKTVMToExecutable(parseModule(fwSrc), fwExe, { optimize: false });
    const bytesPat = [
      ["closed-union", [["cons", 1], ["nil", 4]]],
      ["closed-product", [["car", 2], ["cdr", 0]]],
      ["closed-product", [["b0", 3], ["b1", 3], ["b2", 3], ["b3", 3], ["b4", 3], ["b5", 3], ["b6", 3], ["b7", 3]]],
      ["closed-union", [["0", 4], ["1", 4]]],
      ["closed-product", []]
    ];
    const pairPat = [
      ["closed-product", [["a", 1], ["b", 1]]],
      ["closed-union", [["cons", 2], ["nil", 5]]],
      ["closed-product", [["car", 3], ["cdr", 1]]],
      ["closed-product", [["b0", 4], ["b1", 4], ["b2", 4], ["b3", 4], ["b4", 4], ["b5", 4], ["b6", 4], ["b7", 4]]],
      ["closed-union", [["0", 5], ["1", 5]]],
      ["closed-product", []]
    ];
    const mkByte = (n) => Value.product(
      Object.fromEntries(Array.from({ length: 8 }, (_, b) => [`b${b}`, Value.variant(String((n >> b) & 1), UNIT)]))
    );
    let bs = Value.variant("nil", UNIT);
    for (let i = 255; i >= 0; i--) {
      bs = Value.variant("cons", Value.product({ car: mkByte(i), cdr: bs }));
    }
    const wire = encodeToWire(bs, bytesPat);
    const res = executeKTVMExecutable(fwExe, wire, { telemetry: true });
    assert.equal(res.status, "OK");
    const expectedWire = encodeToWire(Value.product({ a: bs, b: bs }), pairPat);
    assert.equal(
      Buffer.compare(Buffer.from(res.wire), Buffer.from(expectedWire)),
      0,
      "Fixed-width DPDA skip/copy + demux/drain output wire mismatch"
    );
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\nNative C/LLVM Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
