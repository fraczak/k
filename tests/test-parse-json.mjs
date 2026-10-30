import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import k from "../index.mjs";
import { compileLibrary, loadLibrary } from "../object.mjs";
import { compileWasmArtifact, instantiateWasmArtifact } from "../backends/wasm/src/wasm.mjs";
import { fromJsonValue } from "../codecs/djson.mjs";
import { textToStringValue } from "../codecs/runtime/unicode-string.mjs";
import { parse as utf8 } from "../codecs/utf8.mjs";
import { encodeToWire, decodeWire } from "../codecs/runtime/codec-sdk.mjs";

const core = loadLibrary(compileLibrary(readFileSync(new URL("../core.k", import.meta.url), "utf8")));
const ieee = loadLibrary(compileLibrary(readFileSync(new URL("../Examples/ieee.k", import.meta.url), "utf8"), {
  libraries: [core]
}));
const library = loadLibrary(compileLibrary(readFileSync(new URL("../Examples/djson.k", import.meta.url), "utf8"), {
  libraries: [ieee]
}));
const wasm = await instantiateWasmArtifact(await compileWasmArtifact(library.relAlias.parseJson, { libraries: [library] }));
const fast = text => wasm.executeValue(textToStringValue(text));
const parse = k.compile(library.relAlias.parseJson, { libraries: [library] });
const payload = value => JSON.parse(JSON.stringify(value));
function check(text, evaluate = text => parse(textToStringValue(text))) {
  const actual = evaluate(text);
  assert.ok(actual, text);
  assert.deepEqual(payload(actual), payload(fromJsonValue(JSON.parse(text))), text);
}

for (const text of [
  " \t\r\n null \t", "true", "false", '""', "[ \t ]", "{ \r\n }",
  '[[],{},null,true,false,[1,-2,3.14]]',
  '{"a":1,"a":{"new":"type"},"":0,"__proto__":{"safe":true},"emoji😀":[1,2]}',
  String.raw`"\"\\\/\b\f\n\r\t"`,
  String.raw`"\uD834\uDD1E\uFAbC"`,
  "0", "-0", "-42", "0.1", "1.25", "12E-2", "1e+20",
  "0e999999999999999999", "-0.00e-999999999999999999", "-1e-999999999999999999"
]) check(text);

// Exercise every Unicode encoding partition, including surrogate pairs.
const scalars = [
  0, 0x1f, 0x7f, 0x80, 0x7ff, 0x800, 0xfff, 0x1000, 0x7fff,
  0x8000, 0xcfff, 0xd000, 0xd7ff, 0xe000, 0xefff, 0xf000, 0xf7ff,
  0xf800, 0xf8ff, 0xf900, 0xf9ff, 0xfa00, 0xfbff, 0xfc00, 0xfdff,
  0xfe00, 0xffff, 0x10000, 0x1ffff, 0x20000, 0x3ffff, 0x40000,
  0x7ffff, 0x80000, 0xfffff, 0x100000, 0x10ffff
];
for (const scalar of scalars) {
  const text = JSON.stringify(String.fromCodePoint(scalar));
  check(text);
  check(text.replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`));
}
for (const text of [
  "", " ", "nil", "True", "+1", "01", "-01", ".1", "1.", "1e", "1e+", "--1", "0x10",
  "NaN", "Infinity", "1e999999999999999999", "[1,]", "[,1]", "[1 2]", "[",
  '{"x":1,}', "{x:1}", '{"x" 1}', "{", "null true", '"x"x', '"unterminated',
  String.raw`"\x20"`, String.raw`"\u123"`, String.raw`"\uZZZZ"`,
  String.raw`"\uD800"`, String.raw`"\uDC00"`, String.raw`"\uD800\u0041"`,
  String.raw`"\uDC00\uD800"`, '"line\nfeed"', "\u00a0null"
]) assert.equal(parse(textToStringValue(text)), undefined, JSON.stringify(text));

// Use compiled Wasm for the expensive exact-rational boundary cases.
for (const text of [
  "9007199254740993", "9007199254740995", "1.9999999999999999", "9.9999999999999999",
  "1.00000000000000011102230246251565404236316680908203125",
  "1.00000000000000011102230246251565404236316680908203126",
  "5e-324", "2e-324", "2.2250738585072014e-308", "1.7976931348623157e308"
]) check(text, fast);
for (const text of ["1e309", "-1.8e308"]) assert.equal(fast(text), undefined, text);

const text = '{"answer":42,"ok":true}';
const scratch = mkdtempSync(path.join(os.tmpdir(), "k-json-test-"));
try {
  const artifact = path.join(scratch, "djson.klib");
  const ieeeArtifact = path.join(scratch, "ieee.klib");
  for (const args of [
    ["--lib", "core.k", "Examples/ieee.k", ieeeArtifact],
    ["--lib", ieeeArtifact, "Examples/djson.k", artifact]
  ]) {
    const built = spawnSync(process.execPath, ["objects/compile.mjs", ...args], {
      cwd: new URL("..", import.meta.url)
    });
    assert.ifError(built.error);
    assert.equal(built.status, 0, built.stderr.toString());
  }
  const cli = spawnSync(process.execPath, ["k.mjs", "--lib", artifact, "--export", "parseJson", "parseJson"], {
    cwd: new URL("..", import.meta.url), input: encodeToWire(utf8(text))
  });
  assert.ifError(cli.error);
  assert.equal(cli.status, 0, cli.stderr.toString());
  assert.deepEqual(payload(decodeWire(cli.stdout).value), payload(fromJsonValue(JSON.parse(text))));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log("JSON text parser: grammar, Unicode, binary64 rounding, Wasm and CLI passed");
