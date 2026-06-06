import assert from "node:assert";
import fs from "node:fs";
import k from "../index.mjs";
import { parseValue } from "../valueIO.mjs";
import { decodeWire, encodeToWire, CORE_PATTERN_PROPERTY_LIST } from "../codecs/runtime/prefix-codec.mjs";
import { Value } from "../Value.mjs";
import { exportPatternGraph } from "../codecs/runtime/codec.mjs";
import { patternToPropertyList } from "../codecs/runtime/pattern-json.mjs";
import {
  compileObjectBuffer,
  compileLibraryBuffer,
  decodeObject,
  objectToFunction,
  runConvergedObject,
  decompileObjectBuffer,
  extractAliasesFromObject
} from "../object.mjs";

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

const unicodeLabelValue = Value.product({
  "é": Value.variant("🙂", Value.product({})),
  "𐐷": Value.product({})
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
assert.equal(objectBuffer.subarray(0, 5).toString("utf8"), "KOBJ\n");
const object = decodeObject(objectBuffer);
assert.equal("version" in object, false);
assert(Object.values(object.codes).every((code) => code.typeDerivation == null));
assert.equal(JSON.stringify(object.codes).includes('"start"'), false);
assert.equal(JSON.stringify(object.codes).includes('"end"'), false);
assert.equal(JSON.stringify(object.meta).includes('"spans"'), false);
assert(Object.values(object.rels).every((rel) =>
  JSON.stringify(Object.keys(rel.typeDerivation || {}).sort()) === JSON.stringify(["status"]) &&
  rel.typeDerivation.status === "converged"
));
assert.notEqual(object.rels.__main__.def.comp?.[0]?.op, "filter");
assert.equal(JSON.stringify(object.rels.__main__.def).includes('"start"'), false);
assert(object.meta[object.relAlias.__main__]?.origins?.some((origin) =>
  origin.name === "__main__" && origin.start && origin.end
));

const objectFn = objectToFunction(object);
const objectResult = objectFn(Value.product({}));
assert.deepEqual(objectResult.pattern, INT_PATTERN);
assert.deepEqual(objectResult.toJSON(), { "+": { "1": { "0": "_" } } });
const convergedObjectResult = runConvergedObject(object, Value.product({}));
assert.deepEqual(convergedObjectResult.pattern, INT_PATTERN);
assert.deepEqual(convergedObjectResult.toJSON(), objectResult.toJSON());

const decompiledSource = decompileObjectBuffer(objectBuffer);
const decompiledResult = k.compile(decompiledSource)(Value.product({}));
assert.deepEqual(decompiledResult.pattern, INT_PATTERN);
assert.deepEqual(decompiledResult.toJSON(), objectResult.toJSON());
assert.match(decompiledSource, /^----- codes -----$/m);
assert.match(decompiledSource, /^----- rels -----$/m);
assert.match(decompiledSource, /^----- main -----$/m);
assert.match(decompiledSource, /\$ Nws3 =/);
assert.match(decompiledSource, /^7jfi = /m);
assert.match(decompiledSource, /^----- main -----\n\?\(\.\.\.\) 7jfi \$Nws3$/m);

const natLibraryBuffer = compileLibraryBuffer(fs.readFileSync("Examples/nat.k", "utf8"), { source: "Examples/nat.k" });
const natDecompiledSource = decompileObjectBuffer(natLibraryBuffer);
const natRoundTripSource = decompileObjectBuffer(
  compileLibraryBuffer(natDecompiledSource, { source: "Examples/nat.decompiled.k" })
);
const recursiveNatPattern = /\$dTww <\{\.x PgmQ x, \.y h4Wg y\} re64, \.y> \$e9WP;/;
assert.equal(natRoundTripSource, natDecompiledSource);
assert.match(natDecompiledSource, recursiveNatPattern);

const arithmeticsLibraryBuffer = compileLibraryBuffer(
  fs.readFileSync("Examples/arithmetics.k", "utf8"),
  { source: "Examples/arithmetics.k" }
);
const arithmeticsDecompiledSource = decompileObjectBuffer(arithmeticsLibraryBuffer);
const arithmeticsRoundTripSource = decompileObjectBuffer(
  compileLibraryBuffer(arithmeticsDecompiledSource, { source: "Examples/arithmetics.decompiled.k" })
);
assert.equal(arithmeticsRoundTripSource, arithmeticsDecompiledSource);

assert.throws(() => k.compile("@A = (); @A"), /Parse error/);
assert.throws(() => k.compile("$ @A = {}; $@A"), /Parse error/);
assert.deepEqual(k.compile("7jfi = ?X0; 7jfi")(Value.product({})).toJSON(), {});

const sccSource = decompileObjectBuffer(compileObjectBuffer("c = {}; b = c |x; a = b |y; a"));
assert.match(sccSource, /----- rels -----\nPQgV = .+\n\naQAD = .+\n\nN9UH = /s);
assert.deepEqual(k.compile(sccSource)(Value.product({})).toJSON(), { y: "x" });

const libraryBuffer = compileLibraryBuffer("$ nat = <{} zero, nat succ>;\nsucc = |succ;\n", { source: "defs-only.k" });
assert.equal(libraryBuffer.subarray(0, 1).toString("utf8"), "{");
const library = decodeObject(libraryBuffer);
assert.equal("version" in library, false);
assert.equal(library.main, null);
assert(Object.values(library.codes).every((code) => code.typeDerivation == null));
assert.equal(JSON.stringify(library.codes).includes('"start"'), false);
assert.equal(JSON.stringify(library.codes).includes('"end"'), false);
assert.equal(JSON.stringify(library.meta).includes('"spans"'), false);
assert(Object.values(library.rels).every((rel) =>
  JSON.stringify(Object.keys(rel.typeDerivation || {}).sort()) === JSON.stringify(["status"]) &&
  rel.typeDerivation.status === "converged"
));
assert(Object.values(library.rels).every((rel) => rel.def.op !== "comp" || rel.def.comp[0]?.op !== "filter"));
assert(Object.values(library.meta).some(({ type, origins }) =>
  type === "code" &&
  origins.some((origin) =>
    origin.source === "defs-only.k" &&
    origin.name === "nat" &&
    typeof origin.compiledAt === "string" &&
    origin.start &&
    origin.end
  )
));
assert(Object.values(library.meta).some(({ type, origins }) =>
  type === "rel" &&
  origins.some((origin) =>
    origin.source === "defs-only.k" &&
    origin.name === "succ" &&
    typeof origin.compiledAt === "string" &&
    origin.start &&
    origin.end
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

{
  const warn = console.warn;
  console.warn = () => {};
  try {
    const nonConverged = decodeObject(compileObjectBuffer("f = .x f; f", {
      convergence: { strategy: "fixed_point", maxIterations: 1 }
    }));
    assert.equal(nonConverged.rels.__main__.typeDerivation.status, "not-converged");
    assert.throws(
      () => runConvergedObject(nonConverged, Value.product({ x: Value.product({}) })),
      /type derivation is not-converged/
    );
  } finally {
    console.warn = warn;
  }
}

const aliasSnippet = extractAliasesFromObject({
  format: "k-object",
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
