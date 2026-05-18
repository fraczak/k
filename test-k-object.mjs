import assert from "node:assert";
import fs from "node:fs";
import k from "./index.mjs";
import { parseValue } from "./valueIO.mjs";
import { decodeWire, encodeToWire, CORE_PATTERN_PROPERTY_LIST } from "./codecs/runtime/prefix-codec.mjs";
import { Product, Variant } from "./Value.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import {
  compileObjectBuffer,
  compileLibraryBuffer,
  decodeObject,
  objectToFunction,
  decompileObjectBuffer,
  extractAliasesFromObject
} from "./object.mjs";

const value = parseValue("{a:{b:x,c:{}}}");
const wire = encodeToWire(value, null);
const decodedWire = decodeWire(wire);
assert.deepEqual(decodedWire.pattern, [
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]);
assert.deepEqual(decodedWire.value.toJSON(), value.toJSON());

const unicodeLabelValue = new Product({
  "é": new Variant("🙂", new Product({})),
  "𐐷": new Product({})
});
const unicodeWire = encodeToWire(unicodeLabelValue, null);
const decodedUnicode = decodeWire(unicodeWire);
assert.deepEqual(decodedUnicode.value.toJSON(), unicodeLabelValue.toJSON());
assert(decodedUnicode.pattern.some(([, edges]) => edges.some(([label]) => label === "é")));
assert(decodedUnicode.pattern.some(([, edges]) => edges.some(([label]) => label === "🙂")));
assert(decodedUnicode.pattern.some(([, edges]) => edges.some(([label]) => label === "𐐷")));

const core = k.annotate(fs.readFileSync("core.k", "utf8"));
const coreMain = core.rels.__main__;
const corePatternId = coreMain.typePatternGraph.find(coreMain.def.patterns[0]);
const corePattern = patternToPropertyList(exportPatternGraph(coreMain.typePatternGraph, corePatternId));
assert.deepEqual(CORE_PATTERN_PROPERTY_LIST, corePattern);

const INT_PATTERN = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];

const objectBuffer = compileObjectBuffer(`
  $ bits = < {} _, bits 0, bits 1 >;
  $ int = < bits +, bits - >;
  {}|_|0|1|+ $int
`);
const objectFn = objectToFunction(decodeObject(objectBuffer));
const objectResult = objectFn(new Product({}));
assert.deepEqual(objectResult.pattern, INT_PATTERN);
assert.deepEqual(objectResult.toJSON(), { "+": { "1": { "0": "_" } } });

const decompiledSource = decompileObjectBuffer(objectBuffer);
const decompiledResult = k.compile(decompiledSource)(new Product({}));
assert.deepEqual(decompiledResult.pattern, INT_PATTERN);
assert.deepEqual(decompiledResult.toJSON(), objectResult.toJSON());
assert.match(decompiledSource, /^----- codes -----$/m);
assert.match(decompiledSource, /^----- rels -----$/m);
assert.match(decompiledSource, /^----- main -----$/m);
assert.match(decompiledSource, /\$ Nws3 =/);
assert.match(decompiledSource, /^7jfi = /m);
assert.match(decompiledSource, /^----- main -----\n\?\(\.\.\.\) 7jfi \$Nws3$/m);

assert.throws(() => k.compile("@A = (); @A"), /Parse error/);
assert.throws(() => k.compile("$ @A = {}; $@A"), /Parse error/);
assert.deepEqual(k.compile("7jfi = ?X0; 7jfi")(new Product({})).toJSON(), {});

const sccSource = decompileObjectBuffer(compileObjectBuffer("c = {}; b = c |x; a = b |y; a"));
assert.match(sccSource, /----- rels -----\nPQgV = .+\n\naQAD = .+\n\nN9UH = /s);
assert.deepEqual(k.compile(sccSource)(new Product({})).toJSON(), { y: "x" });

const library = decodeObject(compileLibraryBuffer("$ nat = <{} zero, nat succ>;\nsucc = |succ;\n", { source: "defs-only.k" }));
assert.equal(library.main, null);
assert(Object.values(library.meta).some(({ type, origins }) =>
  type === "code" &&
  origins.some((origin) =>
    origin.source === "defs-only.k" &&
    origin.name === "nat" &&
    JSON.stringify(Object.keys(origin).sort()) === JSON.stringify(["compiledAt", "name", "source"]) &&
    typeof origin.compiledAt === "string"
  )
));
assert(Object.values(library.meta).some(({ type, origins }) =>
  type === "rel" &&
  origins.some((origin) =>
    origin.source === "defs-only.k" &&
    origin.name === "succ" &&
    JSON.stringify(Object.keys(origin).sort()) === JSON.stringify(["compiledAt", "name", "source"]) &&
    typeof origin.compiledAt === "string"
  )
));

const derivedLibrary = decodeObject(compileLibraryBuffer("other = |other;\n", {
  source: "derived.k",
  libraries: [library]
}));
const derivedAliases = extractAliasesFromObject(derivedLibrary);
assert.match(derivedAliases, /^\$ nat = @/m);
assert.match(derivedAliases, /^succ = @/m);
assert.match(derivedAliases, /^other = @/m);
assert(derivedAliases.indexOf("$ nat = @") < derivedAliases.indexOf("other = @"));
assert(derivedAliases.indexOf("other = @") < derivedAliases.indexOf("succ = @"));

const aliasSnippet = extractAliasesFromObject({
  format: "k-object",
  version: 2,
  codes: {},
  rels: {},
  meta: {
    "@relB": {
      type: "rel",
      origins: [
        { source: "new.k", name: "times", compiledAt: "2026-04-12T06:08:10.390Z" },
        { source: "core.k", name: "times", compiledAt: "2026-03-09T06:17:23.390Z" },
        { source: "other.k", name: "plus", compiledAt: "2026-05-17T06:10:23.390Z" }
      ]
    },
    "@codeB": {
      type: "code",
      origins: [
        { source: "z.k", name: "edges", compiledAt: "2026-03-09T06:17:23.390Z" }
      ]
    },
    "@codeA": {
      type: "code",
      origins: [
        { source: "a.k", name: "bits", compiledAt: "2026-05-17T06:10:23.390Z" }
      ]
    }
  },
  main: null
});
assert.deepEqual(aliasSnippet.split("\n").filter(Boolean), [
  '$ bits = @codeA; # {"source":"a.k","compiledAt":"2026-05-17T06:10:23.390Z"}',
  '$ edges = @codeB; # {"source":"z.k","compiledAt":"2026-03-09T06:17:23.390Z"}',
  'plus = @relB; # {"source":"other.k","compiledAt":"2026-05-17T06:10:23.390Z"}',
  '# times = @relB; # {"source":"core.k","compiledAt":"2026-03-09T06:17:23.390Z"}',
  'times = @relB; # {"source":"new.k","compiledAt":"2026-04-12T06:08:10.390Z"}'
]);

console.log("OK");
