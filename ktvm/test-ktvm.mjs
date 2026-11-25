/**
 * Comprehensive Milestone 1 test suite for standalone `kTVM` (`k/ktvm/`).
 *
 * Covers:
 *   1. Parser, printer, and canonical JSON (`format: "k-tvm"`) round-trip on all
 *      4 worked examples from DOCS/KTVM_SPEC.md §10.
 *   2. Static validator positive & negative checks (SPSC linearity, local DAG
 *      acyclicity, mono schema strictness, dual-schema typing, and always-on
 *      static table-to-CFG bisimulation verification).
 *   3. Polymorphism & boundary specialization (`reverse.ktvmp` on `list[int[]]`
 *      and `list[product{a:int[], b:bits[]}]`, opaque preservation, cache hits,
 *      `KTVMSchemaError` on incompatible envelopes, `project`, `guard`, dead
 *      `switch` arm pruning, Moore-equivalent `coerce -> splice`).
 *   4. Operational semantics & zero-copy rewrites (O(1) tail-splice in `reverse`,
 *      same-scope `MUX -> DEMUX` bundle fusion, strict partiality `drain`/`barrier`/`gate`,
 *      `spec` local rollback + upstream-failure abort + tail-splice, `tee` fan-out,
 *      `after %tok` bounded-node sequential sibling settlement).
 *   5. Compiled kernels (`_lsb_add` with bisimulation-verified `chunk_table` + O(1)
 *      tail splice, `_lsb_trim` with virtual LIFO `BitStack` + `stack_table`).
 *   6. Hardening & quotas (`maxBitDequeBytes`, `maxNodes`, `maxSteps`, malformed
 *      `k-wire` envelopes, and 4,096-bit strictly iterative stress tests).
 */

import assert from "node:assert/strict";
import { Value } from "../Value.mjs";
import { encodeToWire, decodeWire, propertyListToPattern } from "../codecs/runtime/prefix-codec.mjs";
import {
  KTVM_FORMAT,
  KTVM_VERSION,
  KTVMSyntaxError,
  KTVMValidationError,
  KTVMSchemaError,
  KTVMQuotaError,
  BitDeque,
  BitStack,
  parseModule,
  printModule,
  moduleToJSON,
  moduleFromJSON,
  packInt32Base64,
  compileSchemaExprToPlist,
  mooreKey,
  schemasEquivalent,
  validateModule,
  specializeKTVM,
  clearSpecializationCache,
  executeKTVM,
  executeKTVMWire,
  splitEnvelopedWire,
  encodePayloadToDeque,
  decodeDequeToValue
} from "./index.mjs";

// --- Helpers to build K Values cleanly ---

const UNIT = Value.product({});

function bitsFromBigIntLSB(n) {
  let v = BigInt(n);
  const digits = [];
  while (v > 0n) {
    digits.push((v & 1n) === 1n ? "1" : "0");
    v >>= 1n;
  }
  let cur = Value.variant("_", UNIT);
  for (let i = digits.length - 1; i >= 0; i--) {
    cur = Value.variant(digits[i], cur);
  }
  return cur;
}

function bitsToBigIntLSB(val) {
  let acc = 0n;
  let shift = 0n;
  let cur = val;
  while (cur.tag !== "_") {
    if (cur.tag === "1") acc |= (1n << shift);
    shift += 1n;
    cur = cur.value;
  }
  return acc;
}

function bitsFromString(str) {
  let cur = Value.variant("_", UNIT);
  for (let i = str.length - 1; i >= 0; i--) {
    cur = Value.variant(str[i], cur);
  }
  return cur;
}

function bitsToString(val) {
  let s = "";
  let cur = val;
  while (cur.tag !== "_") {
    s += cur.tag;
    cur = cur.value;
  }
  return s;
}

function makeIntVal(n) {
  const sign = n < 0 ? "-" : "+";
  const mag = n < 0 ? -n : n;
  return Value.variant(sign, bitsFromBigIntLSB(mag));
}

function intValToNumber(v) {
  const mag = Number(bitsToBigIntLSB(v.value));
  return v.tag === "-" ? -mag : mag;
}

function makeList(items) {
  let cur = Value.variant("nil", UNIT);
  for (let i = items.length - 1; i >= 0; i--) {
    cur = Value.variant("cons", Value.product({ car: items[i], cdr: cur }));
  }
  return cur;
}

function listToArray(v) {
  const out = [];
  let cur = v;
  while (cur.tag === "cons") {
    out.push(cur.value.product.car);
    cur = cur.value.product.cdr;
  }
  assert.equal(cur.tag, "nil");
  return out;
}

// --- Test Harness ---

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

// --- Reusable Worked-Example Modules ---

const REVERSE_KTVMP = `
ktvm 0.1 poly entry @reverse;

schema $list[$X] = union {
  cons: product { car: $X, cdr: $list[$X] },
  nil:  unit
};

proc @reverse[$X](%in: $list[$X]) -> (%out: $list[$X]) {
  chan %acc_u : unit;
  chan %acc   : $list[$X];
  const_unit -> %acc_u;
  wrap |nil %acc_u -> %acc;
  spawn @_reverse[$X](%in, %acc) -> (%out);
}

proc @_reverse[$X](%xs: $list[$X], %acc: $list[$X]) -> (%out: $list[$X]) {
  switch (%xs) {
    case (/nil): {
      chan %u : unit;
      barrier %b;
      match /nil %xs -> %u;
      drain %u : unit -> %b;
      gate %b, %acc -> %out;
    }
    case (/cons): {
      chan %cell    : product { car: $X, cdr: $list[$X] };
      chan %car     : $X;
      chan %cdr     : $list[$X];
      chan %newcell : product { car: $X, cdr: $list[$X] };
      chan %newacc  : $list[$X];
      match /cons %xs -> %cell;
      demux %cell : product { car: $X, cdr: $list[$X] } -> (car: %car, cdr: %cdr);
      mux (car: %car, cdr: %acc) -> %newcell : product { car: $X, cdr: $list[$X] };
      wrap |cons %newcell -> %newacc;
      spawn @_reverse[$X](%cdr, %newacc) -> (%out);
    }
  }
}
`;

