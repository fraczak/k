/**
 * Milestone 2 Conformance & Standard Library Parity Suite for `kTVM`.
 *
 * Tests `KIR-P -> kTVM` lowering and wire-to-wire execution against K's reference
 * `k.compile` evaluator across:
 *   1. `lib/generic.k` (booleans, order, opt, polymorphic `reverse`, `trim_bits`,
 *      `inc_bits`, `string_to_bits`/`bits_to_string`, polymorphic `btrie[V]`!)
 *   2. `lib/integer.k` (`plus`, `minus`, `times` incl. Karatsuba, `div`, `mod`,
 *      `divmod`, `gcd`, `cmp`, `abs`, `negate`, `inc`, `dec`, partial predicates)
 *   3. `lib/ieee.k` (constants, predicates, `negate_float64`, `ratio_to_float64`,
 *      `bits_to_float64`, subnormals, ±0, ±Inf, qNaN)
 *   4. `lib/djson.k` (RFC 8259 `parse_json`, Unicode `get`/`set`/`del`/`keys`/
 *      `values`, sparse arrays `del_nth`/`push`, predicates across all Unicode planes!)
 *   5. `experiments/transducer/v4/integer-streaming.k` (`lsb_add`, `lsb_sub`,
 *      `lsb_mul`, `lsb_trim`)
 *   6. Polymorphic `kTVM-P` AOT lowering (`lowerKIRToKTVMP`) + DSL/JSON round-trip
 *   7. Randomized differential fuzzing (`k.compile` vs `kTVM` wire-to-wire)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import k from "../index.mjs";
import codes from "../codes.mjs";
import { Value } from "../Value.mjs";
import { compileLibrary, compileObjectBuffer, decodeObject, loadLibrary } from "../object.mjs";
import { encodeToWire, decodeWire } from "../codecs/runtime/prefix-codec.mjs";
import { parse as parseIntVal } from "../codecs/int.mjs";
import { decodeValueToNumber, encodeNumberToValue } from "../codecs/ieee.mjs";
import { fromJsonValue, toJsonValue } from "../codecs/djson.mjs";
import { stringValueToText, textToStringValue } from "../codecs/string-codec.mjs";
import { useSpecsFor } from "../tests/helpers/cli.mjs";
import { relationPatternPropertyList } from "../kir.mjs";

import {
  KTVMSchemaError,
  compileKIRToKTVM,
  executeKTVMWire,
  executeObjectWithKTVM,
  lowerKIRToKTVMP,
  moduleFromJSON,
  moduleToJSON,
  parseModule,
  printModule,
  validateModule
} from "./index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const UNIT = Value.product({});

function bitsFromStr(str) {
  let v = Value.variant("_", UNIT);
  for (let i = str.length - 1; i >= 0; i--) {
    v = Value.variant(str[i], v);
  }
  return v;
}

function listFrom(items) {
  let v = Value.variant("nil", UNIT);
  for (let i = items.length - 1; i >= 0; i--) {
    v = Value.variant("cons", Value.product({ car: items[i], cdr: v }));
  }
  return v;
}

function plainValue(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v.toJSON()));
}

/**
 * Run a library relation via BOTH K's reference evaluator (`k.compile`) and
 * `kTVM` end-to-end over `k-wire`, asserting identical results (including
 * partial `undefined` <-> `FAILED` and eager `decodeWire` round-trip!).
 */
function assertParity(lib, relName, inputVal, { inputPattern = null, label = relName } = {}) {
  const relHash = lib.relAlias[relName] || relName;
  assert.ok(lib.rels[relHash], `missing relation '${relName}'`);
  codes.load(lib.codes);

  // 1. Reference K result
  const expected = k.compile(relHash, { libraries: [lib] })(inputVal);

  // 2. Encode input to enveloped k-wire
  let pat = inputPattern;
  if (!pat) {
    const inferred = relationPatternPropertyList(lib.rels[relHash], 0);
    // Only pass inferred pattern if it's fully closed; otherwise let encodeToWire derive exact value envelope
    const isClosed = Array.isArray(inferred) && inferred.every(([kind]) =>
      kind === "closed-product" || kind === "closed-union"
    );
    pat = isClosed ? inferred : undefined;
  }
  const inWire = pat ? encodeToWire(inputVal, pat) : encodeToWire(inputVal);

  // 3. Execute on kTVM directly over k-wire
  const res = executeObjectWithKTVM(lib, relHash, inWire);

  if (expected === undefined) {
    assert.equal(res.status, "FAILED", `${label}: expected FAILED (undefined), got OK`);
    return undefined;
  }

  assert.equal(res.status, "OK", `${label}: expected OK, got ${res.status}`);
  assert.deepEqual(
    plainValue(res.value),
    plainValue(expected),
    `${label}: kTVM value mismatch`
  );

  // 4. Verify output wire decodes bit-identically with K's own eager `decodeWire`
  const decodedByK = decodeWire(res.wire, { eager: true }).value;
  assert.deepEqual(
    plainValue(decodedByK),
    plainValue(expected),
    `${label}: kTVM output k-wire failed K decodeWire parity`
  );

  return res.value;
}

