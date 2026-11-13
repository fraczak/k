import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import k from "../index.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { Value } from "../Value.mjs";
import { compileWasmArtifact, instantiateWasmArtifact } from "../backends/wasm/src/wasm.mjs";
import { parse as parseIntVal } from "../codecs/int.mjs";
import { stringValueToText, textToStringValue } from "../codecs/string-codec.mjs";
import { stringToBitPath } from "../codecs/djson.mjs";
import { useSpecsFor } from "./helpers/cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreSource = fs.readFileSync(path.join(root, "core.k"), "utf8");
const genericPath = path.join(root, "lib/generic.k");
const genericSource = fs.readFileSync(genericPath, "utf8");

const coreLib = loadLibrary(compileLibrary(coreSource, { source: "core.k" }));
const genericLib = loadLibrary(compileLibrary(genericSource, {
  source: "lib/generic.k",
  libraries: [coreLib],
  use: useSpecsFor("lib/generic.k")
}));

for (const [hash, rel] of Object.entries(genericLib.rels)) {
  assert.equal(
    rel.typeDerivation?.status,
    "converged",
    `lib/generic.k relation ${hash} did not converge: ${JSON.stringify(rel.typeDerivation)}`
  );
}

const runRel = (name, input) => {
  const alias = genericLib.relAlias[name];
  assert.ok(alias, `missing exported relation '${name}' in lib/generic.k`);
  return k.compile(alias, { libraries: [genericLib] })(input);
};

function bitsFromStr(str) {
  let v = Value.variant("_", Value.product({}));
  for (let i = str.length - 1; i >= 0; i--) {
    v = Value.variant(str[i], v);
  }
  return v;
}

function bitsToStr(v) {
  let out = "";
  let cur = v;
  while (cur?.type === "<>" && cur.tag !== "_") {
    out += cur.tag;
    cur = cur.value;
  }
  assert.equal(cur?.tag, "_", "expected canonical bits leaf '_'");
  return out;
}

function listFrom(items) {
  let v = Value.variant("nil", Value.product({}));
  for (let i = items.length - 1; i >= 0; i--) {
    v = Value.variant("cons", Value.product({ car: items[i], cdr: v }));
  }
  return v;
}

function listToArray(v) {
  const out = [];
  let cur = v;
  while (cur?.type === "<>" && cur.tag === "cons") {
    out.push(cur.value.product.car);
    cur = cur.value.product.cdr;
  }
  assert.equal(cur?.tag, "nil", "expected proper list ending in nil");
  return out;
}

// 1. bool[], order[], opt[] filters and pattern existence
for (const pat of ["bool", "order", "opt", "btrie"]) {
  assert.ok(genericLib.patternAlias[pat], `missing exported pattern '${pat}' in lib/generic.k`);
}
assert.equal(runRel("true?", Value.variant("true", Value.product({}))).tag, "true");
assert.equal(runRel("true?", Value.variant("false", Value.product({}))), undefined);
assert.equal(runRel("false?", Value.variant("false", Value.product({}))).tag, "false");
assert.equal(runRel("false?", Value.variant("true", Value.product({}))), undefined);

assert.equal(runRel("lt?", Value.variant("lt", Value.product({}))).tag, "lt");
assert.equal(runRel("eq?", Value.variant("eq", Value.product({}))).tag, "eq");
assert.equal(runRel("gt?", Value.variant("gt", Value.product({}))).tag, "gt");
assert.equal(runRel("lt?", Value.variant("gt", Value.product({}))), undefined);

assert.equal(runRel("nil?", Value.variant("nil", Value.product({}))).tag, "nil");
assert.equal(runRel("nil?", Value.variant("val", Value.product({}))), undefined);

// 2. list[X]: reverse & rev_append
assert.deepEqual(listToArray(runRel("reverse", listFrom([]))).length, 0);
assert.deepEqual(
  listToArray(runRel("reverse", textToStringValue("abc"))).map((ch) =>
    stringValueToText(listFrom([ch]))
  ),
  ["c", "b", "a"]
);
assert.equal(
  stringValueToText(
    runRel("rev_append", Value.product({
      xs: textToStringValue("ab"),
      acc: textToStringValue("cd")
    }))
  ),
  "bacd"
);

// 3. bits[]: zero_bits?, trim_bits, inc_bits
assert.ok(runRel("zero_bits?", bitsFromStr("0")));
assert.equal(runRel("zero_bits?", bitsFromStr("1")), undefined);
assert.equal(bitsToStr(runRel("trim_bits", bitsFromStr("000"))), "0");
assert.equal(bitsToStr(runRel("trim_bits", bitsFromStr("00101"))), "101");

const expectedBits = ["0", "1", "10", "11", "100", "101", "110", "111", "1000"];
for (let i = 0; i < expectedBits.length - 1; i++) {
  const next = runRel("inc_bits", bitsFromStr(expectedBits[i]));
  assert.equal(bitsToStr(next), expectedBits[i + 1]);
}
assert.equal(bitsToStr(runRel("inc_bits", bitsFromStr("11111111"))), "100000000");