// Build a real, exact 2-bit x 2-bit (1 tag per port, 32 entries) chunk_table for `_lsb_add`!
function buildLsbAdd2x2Entries() {
  // Tag codes: 0 -> 0b00 (0), 1 -> 0b01 (1), _ -> 0b10 (2), 0b11 (3) = invalid
  // Exits: 0 = exit_zero_done, 1 = exit_carry_done, 2 = exit_splice_y, 3 = exit_splice_x
  const rows = [];
  for (let c = 0; c < 2; c++) {
    for (let tx = 0; tx < 4; tx++) {
      for (let ty = 0; ty < 4; ty++) {
        const idx = (c << 4) | (tx << 2) | ty;
        if (tx === 3 || ty === 3) {
          rows.push(`${idx} => { kind: FAIL };`);
          continue;
        }
        if (tx === 2 && ty === 2) {
          rows.push(`${idx} => { kind: EXIT, exit: ${c}, shift: [2, 2], emit_word: [0], emit_len: [0] };`);
        } else if (tx === 2) {
          if (c === 0) {
            rows.push(`${idx} => { kind: EXIT, exit: 2, shift: [2, 0], emit_word: [0], emit_len: [0] };`);
          } else {
            const sum = ty + 1;
            const outTag = sum & 1; // 0->0b00, 1->0b01
            const nextC = sum >> 1;
            rows.push(`${idx} => { kind: CONT, next_q: ${nextC}, shift: [0, 2], emit_word: [${outTag}], emit_len: [2] };`);
          }
        } else if (ty === 2) {
          if (c === 0) {
            rows.push(`${idx} => { kind: EXIT, exit: 3, shift: [0, 2], emit_word: [0], emit_len: [0] };`);
          } else {
            const sum = tx + 1;
            const outTag = sum & 1;
            const nextC = sum >> 1;
            rows.push(`${idx} => { kind: CONT, next_q: ${nextC}, shift: [2, 0], emit_word: [${outTag}], emit_len: [2] };`);
          }
        } else {
          const sum = tx + ty + c;
          const outTag = sum & 1;
          const nextC = sum >> 1;
          rows.push(`${idx} => { kind: CONT, next_q: ${nextC}, shift: [2, 2], emit_word: [${outTag}], emit_len: [2] };`);
        }
      }
    }
  }
  return rows.join("\n    ");
}

function makeLsbAddModule(tableEntriesStr) {
  return `
ktvm 0.1 mono entry @lsb_add;

schema $bits = union { 0: $bits, 1: $bits, _: unit };

proc @lsb_add(%x: $bits, %y: $bits) -> (%out: $bits) total {
  exec @_lsb_add_kernel(%x, %y) -> (%out);
}

kernel @_lsb_add_kernel(%x: $bits, %y: $bits) -> (%out: $bits) total tmc {
  reg c : enum(2) = 0;

  entry:
    yield %out, 64;
    table_step &tab_lsb_add, c, (%x, %y), (%out) -> exits {
      short: slow_step,
      0:     exit_zero_done,
      1:     exit_carry_done,
      2:     exit_splice_y,
      3:     exit_splice_x,
      fail:  err
    };

  slow_step:
    %tx = peek_bits %x, @0, 2 else err;
    %ty = peek_bits %y, @0, 2 else err;
    switch_bits %tx {
      case 0b10: goto x_end;
      case 0b00: goto x_0;
      case 0b01: goto x_1;
      default:   goto err;
    }

  x_end:
    switch_bits %ty {
      case 0b10: goto both_end;
      case 0b00: goto x_end_y_nz;
      case 0b01: goto x_end_y_nz;
      default:   goto err;
    }

  both_end:
    shift_tag %x, 2 -> unit;
    shift_tag %y, 2 -> unit;
    drain_guard %x : unit;
    drain_guard %y : unit;
    switch_reg c {
      case 0: goto exit_zero_done;
      case 1: goto exit_carry_done;
    }

  x_end_y_nz:
    switch_reg c {
      case 0: goto x_end_splice_y;
      case 1: goto x_end_prop_carry;
    }

  x_end_splice_y:
    shift_tag %x, 2 -> unit;
    drain_guard %x : unit;
    goto exit_splice_y;

  x_end_prop_carry:
    shift_tag %y, 2 -> $bits;
    switch_bits %ty {
      case 0b00: goto emit_1_c0;
      case 0b01: goto emit_0_c1;
      default:   goto err;
    }

  x_0:
    switch_bits %ty {
      case 0b10: goto y_end_x0;
      case 0b00: goto add_00;
      case 0b01: goto add_01;
      default:   goto err;
    }

  x_1:
    switch_bits %ty {
      case 0b10: goto y_end_x1;
      case 0b00: goto add_01;
      case 0b01: goto add_11;
      default:   goto err;
    }

  y_end_x0:
    switch_reg c {
      case 0: goto y_end_splice_x;
      case 1: goto y_end_x0_c1;
    }

  y_end_x1:
    switch_reg c {
      case 0: goto y_end_splice_x;
      case 1: goto y_end_x1_c1;
    }

  y_end_splice_x:
    shift_tag %y, 2 -> unit;
    drain_guard %y : unit;
    goto exit_splice_x;

  y_end_x0_c1:
    shift_tag %x, 2 -> $bits;
    goto emit_1_c0;

  y_end_x1_c1:
    shift_tag %x, 2 -> $bits;
    goto emit_0_c1;

  add_00:
    shift_tag %x, 2 -> $bits;
    shift_tag %y, 2 -> $bits;
    switch_reg c {
      case 0: goto emit_0_c0;
      case 1: goto emit_1_c0;
    }

  add_01:
    shift_tag %x, 2 -> $bits;
    shift_tag %y, 2 -> $bits;
    switch_reg c {
      case 0: goto emit_1_c0;
      case 1: goto emit_0_c1;
    }

  add_11:
    shift_tag %x, 2 -> $bits;
    shift_tag %y, 2 -> $bits;
    switch_reg c {
      case 0: goto emit_0_c1;
      case 1: goto emit_1_c1;
    }

  emit_0_c0:
    push_bits %out, 0b00, 2;
    set_reg c, 0;
    goto entry;

  emit_1_c0:
    push_bits %out, 0b01, 2;
    set_reg c, 0;
    goto entry;

  emit_0_c1:
    push_bits %out, 0b00, 2;
    set_reg c, 1;
    goto entry;

  emit_1_c1:
    push_bits %out, 0b01, 2;
    set_reg c, 1;
    goto entry;

  exit_zero_done:
    push_bits %out, 0b10, 2;
    close %out;
    retire;

  exit_carry_done:
    push_bits %out, 0b01, 2;
    push_bits %out, 0b10, 2;
    close %out;
    retire;

  exit_splice_y:
    splice %y -> %out;
    retire;

  exit_splice_x:
    splice %x -> %out;
    retire;

  err:
    fail;
}

table &tab_lsb_add chunk_table {
  states: 2;
  inputs: [
    { port: 0, raw_bits: 2, eff_bits: 2, compress: none },
    { port: 1, raw_bits: 2, eff_bits: 2, compress: none }
  ];
  outputs: [ { port: 0, mode: push, max_emit_bits: 2 } ];
  verified_against: @_lsb_add_kernel;
  mwtr: { rho: 4.0, bytes: 128, budget_class: "L1" };
  entries {
    ${tableEntriesStr}
  }
}
`;
}