// --- Load Standard Libraries Once ---

const coreLib = loadLibrary(compileLibrary(readSrc("core.k"), { source: "core.k" }));
const genericLib = loadLibrary(compileLibrary(readSrc("lib/generic.k"), {
  source: "lib/generic.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/generic.k")
}));
const integerLib = loadLibrary(compileLibrary(readSrc("lib/integer.k"), {
  source: "lib/integer.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/integer.k")
}));
const ieeeLib = loadLibrary(compileLibrary(readSrc("lib/ieee.k"), {
  source: "lib/ieee.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/ieee.k")
}));
const djsonLib = loadLibrary(compileLibrary(readSrc("lib/djson.k"), {
  source: "lib/djson.k",
  libraries: [coreLib, genericLib, ieeeLib],
  use: useSpecsFor("lib/djson.k")
}));
const streamingIntLib = loadLibrary(compileLibrary(readSrc("experiments/transducer/v4/integer-streaming.k"), {
  source: "experiments/transducer/v4/integer-streaming.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/integer.k")
}));

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

// ============================================================================
console.log("\n=== 1. lib/generic.k Parity ===");
// ============================================================================

test("lib/generic.k: bool/order/opt predicates (both OK and partial FAILED)", () => {
  const boolPat = [["closed-union", [["false", 1], ["true", 1]]], ["closed-product", []]];
  assertParity(genericLib, "true?", Value.variant("true", UNIT), { inputPattern: boolPat });
  assertParity(genericLib, "true?", Value.variant("false", UNIT), { inputPattern: boolPat });
  assertParity(genericLib, "false?", Value.variant("false", UNIT), { inputPattern: boolPat });
  assertParity(genericLib, "false?", Value.variant("true", UNIT), { inputPattern: boolPat });

  const ordPat = [["closed-union", [["eq", 1], ["gt", 1], ["lt", 1]]], ["closed-product", []]];
  assertParity(genericLib, "lt?", Value.variant("lt", UNIT), { inputPattern: ordPat });
  assertParity(genericLib, "eq?", Value.variant("eq", UNIT), { inputPattern: ordPat });
  assertParity(genericLib, "gt?", Value.variant("gt", UNIT), { inputPattern: ordPat });
  assertParity(genericLib, "lt?", Value.variant("gt", UNIT), { inputPattern: ordPat });

  const optPat = [["closed-union", [["nil", 1], ["val", 1]]], ["closed-product", []]];
  assertParity(genericLib, "nil?", Value.variant("nil", UNIT), { inputPattern: optPat });
  assertParity(genericLib, "nil?", Value.variant("val", UNIT), { inputPattern: optPat });
});

test("lib/generic.k: polymorphic reverse on string, int list, and opaque product list", () => {
  // String (list[unicode[]])
  const strPat = relationPatternPropertyList(genericLib.rels[genericLib.relAlias.string_to_bits], 0);
  assertParity(genericLib, "reverse", textToStringValue("hello 🌍!"), { inputPattern: strPat });
  assertParity(genericLib, "reverse", textToStringValue(""), { inputPattern: strPat });

  // List of opaque products { a: int[], b: bits[] }
  const intPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.negate], 0);
  const bitsPat = relationPatternPropertyList(genericLib.rels[genericLib.relAlias.trim_bits], 0);
  const listIntPat = [
    ["closed-union", [["cons", 1], ["nil", 2]]],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-product", []],
    ...intPat.map(([k, e]) => [k, e.map(([l, t]) => [l, t + 3])])
  ];
  assertParity(
    genericLib,
    "reverse",
    listFrom([parseIntVal("1"), parseIntVal("-42"), parseIntVal("0"), parseIntVal("999")]),
    { inputPattern: listIntPat }
  );

  // trim_bits, inc_bits, rev_bits, string_to_bits <-> bits_to_string
  for (const b of ["", "000", "00101", "11111111"]) {
    assertParity(genericLib, "trim_bits", bitsFromStr(b), { inputPattern: bitsPat });
    assertParity(genericLib, "inc_bits", bitsFromStr(b), { inputPattern: bitsPat });
    assertParity(genericLib, "rev_bits", bitsFromStr(b), { inputPattern: bitsPat });
  }
  const sBits = assertParity(genericLib, "string_to_bits", textToStringValue("kTVM 🚀"), { inputPattern: strPat });
  const roundStr = assertParity(genericLib, "bits_to_string", sBits, { inputPattern: bitsPat });
  assert.equal(stringValueToText(roundStr), "kTVM 🚀");
});