// 4. btrie[V]: empty, set, get, del pruning, entries_raw, max_key, bfs_values
let trie = runRel("btrie_empty", Value.product({}));
assert.equal(trie.tag, "nil");
assert.equal(
  runRel("btrie_get", Value.product({ key: bitsFromStr("0"), trie })),
  undefined
);

for (let i = 0; i < 5; i++) {
  trie = runRel("btrie_set", Value.product({
    key: parseIntVal(String(i)).value,
    val: parseIntVal(String((i + 1) * 10)),
    trie
  }));
}
for (let i = 0; i < 5; i++) {
  const got = runRel("btrie_get", Value.product({
    key: parseIntVal(String(i)).value,
    trie
  }));
  assert.deepEqual(got.toJSON(), parseIntVal(String((i + 1) * 10)).toJSON());
}

// Breadth-first order yields numeric index order [10, 20, 30, 40, 50] (not trie pre-order 0,1,2,4,3)
assert.deepEqual(
  listToArray(runRel("btrie_bfs_values", trie)).map((v) => v.toJSON()),
  [10, 20, 30, 40, 50].map((n) => parseIntVal(String(n)).toJSON())
);

// Deleting index 1 keeps canonical pruning, preserves sparse numeric order [10, 30, 40, 50],
// and max_key remains index 4 so subsequent insert computes 5.
const pruned = runRel("btrie_del", Value.product({
  key: parseIntVal("1").value,
  trie
}));
assert.equal(
  runRel("btrie_get", Value.product({ key: parseIntVal("1").value, trie: pruned })),
  undefined
);
assert.deepEqual(
  listToArray(runRel("btrie_bfs_values", pruned)).map((v) => v.toJSON()),
  [10, 30, 40, 50].map((n) => parseIntVal(String(n)).toJSON())
);
const maxOpt = runRel("btrie_max_key", pruned);
assert.equal(maxOpt.tag, "val");
assert.equal(bitsToStr(maxOpt.value), "100");

// Deleting every inserted key must collapse btrie back to exact |nil
let cleared = trie;
for (let i = 0; i < 5; i++) {
  cleared = runRel("btrie_del", Value.product({
    key: parseIntVal(String(i)).value,
    trie: cleared
  }));
}
assert.equal(cleared.tag, "nil");
assert.equal(runRel("btrie_max_key", cleared).tag, "nil");

// 5. unicode[] / string[]: eq_char? across all 6 variants & string_to_bits <-> bits_to_string bijection
const singleChar = (ch) => textToStringValue(ch).value.product.car;
const sampleChars = [
  "a",         // ascii
  "é",         // plane0
  "語",        // bmp_common h80_CF
  "\u0905",    // bmp_common h08_0F
  "\u1234",    // bmp_common h10_7F
  "\uD123",    // bmp_common hD0_D7
  "\uF912",    // bmp_common hF9
  "\uFB12",    // bmp_common hFA_FB
  "\uFD12",    // bmp_common hFC_FD
  "\uFF12",    // bmp_common hFE_FF
  "\uE123",    // bmp_private_use hE0_EF
  "\uF123",    // bmp_private_use hF0_F7
  "\uF812",    // bmp_private_use hF8
  "😀",        // supplementary_plane1
  "\u{31234}", // supplementary_planes2_16 p02_03
  "\u{51234}", // supplementary_planes2_16 p04_07
  "\u{91234}", // supplementary_planes2_16 p08_0F
  "\u{101234}" // supplementary_planes2_16 p10
];

for (let i = 0; i < sampleChars.length; i++) {
  const c = singleChar(sampleChars[i]);
  assert.ok(runRel("eq_char?", Value.product({ x: c, y: c })), `eq_char? failed on ${sampleChars[i]}`);
  const other = singleChar(sampleChars[(i + 1) % sampleChars.length]);
  assert.equal(
    runRel("eq_char?", Value.product({ x: c, y: other })),
    undefined,
    `eq_char? falsely matched distinct chars`
  );
}

const mixedStrings = ["", "hello", ...sampleChars, sampleChars.join("")];
const wasmStrToBits = await instantiateWasmArtifact(
  await compileWasmArtifact(genericLib.relAlias.string_to_bits, { libraries: [genericLib] })
);
for (const text of mixedStrings) {
  const sVal = textToStringValue(text);
  const encodedJs = runRel("string_to_bits", sVal);
  const encodedWasm = wasmStrToBits.executeValue(sVal);
  assert.equal(
    bitsToStr(encodedJs),
    stringToBitPath(text).join(""),
    `string_to_bits bit path mismatch for ${JSON.stringify(text)}`
  );
  assert.equal(bitsToStr(encodedWasm), bitsToStr(encodedJs), "Wasm mismatch on string_to_bits");
  assert.equal(
    stringValueToText(runRel("bits_to_string", encodedJs)),
    text,
    `bits_to_string round-trip failed for ${JSON.stringify(text)}`
  );
}

console.log("lib/generic.k specification tests passed");