// Online virtual-stack `_lsb_trim` kernel with real `stack_table` (W_s = 2, W_k = 1, depth_only)
function buildLsbTrimStackTableEntries() {
  // mode: 0 = scan, 1 = flush
  // sBits (2b): 0=0b00 ('0'), 1=0b01 ('1'), 2=0b10 ('_'), 3=0b11 (invalid)
  // depth_only (W_k = 1, stride = 2): d=0 (empty), d=1 (non-empty)
  const rows = [];
  for (let mode = 0; mode < 2; mode++) {
    for (let sBits = 0; sBits < 4; sBits++) {
      for (let d = 0; d < 2; d++) {
        const idx = (((mode << 2) | sBits) * 2) + d;
        if (mode === 1) {
          // flush deferred '0's from stack before reading next input!
          if (d === 1) {
            rows.push(`${idx} => { kind: CONT, next_q: 1, shift_stream: 0, pop_stack: 1, push_stack_word: 0, push_stack_len: 0, emit_word: 0, emit_len: 2 };`);
          } else {
            // stack empty -> emit deferred '1', back to scan!
            rows.push(`${idx} => { kind: CONT, next_q: 0, shift_stream: 0, pop_stack: 0, push_stack_word: 0, push_stack_len: 0, emit_word: 1, emit_len: 2 };`);
          }
          continue;
        }
        // mode === 0 (scan)
        if (sBits === 3) {
          rows.push(`${idx} => { kind: FAIL };`);
        } else if (sBits === 2) {
          // '_': exit to scan_eof (clears stack and emits '_')
          rows.push(`${idx} => { kind: EXIT, exit: 0, shift_stream: 2, pop_stack: 0, push_stack_word: 0, push_stack_len: 0, emit_word: 0, emit_len: 0 };`);
        } else if (sBits === 0) {
          // '0': defer onto stack z
          rows.push(`${idx} => { kind: CONT, next_q: 0, shift_stream: 2, pop_stack: 0, push_stack_word: 0, push_stack_len: 1, emit_word: 0, emit_len: 0 };`);
        } else {
          // '1': if stack empty emit '1' immediately; else pop 1 zero, emit '0', switch to flush!
          if (d === 0) {
            rows.push(`${idx} => { kind: CONT, next_q: 0, shift_stream: 2, pop_stack: 0, push_stack_word: 0, push_stack_len: 0, emit_word: 1, emit_len: 2 };`);
          } else {
            rows.push(`${idx} => { kind: CONT, next_q: 1, shift_stream: 2, pop_stack: 1, push_stack_word: 0, push_stack_len: 0, emit_word: 0, emit_len: 2 };`);
          }
        }
      }
    }
  }
  return rows.join("\n    ");
}

const LSB_TRIM_KTVM = `
ktvm 0.1 mono entry @lsb_trim;

schema $bits = union { 0: $bits, 1: $bits, _: unit };

proc @lsb_trim(%in: $bits) -> (%out: $bits) total {
  exec @_lsb_trim_kernel(%in) -> (%out);
}

kernel @_lsb_trim_kernel(%in: $bits) -> (%out: $bits) total tmc {
  reg mode : enum(2) = 0;
  stack z  : bits;

  entry:
    yield %out, 64;
    stack_table_step &tab_lsb_trim, mode, %in, z, %out -> exits {
      short: slow_step,
      0:     exit_eof_after_shift,
      fail:  err
    };

  slow_step:
    switch_reg mode {
      case 0: goto scan;
      case 1: goto flush;
    }

  scan:
    %t = peek_bits %in, @0, 2 else err;
    switch_bits %t {
      case 0b10: goto scan_eof;
      case 0b00: goto scan_zero;
      case 0b01: goto scan_one;
      default:   goto err;
    }

  scan_eof:
    shift_tag %in, 2 -> unit;
    goto exit_eof_after_shift;

  exit_eof_after_shift:
    drain_guard %in : unit;
    stack_clear z;
    push_bits %out, 0b10, 2;
    close %out;
    retire;

  scan_zero:
    shift_tag %in, 2 -> $bits;
    stack_push z, 0b0, 1;
    goto entry;

  scan_one:
    shift_tag %in, 2 -> $bits;
    %_top = stack_pop z, 1 else emit_one_scan;
    push_bits %out, 0b00, 2;
    set_reg mode, 1;
    goto entry;

  flush:
    %_top = stack_pop z, 1 else emit_one_scan;
    push_bits %out, 0b00, 2;
    goto entry;

  emit_one_scan:
    push_bits %out, 0b01, 2;
    set_reg mode, 0;
    goto entry;

  err:
    fail;
}

table &tab_lsb_trim stack_table {
  states: 2;
  stream_bits: 2;
  stack_bits: 1;
  stack_encoding: depth_only;
  output_mode: push;
  mwtr: { rho: 2.0, bytes: 128, budget_class: "L1" };
  entries {
    ${buildLsbTrimStackTableEntries()}
  }
}
`;

// ============================================================================
console.log("\n=== 1. Parser, Printer, JSON Artifact & BitDeque/BitStack ADT ===");
// ============================================================================

test("BitDeque push/unshift/peek/shift/wrap-around/adopt across 32-bit boundaries", () => {
  const dq = new BitDeque(1, { initialWords: 2 }); // 64-bit initial ring
  dq.pushBits(0b10110, 5);
  dq.unshiftBits(0b110, 3);
  assert.equal(dq.toBitString(), "11010110");
  assert.equal(dq.peekBits(8), 0b11010110);
  assert.equal(dq.peekBitsAt(3, 5), 0b10110);

  // Force ring wrap & growth past 64 bits
  for (let i = 0; i < 20; i++) {
    dq.pushBits(0xdeadbeef >>> 0, 32);
    assert.equal(dq.shiftBits(8), i === 0 ? 0b11010110 : 0xef);
    // keep shifting to exercise wrap-around
    if (i === 0) {
      assert.equal(dq.shiftBits(24), 0xdeadbe);
    } else {
      assert.equal(dq.shiftBits(24), 0xdeadbe);
    }
  }
  assert.equal(dq.shiftBits(8), 0xef);
  assert.equal(dq.length, 0);

  // Test unshiftFromDeque + adoptBufferFrom
  const a = new BitDeque(2);
  const b = new BitDeque(3);
  a.pushBits(0b101011, 6);
  b.pushBits(0b11001, 5);
  b.unshiftFromDeque(a);
  assert.equal(a.length, 0);
  assert.equal(b.toBitString(), "10101111001");
  a.adoptBufferFrom(b);
  assert.equal(b.length, 0);
  assert.equal(a.toBitString(), "10101111001");
  a.release();
  b.release();
  dq.release();
});