test("lib/generic.k: polymorphic btrie[int[]] set, get, del, entries_raw, bfs_values", () => {
  // Build closed btrie[int[]] schema
  const intPat = relationPatternPropertyList(integerLib.rels[integerLib.relAlias.negate], 0);
  const bitsPat = relationPatternPropertyList(genericLib.rels[genericLib.relAlias.trim_bits], 0);
  // btrie[V] = < {} nil, { btrie[V] 0, btrie[V] 1, opt[V] val } trie >
  // opt[V]   = < {} nil, V val >
  const intBase = 4;
  const btriePat = [
    ["closed-union", [["nil", 2], ["trie", 1]]],
    ["closed-product", [["0", 0], ["1", 0], ["val", 3]]],
    ["closed-product", []],
    ["closed-union", [["nil", 2], ["val", intBase]]],
    ...intPat.map(([k, e]) => [k, e.map(([l, t]) => [l, t + intBase])])
  ];

  // Product helpers for btrie_set({key, trie, val}) and btrie_get({key, trie})
  const makeProdPat = (fields) => {
    const nodes = [["closed-product", []]];
    for (const [label, sub] of fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const base = nodes.length;
      for (const [k, e] of sub) nodes.push([k, e.map(([l, t]) => [l, t + base])]);
      nodes[0][1].push([label, base]);
    }
    return nodes;
  };
  const setPat = makeProdPat([["key", bitsPat], ["trie", btriePat], ["val", intPat]]);
  const getPat = makeProdPat([["key", bitsPat], ["trie", btriePat]]);

  let trie = Value.variant("nil", UNIT);
  assertParity(genericLib, "btrie_get", Value.product({ key: bitsFromStr("0"), trie }), { inputPattern: getPat });

  for (let i = 0; i < 6; i++) {
    trie = assertParity(
      genericLib,
      "btrie_set",
      Value.product({ key: parseIntVal(String(i)).value, val: parseIntVal(String((i + 1) * 10)), trie }),
      { inputPattern: setPat, label: `btrie_set(${i})` }
    );
  }
  for (let i = 0; i < 6; i++) {
    assertParity(
      genericLib,
      "btrie_get",
      Value.product({ key: parseIntVal(String(i)).value, trie }),
      { inputPattern: getPat, label: `btrie_get(${i})` }
    );
  }
  assertParity(genericLib, "btrie_bfs_values", trie, { inputPattern: btriePat });
  assertParity(genericLib, "btrie_entries_raw", trie, { inputPattern: btriePat });

  trie = assertParity(
    genericLib,
    "btrie_del",
    Value.product({ key: parseIntVal("3").value, trie }),
    { inputPattern: getPat }
  );
  assertParity(
    genericLib,
    "btrie_get",
    Value.product({ key: parseIntVal("3").value, trie }),
    { inputPattern: getPat }
  );
});

// ============================================================================
console.log("\n=== 2. lib/integer.k Parity ===");
// ============================================================================