test("BitStack push/peekTop/pop/grow/clear LIFO fidelity", () => {
  const st = new BitStack(null, 1);
  st.push(0b10, 2);
  assert.equal(st.peekTop(2), 0b10);
  st.push(1, 1);
  assert.equal(st.pop(1), 1);
  assert.equal(st.pop(2), 0b10);
  assert.equal(st.length, 0);
  // Push > 200 bits to force growth
  for (let i = 0; i < 200; i++) st.push(i & 1, 1);
  for (let i = 199; i >= 0; i--) assert.equal(st.pop(1), i & 1);
  st.release();
});

test("Round-trip parse -> print -> re-parse -> JSON export/import on all worked examples", () => {
  const sources = [
    REVERSE_KTVMP,
    makeLsbAddModule(buildLsbAdd2x2Entries()),
    LSB_TRIM_KTVM,
    `
      ktvm 0.1 mono entry @branch_demo;
      schema $bits = union { 0: $bits, 1: $bits, _: unit };
      proc @id(%x: $bits) -> (%o: $bits) total { splice %x -> %o; }
      proc @branch_demo(%x: $bits) -> (%o: $bits) branching {
        chan %x0 : $bits; chan %x1 : $bits;
        chan %a  : $bits; chan %b  : $bits;
        barrier %bar;
        tee %x -> (%x0, %x1);
        spawn @id(%x0) -> (%a) as %t0;
        spawn @id(%x1) -> (%b) after %t0;
        drain %a : $bits -> %bar;
        gate %bar, %b -> %o;
      }
    `
  ];
  for (const src of sources) {
    const ast1 = parseModule(src);
    const printed1 = printModule(ast1);
    const ast2 = parseModule(printed1);
    const printed2 = printModule(ast2);
    assert.equal(printed1, printed2, "printer must be idempotent");

    const json = moduleToJSON(ast1);
    assert.equal(json.format, KTVM_FORMAT);
    assert.equal(json.formatVersion, KTVM_VERSION);
    const hydrated = moduleFromJSON(JSON.parse(JSON.stringify(json)));
    assert.equal(printModule(hydrated), printed1, "JSON artifact round-trip must be lossless");
  }
});

test("Parser rejects malformed syntax with KTVMSyntaxError", () => {
  assert.throws(() => parseModule("ktvm 0.1 bogus;"), KTVMSyntaxError);
  assert.throws(() => parseModule("ktvm 0.1 mono; proc bad() -> () {}"), KTVMSyntaxError);
});

// ============================================================================
console.log("\n=== 2. Static Validator & Always-On Table-to-CFG Bisimulation ===");
// ============================================================================

test("Validator accepts valid poly and mono modules (including verified _lsb_add chunk_table)", () => {
  assert.equal(validateModule(parseModule(REVERSE_KTVMP)).ok, true);
  assert.equal(validateModule(parseModule(makeLsbAddModule(buildLsbAdd2x2Entries()))).ok, true);
  assert.equal(validateModule(parseModule(LSB_TRIM_KTVM)).ok, true);
});

test("Validator catches SPSC linearity violations (double-consume, unproduced, unused)", () => {
  assert.throws(
    () => validateModule(parseModule(`
      ktvm 0.1 mono entry @bad;
      schema $b = union { _: unit };
      proc @bad(%x: $b) -> (%o: $b) {
        chan %d : $b;
        splice %x -> %o;
        splice %x -> %d;
        drain %d : $b;
      }
    `)),
    KTVMValidationError
  );
  assert.throws(
    () => validateModule(parseModule(`
      ktvm 0.1 mono entry @bad;
      schema $b = union { _: unit };
      proc @bad(%x: $b) -> (%o: $b) {
        drain %x : $b;
      }
    `)),
    KTVMValidationError
  );
});

test("Validator catches local channel DAG cycle", () => {
  assert.throws(
    () => validateModule(parseModule(`
      ktvm 0.1 mono entry @cyc;
      schema $b = union { _: unit };
      proc @cyc(%x: $b) -> (%o: $b) {
        chan %a : $b;
        chan %b : $b;
        splice %a -> %b;
        splice %b -> %a;
        splice %x -> %o;
      }
    `)),
    KTVMValidationError
  );
});

test("Validator rejects open/any schemas and polymorphic ops in mono modules", () => {
  assert.throws(
    () => validateModule(parseModule(`
      ktvm 0.1 mono entry @p;
      schema $open = open_product { a: unit ... };
      proc @p(%x: $open) -> (%o: $open) { splice %x -> %o; }
    `)),
    KTVMValidationError
  );
});

test("Validator rejects schema mismatch in mono splice", () => {
  assert.throws(
    () => validateModule(parseModule(`
      ktvm 0.1 mono entry @bad;
      schema $a = union { x: unit, y: unit };
      schema $b = union { x: unit, z: unit };
      proc @bad(%in: $a) -> (%out: $b) { splice %in -> %out; }
    `)),
    KTVMValidationError
  );
});

test("Static table-to-CFG bisimulation catches an intentionally corrupted chunk_table entry!", () => {
  const goodEntries = buildLsbAdd2x2Entries();
  // Corrupt entry 0 (c=0, tx=0, ty=0): change emit_word from [0] to [1]!
  const badEntries = goodEntries.replace(
    "0 => { kind: CONT, next_q: 0, shift: [2, 2], emit_word: [0], emit_len: [2] };",
    "0 => { kind: CONT, next_q: 0, shift: [2, 2], emit_word: [1], emit_len: [2] };"
  );
  const badMod = parseModule(makeLsbAddModule(badEntries));
  assert.throws(
    () => validateModule(badMod, { verifyTables: true }),
    (err) => err instanceof KTVMValidationError && /bisimulation/i.test(err.message)
  );
  // Opt-out flag skips bisimulation check
  assert.equal(validateModule(badMod, { verifyTables: false }).ok, true);
});

// ============================================================================
console.log("\n=== 3. Polymorphism, Boundary Specialization & Opaque Payloads ===");
// ============================================================================

test("Specialize reverse.ktvmp for list[int[]], execute enveloped k-wire, verify bit-exactness & O(1) tail-splice", () => {
  clearSpecializationCache();
  const listIntSchemaMod = parseModule(`
    ktvm 0.1 mono;
    schema $bits = union { 0: $bits, 1: $bits, _: unit };
    schema $int  = union { "+": $bits, "-": $bits };
    schema $list_int = union { cons: product { car: $int, cdr: $list_int }, nil: unit };
  `);
  const listIntPlist = compileSchemaExprToPlist(
    { kind: "ref", name: "$list_int", args: [] },
    listIntSchemaMod.schemas
  );

  const inputNums = [1, -2, 3, 0, 42, -1023, 7, 15, -99, 256];
  const inputVal = makeList(inputNums.map(makeIntVal));
  const inWire = encodeToWire(inputVal, listIntPlist);

  const r1 = executeKTVMWire(REVERSE_KTVMP, inWire);
  assert.equal(r1.status, "OK");
  assert.equal(r1.specialized.cached, false);
  const outNums = listToArray(r1.value).map(intValToNumber);
  assert.deepEqual(outNums, [...inputNums].reverse());

  // Verify output wire decodes identically via K's canonical `decodeWire`!
  const decodedByK = decodeWire(r1.wire, { eager: true }).value;
  assert.deepEqual(listToArray(decodedByK).map(intValToNumber), [...inputNums].reverse());

  // Second call hits specialization cache!
  const r2 = executeKTVMWire(REVERSE_KTVMP, inWire);
  assert.equal(r2.status, "OK");
  assert.equal(r2.specialized.cached, true);
  assert.deepEqual(r2.wire, r1.wire);

  // Verify O(1) tail-splice behavior: total spliceBitsCopied scales O(total input bits), NOT O(n^2)!
  const longNums = Array.from({ length: 80 }, (_, i) => i + 1);
  const longWire = encodeToWire(makeList(longNums.map(makeIntVal)), listIntPlist);
  const rLong = executeKTVMWire(REVERSE_KTVMP, longWire);
  assert.equal(rLong.status, "OK");
  assert.deepEqual(listToArray(rLong.value).map(intValToNumber), [...longNums].reverse());
  // For 80 ints (~16 bits each -> ~1,400 bits total), O(n^2) would copy > 50,000 bits;
  // O(1) tail-splice copies ONLY the prepended car + 1-bit cons tag (~1,600 bits)!
  assert.ok(
    rLong.telemetry.spliceBitsCopied < 4000,
    `Expected O(n) splice bits copied, got ${rLong.telemetry.spliceBitsCopied}`
  );
});

test("Specialize reverse.ktvmp on list[product { a: int[], b: bits[] }] preserving opaque product payload", () => {
  const schemaMod = parseModule(`
    ktvm 0.1 mono;
    schema $bits = union { 0: $bits, 1: $bits, _: unit };
    schema $int  = union { "+": $bits, "-": $bits };
    schema $pair = product { a: $int, b: $bits };
    schema $list_pair = union { cons: product { car: $pair, cdr: $list_pair }, nil: unit };
  `);
  const listPairPlist = compileSchemaExprToPlist(
    { kind: "ref", name: "$list_pair", args: [] },
    schemaMod.schemas
  );

  const items = [
    Value.product({ a: makeIntVal(5), b: bitsFromString("101") }),
    Value.product({ a: makeIntVal(-12), b: bitsFromString("00110") }),
    Value.product({ a: makeIntVal(0), b: bitsFromString("") })
  ];
  const inWire = encodeToWire(makeList(items), listPairPlist);

  const res = executeKTVMWire(REVERSE_KTVMP, inWire);
  assert.equal(res.status, "OK");
  // Check access profile recognized `$X` as an opaque product!
  const profiles = Object.values(res.specialized.accessProfiles);
  assert.ok(profiles.some((p) => p.opaqueParams.includes("$X")));

  const outArr = listToArray(res.value);
  assert.equal(outArr.length, 3);
  assert.equal(intValToNumber(outArr[0].product.a), 0);
  assert.equal(bitsToString(outArr[0].product.b), "");
  assert.equal(intValToNumber(outArr[1].product.a), -12);
  assert.equal(bitsToString(outArr[1].product.b), "00110");
  assert.equal(intValToNumber(outArr[2].product.a), 5);
  assert.equal(bitsToString(outArr[2].product.b), "101");
});

test("Boundary specialization rejects incompatible input envelope with KTVMSchemaError", () => {
  const bitsSchemaMod = parseModule(`
    ktvm 0.1 mono;
    schema $bits = union { 0: $bits, 1: $bits, _: unit };
  `);
  const bitsPlist = compileSchemaExprToPlist(
    { kind: "ref", name: "$bits", args: [] },
    bitsSchemaMod.schemas
  );
  const badWire = encodeToWire(bitsFromString("101"), bitsPlist);
  assert.throws(() => executeKTVMWire(REVERSE_KTVMP, badWire), KTVMSchemaError);
});

test("Polymorphic project .f on open_product + guard ?$P + dead switch arm pruning + Moore coerce collapse", () => {
  const polyMod = `
    ktvm 0.1 poly entry @pick_a;

    schema $bits = union { 0: $bits, 1: $bits, _: unit };
    schema $bits_alias = union { 0: $bits_alias, 1: $bits_alias, _: unit };
    schema $has_a = open_product { a: $bits ... };

    proc @pick_a(%in: $has_a) -> (%out: $bits_alias) {
      chan %a1 : $bits;
      chan %a2 : $bits;
      project .a %in : $has_a -> %a1 : $bits;
      guard ?$bits %a1 -> %a2;
      coerce %a2 : $bits -> %out : $bits_alias;
    }
  `;

  const recSchemaMod = parseModule(`
    ktvm 0.1 mono;
    schema $bits = union { 0: $bits, 1: $bits, _: unit };
    schema $rec = product { a: $bits, b: $bits, c: unit };
  `);
  const recPlist = compileSchemaExprToPlist({ kind: "ref", name: "$rec", args: [] }, recSchemaMod.schemas);
  const val = Value.product({
    a: bitsFromString("1101"),
    b: bitsFromString("000"),
    c: UNIT
  });
  const wire = encodeToWire(val, recPlist);

  const res = executeKTVMWire(polyMod, wire);
  assert.equal(res.status, "OK");
  assert.equal(bitsToString(res.value), "1101");

  // Confirm Moore-equivalent `coerce` collapsed into `splice` and `project` lowered to `demux`+`drain`+`gate`!
  const specText = printModule(res.specialized.module);
  assert.ok(!specText.includes("project"), "project must be eliminated in mono");
  assert.ok(!specText.includes("guard"), "guard must be eliminated in mono");
  assert.ok(!specText.includes("coerce"), "Moore-equivalent coerce must collapse to splice");
  assert.ok(specText.includes("demux") && specText.includes("drain") && specText.includes("gate"));
});

// ============================================================================
console.log("\n=== 4. Operational Semantics, Rewrites, Partiality, Spec & After ===");
// ============================================================================

test("Same-scope MUX -> wrap |cons -> match /cons -> DEMUX performs O(1) zero-copy bundle fusion", () => {
  const fusionMod = `
    ktvm 0.1 mono entry @swap_via_cons;

    schema $bits = union { 0: $bits, 1: $bits, _: unit };
    schema $pair = product { a: $bits, b: $bits };
    schema $box  = union { box: $pair, empty: unit };

    proc @swap_via_cons(%x: $bits, %y: $bits) -> (%out: $pair) {
      chan %p1  : $pair;
      chan %bx  : $box;
      chan %p2  : $pair;
      chan %a   : $bits;
      chan %b   : $bits;

      mux (a: %x, b: %y) -> %p1 : $pair;
      wrap |box %p1 -> %bx;
      match /box %bx -> %p2;
      demux %p2 : $pair -> (a: %a, b: %b);
      mux (a: %b, b: %a) -> %out : $pair;
    }
  `;

  const res = executeKTVM(fusionMod, [bitsFromString("101100"), bitsFromString("01")]);
  assert.equal(res.status, "OK");
  assert.equal(bitsToString(res.value.product.a), "01");
  assert.equal(bitsToString(res.value.product.b), "101100");
  assert.ok(
    res.telemetry.muxDemuxFusions >= 1,
    `Expected MUX->DEMUX fusion, got ${res.telemetry.muxDemuxFusions}`
  );
});