test("lib/integer.k: plus, minus, times (incl. Karatsuba), div, mod, divmod, gcd, cmp, unary & predicates", () => {
  const pairs = [
    ["0", "0"],
    ["0", "1"],
    ["-1", "1"],
    ["123", "456"],
    ["-123", "456"],
    ["1000", "-999"],
    ["-9999", "-1"],
    ["65535", "65537"],
    ["123456789", "987654321"]
  ];

  for (const [a, b] of pairs) {
    const arg = Value.product({ x: parseIntVal(a), y: parseIntVal(b) });
    assertParity(integerLib, "plus", arg, { label: `plus(${a},${b})` });
    assertParity(integerLib, "minus", arg, { label: `minus(${a},${b})` });
    assertParity(integerLib, "times", arg, { label: `times(${a},${b})` });
    assertParity(integerLib, "cmp", arg, { label: `cmp(${a},${b})` });
    assertParity(integerLib, "eq?", arg, { label: `eq?(${a},${b})` });
    assertParity(integerLib, "gt?", arg, { label: `gt?(${a},${b})` });
    assertParity(integerLib, "lt?", arg, { label: `lt?(${a},${b})` });
    if (b !== "0") {
      assertParity(integerLib, "div", arg, { label: `div(${a},${b})` });
      assertParity(integerLib, "mod", arg, { label: `mod(${a},${b})` });
      assertParity(integerLib, "divmod", arg, { label: `divmod(${a},${b})` });
    }
  }

  for (const [a, b] of [["48", "18"], ["1071", "462"], ["17", "13"], ["0", "25"]]) {
    assertParity(integerLib, "gcd", Value.product({ x: parseIntVal(a), y: parseIntVal(b) }), {
      label: `gcd(${a},${b})`
    });
  }

  for (const x of ["-42", "-1", "0", "1", "42"]) {
    const v = parseIntVal(x);
    assertParity(integerLib, "inc", v, { label: `inc(${x})` });
    assertParity(integerLib, "dec", v, { label: `dec(${x})` });
    assertParity(integerLib, "abs", v, { label: `abs(${x})` });
    assertParity(integerLib, "negate", v, { label: `negate(${x})` });
    assertParity(integerLib, "pos?", v, { label: `pos?(${x})` });
    assertParity(integerLib, "neg?", v, { label: `neg?(${x})` });
    assertParity(integerLib, "zero?", v, { label: `zero?(${x})` });
  }

  // Large 96-bit Karatsuba multiplication parity!
  const bigX = parseIntVal("79228162514264337593543950335");
  const bigY = parseIntVal("12345678901234567890123456789");
  assertParity(integerLib, "times", Value.product({ x: bigX, y: bigY }), { label: "times(96b Karatsuba)" });
});

// ============================================================================
console.log("\n=== 3. lib/ieee.k Parity ===");
// ============================================================================

test("lib/ieee.k: constants, predicates, negate_float64, ratio_to_float64 (incl. subnormals/NaN/Inf)", () => {
  for (const c of ["pos_zero", "neg_zero", "pos_inf", "neg_inf", "qnan"]) {
    assertParity(ieeeLib, c, UNIT, { inputPattern: [["closed-product", []]], label: c });
  }

  const samples = [0, -0, 1, -1, 3.141592653589793, 5e-324, Number.MAX_VALUE, Infinity, -Infinity, NaN];
  for (const n of samples) {
    const v = encodeNumberToValue(n);
    assertParity(ieeeLib, "zero_float64?", v, { label: `zero_float64?(${n})` });
    assertParity(ieeeLib, "finite_float64?", v, { label: `finite_float64?(${n})` });
    assertParity(ieeeLib, "inf_float64?", v, { label: `inf_float64?(${n})` });
    assertParity(ieeeLib, "nan_float64?", v, { label: `nan_float64?(${n})` });
    const neg = assertParity(ieeeLib, "negate_float64", v, { label: `negate_float64(${n})` });
    if (!Number.isNaN(n)) {
      assert.ok(Object.is(decodeValueToNumber(neg), -n));
    }
  }

  // bits_to_float64: integer magnitudes & IEEE round-to-nearest ties-to-even
  for (const [n, expected] of [
    [0n, 0],
    [1n, 1],
    [42n, 42],
    [1n << 53n, 9007199254740992],
    [(1n << 53n) + 1n, 9007199254740992],
    [(1n << 53n) + 3n, 9007199254740996]
  ]) {
    const f = assertParity(ieeeLib, "bits_to_float64", parseIntVal(String(n)).value, {
      label: `bits_to_float64(${n})`
    });
    assert.ok(Object.is(decodeValueToNumber(f), expected));
  }

  // Exact rational-to-float64 rounding (ties-to-even, subnormal, normal, zero, zero-denom FAILED)
  const makeRatio = (sign, num, den) => Value.product({
    sign: Value.variant(sign, UNIT),
    num: parseIntVal(String(num)).value,
    den: parseIntVal(String(den)).value
  });
  for (const [sign, num, den, expectedNum] of [
    ["+", 0n, 1n, 0],
    ["-", 0n, 1n, -0],
    ["+", 1n, 2n, 0.5],
    ["-", 5n, 8n, -0.625],
    ["+", 1n, 10n, 0.1],
    ["+", (1n << 53n) + 1n, 2n, 4503599627370496],
    ["+", 1n, 1n << 50n, 2 ** -50]
  ]) {
    const f = assertParity(ieeeLib, "ratio_to_float64", makeRatio(sign, num, den), {
      label: `ratio(${sign}${num}/${den})`
    });
    assert.ok(Object.is(decodeValueToNumber(f), expectedNum));
  }
  assertParity(ieeeLib, "ratio_to_float64", makeRatio("+", 1n, 0n), {
    label: "ratio(+1/0) -> FAILED"
  });
});