test("Strict K partiality: failing discarded sibling fails gated output via drain/barrier/gate", () => {
  const partialMod = `
    ktvm 0.1 mono entry @keep_second_strict;

    schema $ab = union { a: unit, b: unit };
    schema $bits = union { 0: $bits, 1: $bits, _: unit };

    proc @keep_second_strict(%flag: $ab, %val: $bits) -> (%out: $bits) {
      chan %u : unit;
      barrier %bar;
      match /a %flag -> %u;
      drain %u : unit -> %bar;
      gate %bar, %val -> %out;
    }
  `;

  const ok = executeKTVM(partialMod, [Value.variant("a", UNIT), bitsFromString("101")]);
  assert.equal(ok.status, "OK");
  assert.equal(bitsToString(ok.value), "101");

  // When %flag is /b, match /a fails -> drain fails %bar -> gate fails %out!
  const fail = executeKTVM(partialMod, [Value.variant("b", UNIT), bitsFromString("101")]);
  assert.equal(fail.status, "FAILED");
});

test("spec: (a) local mismatch rolls back bit-exact replay; (b) upstream failure aborts skipping branch 1", () => {
  const specMod = `
    ktvm 0.1 mono entry @try_ab;

    schema $tag = union { a: $bits, b: $bits, c: $bits };
    schema $bits = union { 0: $bits, 1: $bits, _: unit };

    proc @try_ab(%in: $tag) -> (%out: $bits) {
      spec (%in) -> (%out) {
        branch 0: {
          // Only succeeds if /a AND leading bit is 1!
          chan %p : $bits;
          chan %rest : $bits;
          match /a %in -> %p;
          match /1 %p -> %rest;
          wrap |0 %rest -> %out;
        }
        branch 1: {
          // Fallback: if /a with leading bit 0, match it (proving exact rollback of BOTH /a AND bit 0!)
          chan %p : $bits;
          chan %rest : $bits;
          match /a %in -> %p;
          match /0 %p -> %rest;
          wrap |1 %rest -> %out;
        }
        branch 2: {
          // Last branch (tail-spliced!): match /b
          match /b %in -> %out;
        }
      }
    }

    // Pipeline testing Rule 1 (Upstream Failure Abort): upstream match /a fails on /c,
    // so downstream spec MUST abort immediately WITHOUT running branch 1!
    proc @upstream_abort_test(%raw: $tag) -> (%out: $bits) {
      chan %mid : $bits;
      match /a %raw -> %mid;
      spec (%mid) -> (%out) {
        branch 0: {
          match /1 %mid -> %out;
        }
        branch 1: {
          // Would succeed if invoked on a non-failed input, or fail with a rollback counter
          splice %mid -> %out;
        }
      }
    }
  `;

  // Branch 0 commits directly
  const r0 = executeKTVM(specMod, [Value.variant("a", bitsFromString("101"))]);
  assert.equal(r0.status, "OK");
  assert.equal(bitsToString(r0.value), "001");
  assert.equal(r0.telemetry.specRollbacks, 0);

  // Branch 0 fails after consuming /a AND inspecting '0' -> exact replay rollback -> branch 1 succeeds!
  const r1 = executeKTVM(specMod, [Value.variant("a", bitsFromString("011"))]);
  assert.equal(r1.status, "OK");
  assert.equal(bitsToString(r1.value), "111");
  assert.equal(r1.telemetry.specRollbacks, 1);

  // Branches 0 & 1 fail -> branch 2 tail-splices cleanly!
  const r2 = executeKTVM(specMod, [Value.variant("b", bitsFromString("110"))]);
  assert.equal(r2.status, "OK");
  assert.equal(bitsToString(r2.value), "110");
  assert.equal(r2.telemetry.specRollbacks, 2);
  assert.equal(r2.telemetry.specTailSplices, 1);

  // All branches fail -> FAILED
  const r3 = executeKTVM(specMod, [Value.variant("c", bitsFromString("1"))]);
  assert.equal(r3.status, "FAILED");

  // Upstream failure abort: %mid fails upstream because %raw is /c -> spec MUST abort immediately!
  const rAbort = executeKTVM(specMod, [Value.variant("c", bitsFromString("1"))], {
    entry: "@upstream_abort_test"
  });
  assert.equal(rAbort.status, "FAILED");
  assert.equal(rAbort.telemetry.specUpstreamAborts, 1);
  assert.equal(rAbort.telemetry.specRollbacks, 0, "upstream failure must NOT roll back to branch 1");
});

test("after %tok sequential sibling settlement bounds peak active nodes on binary tree recursion", () => {
  // Binary tree recursion of depth d (2^d leaves): without `after`, concurrent expansion
  // could live-materialize both subtrees simultaneously; WITH `after %t0`, left settles
  // completely before right expands -> O(d) peak nodes!
  const treeMod = `
    ktvm 0.1 mono entry @tree_eval;

    schema $bits = union { 0: $bits, 1: $bits, _: unit };

    proc @tree_eval(%d: $bits) -> (%out: $bits) branching {
      switch (%d) {
        case (/_): {
          chan %u : unit;
          barrier %b;
          chan %z : unit;
          match /_ %d -> %u;
          drain %u : unit -> %b;
          const_unit -> %z;
          chan %res : $bits;
          wrap |_ %z -> %res;
          gate %b, %res -> %out;
        }
        case (/0): {
          chan %rest : $bits;
          chan %r0 : $bits;
          chan %r1 : $bits;
          chan %a : $bits;
          chan %b : $bits;
          barrier %bar;
          match /0 %d -> %rest;
          tee %rest -> (%r0, %r1);
          spawn @tree_eval(%r0) -> (%a) as %t0;
          spawn @tree_eval(%r1) -> (%b) after %t0;
          drain %a : $bits -> %bar;
          gate %bar, %b -> %out;
        }
        case (/1): {
          chan %rest : $bits;
          match /1 %d -> %rest;
          spawn @tree_eval(%rest) -> (%out);
        }
      }
    }
  `;

  // Depth 8 -> 2^8 = 256 recursive calls, but peak live nodes stays O(depth) (< 60)!
  const res = executeKTVM(treeMod, [bitsFromString("00000000")]);
  assert.equal(res.status, "OK");
  assert.equal(bitsToString(res.value), "");
  assert.ok(res.telemetry.afterSettlements >= 255, `expected >= 255 after settlements, got ${res.telemetry.afterSettlements}`);
  assert.ok(
    res.telemetry.peakActiveNodes < 80,
    `Expected O(depth) peak nodes (< 80) for 2^8 tree, got ${res.telemetry.peakActiveNodes}`
  );
});