// ============================================================================
console.log("\n=== 4. lib/djson.k Parity (Unicode Objects, Arrays & Full JSON Parser) ===");
// ============================================================================

test("lib/djson.k: predicates, Unicode get/set/del/keys/values, sparse arrays & push", () => {
  codes.load(djsonLib.codes);
  const djsonPat = relationPatternPropertyList(djsonLib.rels[djsonLib.relAlias.parse_json], 1);

  for (const [pred, val] of [
    ["null?", null],
    ["null?", 0],
    ["bool?", true],
    ["number?", 42.5],
    ["string?", "hello"],
    ["list?", [1, 2]],
    ["object?", { a: 1 }],
    ["object?", []]
  ]) {
    assertParity(djsonLib, pred, fromJsonValue(val), { inputPattern: djsonPat, label: `${pred}(${JSON.stringify(val)})` });
  }

  const objDoc = { "": 0, "a": 1, "é": 2, "語": 3, "\uE123": 4, "😀": 5, "\u{21234}": 6 };
  let objVal = fromJsonValue(objDoc);

  for (const key of Object.keys(objDoc)) {
    const got = assertParity(
      djsonLib,
      "get",
      Value.product({ key: textToStringValue(key), json: objVal }),
      { label: `djson.get(${JSON.stringify(key)})` }
    );
    assert.equal(toJsonValue(got), objDoc[key]);
  }
  assertParity(djsonLib, "get", Value.product({ key: textToStringValue("missing"), json: objVal }), {
    label: "djson.get(missing)"
  });

  assertParity(djsonLib, "keys", objVal, { inputPattern: djsonPat });
  assertParity(djsonLib, "values", objVal, { inputPattern: djsonPat });

  objVal = assertParity(
    djsonLib,
    "set",
    Value.product({ key: textToStringValue("🔑"), val: fromJsonValue("ok"), json: objVal }),
    { label: "djson.set" }
  );
  objVal = assertParity(
    djsonLib,
    "del",
    Value.product({ key: textToStringValue("😀"), json: objVal }),
    { label: "djson.del" }
  );

  // Sparse array del_nth + push
  const arr = fromJsonValue([10, 20, 30, 40, 50]);
  const sparse = assertParity(
    djsonLib,
    "del_nth",
    Value.product({ index: parseIntVal("1").value, json: arr }),
    { label: "djson.del_nth" }
  );
  const pushed = assertParity(
    djsonLib,
    "push",
    Value.product({ val: fromJsonValue(99), json: sparse }),
    { label: "djson.push" }
  );
  assert.deepEqual(toJsonValue(pushed), [10, 30, 40, 50, 99]);
});

test("lib/djson.k: full RFC 8259 parse_json parity on objects, arrays, escapes, numbers & invalid JSON", () => {
  const jsonInputs = [
    "null",
    "true",
    "false",
    "0",
    "-42.5",
    "\"hello\\n\\u0041\"",
    "[1, true, null, \"x\"]",
    "{\"a\": 1, \"b\": [2, 3], \"c\": {\"ok\": true}}",
    "{ invalid json" // partial failure -> FAILED!
  ];
  for (const txt of jsonInputs) {
    assertParity(djsonLib, "parse_json", textToStringValue(txt), { label: `parse_json(${txt})` });
  }
});

// ============================================================================
console.log("\n=== 5. integer-streaming.k & Polymorphic kTVM-P AOT Round-Trip ===");
// ============================================================================