// ============================================================================
console.log("\n=== 5. Accelerated Kernels: TMC _lsb_add & Virtual-Stack _lsb_trim ===");
// ============================================================================

test("TMC _lsb_add kernel with bisimulation-verified chunk_table matches BigInt addition across edge cases", () => {
  const modSrc = makeLsbAddModule(buildLsbAdd2x2Entries());
  const pairs = [
    [0n, 0n],
    [0n, 1n],
    [1n, 0n],
    [1n, 1n],
    [7n, 1n],
    [255n, 1n],
    [123456n, 987654n],
    [(1n << 200n) - 1n, 1n],          // 200-bit carry chain!
    [(1n << 256n) + 42n, 5n],         // uneven lengths (triggers O(1) tail splice!)
    [3n, (1n << 300n) + 12345n]       // symmetric uneven lengths (exit_splice_y)
  ];

  for (const [a, b] of pairs) {
    const res = executeKTVM(modSrc, [bitsFromBigIntLSB(a), bitsFromBigIntLSB(b)]);
    assert.equal(res.status, "OK");
    assert.equal(bitsToBigIntLSB(res.value), a + b, `${a} + ${b}`);
    assert.ok(res.telemetry.tableLookups >= 1, "chunk_table must be executed");
  }
});

test("Virtual-stack _lsb_trim kernel with stack_table trims trailing zeros including 4,096-bit stream", () => {
  const cases = [
    ["", ""],
    ["0", ""],
    ["00000000", ""],
    ["1", "1"],
    ["10000", "1"],
    ["001001000", "001001"],
    ["0101010000000", "010101"],
    ["0".repeat(2000) + "1" + "0".repeat(2095), "0".repeat(2000) + "1"]
  ];

  for (const [inp, expected] of cases) {
    const res = executeKTVM(LSB_TRIM_KTVM, [bitsFromString(inp)]);
    assert.equal(res.status, "OK");
    assert.equal(bitsToString(res.value), expected, `trim(${inp.slice(0, 20)}...)`);
    assert.ok(res.telemetry.tableLookups >= 1, "stack_table must be executed");
  }
});

// ============================================================================
console.log("\n=== 6. Runtime Quotas, Malformed k-wire & Deep Iterative Stress ===");
// ============================================================================

test("Runtime quotas enforce maxSteps, maxNodes, and maxBitDequeBytes with KTVMQuotaError", () => {
  const modSrc = makeLsbAddModule(buildLsbAdd2x2Entries());
  const bigA = bitsFromBigIntLSB((1n << 256n) - 1n);
  const bigB = bitsFromBigIntLSB(1n);

  // Confirm single-kernel TMC executes in literally 1 live node!
  const okSingle = executeKTVM(modSrc, [bigA, bigB]);
  assert.equal(okSingle.telemetry.peakActiveNodes, 1);

  assert.throws(
    () => executeKTVM(modSrc, [bigA, bigB], { quota: { maxSteps: 5 } }),
    (err) => err instanceof KTVMQuotaError && err.quotaKind === "maxSteps"
  );
  assert.throws(
    () => executeKTVM(modSrc, [bigA, bigB], { quota: { maxNodes: 0 } }),
    (err) => err instanceof KTVMQuotaError && err.quotaKind === "maxNodes"
  );
  assert.throws(
    () => executeKTVM(modSrc, [bigA, bigB], { quota: { maxBitDequeBytes: 32 } }),
    (err) => err instanceof KTVMQuotaError && err.quotaKind === "maxBitDequeBytes"
  );
});

test("Malformed k-wire envelopes (truncated, invalid ordinal, nonzero padding) are cleanly rejected", () => {
  const bitsMod = parseModule(`
    ktvm 0.1 mono;
    schema $bits = union { 0: $bits, 1: $bits, _: unit };
  `);
  const bitsPlist = compileSchemaExprToPlist({ kind: "ref", name: "$bits", args: [] }, bitsMod.schemas);
  const validWire = encodeToWire(bitsFromString("101"), bitsPlist);

  // 1. Truncated wire
  assert.throws(() => splitEnvelopedWire(validWire.slice(0, validWire.length - 1)));

  // 2. Nonzero trailing byte padding (flip LSB of last byte if it's padding, or add an extra byte)
  const paddedBad = new Uint8Array(validWire.length + 1);
  paddedBad.set(validWire);
  paddedBad[paddedBad.length - 1] = 0x01;
  assert.throws(() => splitEnvelopedWire(paddedBad));

  // 3. Invalid 0b11 ordinal directly in BitDeque passed to _lsb_trim
  const badDq = new BitDeque(999, { prodSchema: bitsPlist, consSchema: bitsPlist });
  badDq.pushBits(0b11, 2); // invalid 3rd ordinal on 3-tag union!
  badDq.close();
  const res = executeKTVM(LSB_TRIM_KTVM, [badDq]);
  assert.equal(res.status, "FAILED");
});

test("Strictly iterative 4,096-bit k-wire encode + execute + decode with zero host stack overflow", () => {
  const bitsMod = parseModule(`
    ktvm 0.1 mono;
    schema $bits = union { 0: $bits, 1: $bits, _: unit };
  `);
  const bitsPlist = compileSchemaExprToPlist({ kind: "ref", name: "$bits", args: [] }, bitsMod.schemas);

  const deepStr = "10".repeat(2048); // 4,096 nested union constructors!
  const deepVal = bitsFromString(deepStr);

  // Strictly iterative payload encode & decode
  const dq = new BitDeque(500, { prodSchema: bitsPlist, consSchema: bitsPlist });
  encodePayloadToDeque(deepVal, bitsPlist, dq, 0);
  dq.close();
  assert.equal(dq.length, 4097 * 2);

  // Run through `_lsb_add` (+ 1) strictly iteratively!
  const oneDq = new BitDeque(501, { prodSchema: bitsPlist, consSchema: bitsPlist });
  encodePayloadToDeque(bitsFromString("1"), bitsPlist, oneDq, 0);
  oneDq.close();

  const res = executeKTVM(makeLsbAddModule(buildLsbAdd2x2Entries()), [dq, oneDq]);
  assert.equal(res.status, "OK");
  assert.equal(bitsToBigIntLSB(res.value), bitsToBigIntLSB(deepVal) + 1n);

  // Verify iterative decode on output deque directly
  const outVal = decodeDequeToValue(res.outputDeques[0], bitsPlist, 0, { exact: true });
  assert.equal(bitsToBigIntLSB(outVal), bitsToBigIntLSB(deepVal) + 1n);
});

test("Dead switch arm pruning on open_union + non-equivalent coerce (tag widening)", () => {
  const polyMod = `
    ktvm 0.1 poly entry @widen_ab;

    schema $in_open = open_union { a: unit ... };
    schema $out_wide = union { a: unit, b: unit, c: unit, d: unit };

    proc @widen_ab(%in: $in_open) -> (%out: $out_wide) {
      switch (%in) {
        case (/a): {
          coerce %in : $in_open -> %out : $out_wide;
        }
        case (/b): {
          coerce %in : $in_open -> %out : $out_wide;
        }
        case (/c): {
          coerce %in : $in_open -> %out : $out_wide;
        }
      }
    }
  `;

  // Supply concrete closed union with ONLY { a, b } (1-bit tag!), missing /c!
  const abMod = parseModule(`
    ktvm 0.1 mono;
    schema $ab = union { a: unit, b: unit };
  `);
  const abPlist = compileSchemaExprToPlist({ kind: "ref", name: "$ab", args: [] }, abMod.schemas);

  const rA = executeKTVMWire(polyMod, encodeToWire(Value.variant("a", UNIT), abPlist));
  assert.equal(rA.status, "OK");
  assert.equal(rA.value.tag, "a");
  // Verify dead `/c` arm was statically pruned in specialized mono module!
  const specText = printModule(rA.specialized.module);
  assert.ok(!specText.includes("case (/c)"), "unreachable /c switch arm must be pruned");
  // Verify output wire is 2-bit tag widened `{ a, b, c, d }` decoded cleanly by K's decodeWire
  assert.equal(decodeWire(rA.wire, { eager: true }).value.tag, "a");

  const rB = executeKTVMWire(polyMod, encodeToWire(Value.variant("b", UNIT), abPlist));
  assert.equal(rB.status, "OK");
  assert.equal(decodeWire(rB.wire, { eager: true }).value.tag, "b");
});

test("packed_base64 chunk_table + fsm_table_step + kernel handoff work end-to-end", () => {
  // Pack a tiny 4-entry fsm_table for flipping a single leading bit on $bits and handing off to @id!
  const fsmMod = `
    ktvm 0.1 mono entry @flip_first_bit;

    schema $bits = union { 0: $bits, 1: $bits, _: unit };

    proc @id_tail(%x: $bits) -> (%o: $bits) total {
      splice %x -> %o;
    }

    proc @flip_first_bit(%x: $bits) -> (%o: $bits) total {
      exec @_flip_head(%x) -> (%o);
    }

    kernel @_flip_head(%x: $bits) -> (%o: $bits) total {
      entry:
        fsm_table_step &tab_flip, %x, (%o) -> exits {
          short: err,
          0:     handoff_tail,
          1:     done_empty,
          fail:  err
        };

      handoff_tail:
        handoff @id_tail(%x) -> (%o);

      done_empty:
        drain_guard %x : unit;
        push_bits %o, 0b10, 2;
        close %o;
        retire;

      err:
        fail;
    }

    table &tab_flip fsm_table {
      input_bits: 2;
      output_modes: [ push ];
      entries {
        0 => { kind: EXIT, exit: 0, shift: [2], emit_word: [1], emit_len: [2] };
        1 => { kind: EXIT, exit: 0, shift: [2], emit_word: [0], emit_len: [2] };
        2 => { kind: EXIT, exit: 1, shift: [2], emit_word: [0], emit_len: [0] };
        3 => { kind: FAIL };
      }
    }
  `;

  const r0 = executeKTVM(fsmMod, [bitsFromString("0110")]);
  assert.equal(r0.status, "OK");
  assert.equal(bitsToString(r0.value), "1110");
  assert.equal(r0.telemetry.tableLookups, 1);

  const r1 = executeKTVM(fsmMod, [bitsFromString("100")]);
  assert.equal(r1.status, "OK");
  assert.equal(bitsToString(r1.value), "000");

  const rEmpty = executeKTVM(fsmMod, [bitsFromString("")]);
  assert.equal(rEmpty.status, "OK");
  assert.equal(bitsToString(rEmpty.value), "");

  // Also verify packed_base64 Int32 encoding round-trip + execution on _lsb_add!
  // Stride = 7: [kindCode (0=CONT,1=EXIT,2=NEED_MORE,3=FAIL), next_q, exit, sh0, sh1, emitWord0, emitLen0]
  const packed = new Int32Array(32 * 7);
  for (let c = 0; c < 2; c++) {
    for (let tx = 0; tx < 4; tx++) {
      for (let ty = 0; ty < 4; ty++) {
        const idx = (c << 4) | (tx << 2) | ty;
        const b = idx * 7;
        if (tx === 3 || ty === 3) {
          packed[b] = 3; // FAIL
        } else if (tx === 2 && ty === 2) {
          packed[b] = 1; packed[b + 2] = c; packed[b + 3] = 2; packed[b + 4] = 2;
        } else if (tx === 2) {
          if (c === 0) {
            packed[b] = 1; packed[b + 2] = 2; packed[b + 3] = 2; packed[b + 4] = 0;
          } else {
            const sum = ty + 1;
            packed[b] = 0; packed[b + 1] = sum >> 1; packed[b + 3] = 0; packed[b + 4] = 2;
            packed[b + 5] = sum & 1; packed[b + 6] = 2;
          }
        } else if (ty === 2) {
          if (c === 0) {
            packed[b] = 1; packed[b + 2] = 3; packed[b + 3] = 0; packed[b + 4] = 2;
          } else {
            const sum = tx + 1;
            packed[b] = 0; packed[b + 1] = sum >> 1; packed[b + 3] = 2; packed[b + 4] = 0;
            packed[b + 5] = sum & 1; packed[b + 6] = 2;
          }
        } else {
          const sum = tx + ty + c;
          packed[b] = 0; packed[b + 1] = sum >> 1; packed[b + 3] = 2; packed[b + 4] = 2;
          packed[b + 5] = sum & 1; packed[b + 6] = 2;
        }
      }
    }
  }
  const b64 = packInt32Base64(packed);
  const packedSrc = makeLsbAddModule("").replace(
    /entries \{[\s\S]*?\}/,
    `stride: 7;\n  packed_base64 "${b64}";`
  );
  const parsedPacked = parseModule(packedSrc);
  assert.equal(printModule(parseModule(printModule(parsedPacked))), printModule(parsedPacked));
  const rPack = executeKTVM(parsedPacked, [bitsFromBigIntLSB(99999n), bitsFromBigIntLSB(12345n)]);
  assert.equal(rPack.status, "OK");
  assert.equal(bitsToBigIntLSB(rPack.value), 112344n);
  assert.ok(rPack.telemetry.tableLookups >= 10);
});

// --- Summary ---
console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