test("experiments/transducer/v4/integer-streaming.k: lsb_add, lsb_sub, lsb_mul, lsb_trim parity", () => {
  for (const [a, b] of [["0", "0"], ["7", "1"], ["255", "1"], ["12345", "67890"], ["99999", "12345"]]) {
    const arg = Value.product({ x: parseIntVal(a).value, y: parseIntVal(b).value });
    assertParity(streamingIntLib, "lsb_add", arg, { label: `stream.lsb_add(${a},${b})` });
    assertParity(streamingIntLib, "lsb_mul", arg, { label: `stream.lsb_mul(${a},${b})` });
  }
  assertParity(streamingIntLib, "lsb_sub", Value.product({ x: parseIntVal("1000").value, y: parseIntVal("1").value }));
  assertParity(streamingIntLib, "lsb_trim", bitsFromStr("01010000"));
  assertParity(streamingIntLib, "lsb_trim", bitsFromStr("00000"));
});

test("Polymorphic lowerKIRToKTVMP produces valid .ktvmp DSL + JSON artifact round-trip", () => {
  const script = `
    list[X] = < {} nil, { X car, L cdr } cons > = L;
    reverse = ?list[X] { () xs, {} |nil acc } _reverse ?list[X];
    _reverse = ?{ list[X] xs, list[X] acc } <
      { .xs /nil _, .acc acc } .acc,
      { .xs /cons .cdr xs, { .xs /cons .car car, .acc cdr } |cons acc } _reverse
    >;
    reverse
  `;
  const obj = decodeObject(compileObjectBuffer(script));
  const polyMod = lowerKIRToKTVMP(obj);
  assert.equal(polyMod.layer, "poly");
  assert.equal(validateModule(polyMod).ok, true);

  // Lossless DSL print -> re-parse and JSON round-trip!
  const text1 = printModule(polyMod);
  const reparsed = parseModule(text1);
  assert.equal(printModule(reparsed), text1);
  assert.equal(printModule(moduleFromJSON(JSON.parse(JSON.stringify(moduleToJSON(polyMod))))), text1);

  // Also test printing/re-parsing a compiled concrete mono module from lib/integer.k!
  codes.load(integerLib.codes);
  const compiledAdd = compileKIRToKTVM(
    integerLib,
    "plus",
    relationPatternPropertyList(integerLib.rels[integerLib.relAlias.plus], 0)
  );
  const monoText = printModule(compiledAdd.module);
  assert.equal(printModule(parseModule(monoText)), monoText);
});

// ============================================================================
console.log("\n=== 6. Edge-Case Filters, Partiality & Randomized Differential Fuzzing ===");
// ============================================================================

test("Runtime filters (?P), code guards (?T[]), overlapping backtracking unions & SchemaError boundaries", () => {
  // Overlapping backtracking union: branch 0 checks /a /0, branch 1 falls back to /a ()
  const backtrackProg = `
    < /a /0 |hit, /a |fallback, /b |other >
  `;
  const btObj = decodeObject(compileObjectBuffer(backtrackProg));
  const inPat = [
    ["closed-union", [["a", 1], ["b", 2]]],
    ["closed-union", [["0", 2], ["1", 2]]],
    ["closed-product", []]
  ];
  for (const val of [
    Value.variant("a", Value.variant("0", UNIT)),
    Value.variant("a", Value.variant("1", UNIT)),
    Value.variant("b", UNIT)
  ]) {
    const exp = k.compile(backtrackProg)(val);
    const res = executeObjectWithKTVM(btObj, btObj.main, encodeToWire(val, inPat));
    assert.equal(res.status, "OK");
    assert.deepEqual(plainValue(res.value), plainValue(exp));
  }

  // Closed boundary mismatch raises KTVMSchemaError!
  const boolCheckObj = decodeObject(compileObjectBuffer("?< {} true, {} false >"));
  const badEnv = [["closed-union", [["other", 1]]], ["closed-product", []]];
  assert.throws(
    () => executeObjectWithKTVM(boolCheckObj, boolCheckObj.main, encodeToWire(Value.variant("other", UNIT), badEnv)),
    KTVMSchemaError
  );
});

test("Randomized differential fuzzing (50 random integer/list ops: k.compile vs kTVM wire-to-wire)", () => {
  let seed = 0x5eed1234;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const randInt = (maxAbs) => {
    const mag = rand() % (maxAbs + 1);
    return (rand() & 1) ? -mag : mag;
  };

  for (let i = 0; i < 50; i++) {
    const a = randInt(5000);
    const b = randInt(5000);
    const arg = Value.product({ x: parseIntVal(String(a)), y: parseIntVal(String(b)) });
    const op = ["plus", "minus", "times", "cmp", "gt?"][i % 5];
    assertParity(integerLib, op, arg, { label: `fuzz[${i}]:${op}(${a},${b})` });
  }
});

// --- Summary ---
console.log(`\nConformance & Stdlib Parity Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
