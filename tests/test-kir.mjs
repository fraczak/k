import assert from "node:assert";
import { compileLibraryBuffer, compileObjectBuffer, decodeObject } from "../object.mjs";
import { objectToKIRP, retypeObjectRelation } from "../kir.mjs";
import {
  objectToKIRP as backendObjectToKIRP,
  objectToKVMArtifact,
  retypeObjectRelation as backendRetypeObjectRelation
} from "../backend-api.mjs";
import { validateKIRP } from "../objects/validate.mjs";

const object = decodeObject(compileObjectBuffer(`
  $ bit = < {} 0, {} 1 >;
  id = ();
  .x id
`, { source: "kir-test.k" }));
const kir = objectToKIRP(object);
assert.equal(backendObjectToKIRP(object).format, "k-ir");

assert.equal(kir.format, "k-ir");
assert.equal(kir.version, 1);
assert.equal(kir.layer, "KIR-P");
assert.equal(kir.sourceFormat, "k-object");
assert.equal(kir.kind, "executable");
assert.equal(kir.main, "__main__");
assert.equal(kir.rels.__main__.typeDerivation.status, "converged");
assert.equal(typeof kir.rels.__main__.inputPattern, "number");
assert.equal(typeof kir.rels.__main__.outputPattern, "number");
assert(Array.isArray(kir.rels.__main__.patternGraph.nodes));
assert(kir.rels.__main__.patternGraph.nodes.every((node, index) => node.id === index));
assert.deepEqual(new Set(kir.rels.__main__.patternGraph.nodes.map((node) => node.kind)).has("open-product"), true);
assert.equal(kir.rels.__main__.body.op, "dot");
assert.equal(kir.rels.__main__.body.label, "x");
const retyped = validateKIRP(retypeObjectRelation(object, "__main__", [
  ["closed-product", [["x", 1]]],
  ["closed-product", []]
]));
assert.equal(retyped.layer, "KIR-P");
assert.equal(retyped.kind, "executable");
assert.equal(retyped.main, "__main__");
assert.equal(retyped.rels.__main__.body.op, "ref");
assert.equal(retyped.rels.__main__.body.ref, "__kir_target__");
assert(!("instanceKey" in retyped));
assert(!("callSites" in retyped));
assert.equal(backendRetypeObjectRelation(object, "__main__", [["open-product", []]]).layer, "KIR-P");
assert.throws(
  () => objectToKVMArtifact(object, "__main__", [["open-product", []]]),
  /\.kvm emission requires a singleton input pattern/
);
const kvmArtifact = objectToKVMArtifact(object, "__main__", [
  ["closed-product", [["x", 1]]],
  ["closed-product", []]
]);
assert.equal(kvmArtifact.format, "k-vm");
assert.equal(kvmArtifact.layer, "KVM");
assert.equal(kvmArtifact.entry, "__main__");
assert.deepEqual(kvmArtifact.inputPattern, [
  ["closed-product", [["x", 1]]],
  ["closed-product", []]
]);
assert.deepEqual(kvmArtifact.outputPattern, [["closed-product", []]]);
assert.ok(kvmArtifact.functions.__main__);
assert.equal(kvmArtifact.kir.layer, "KIR-P");
assert(!("instanceKey" in kvmArtifact));

const helperObject = decodeObject(compileObjectBuffer("pick = .x; {.a pick left, .b pick right}", { source: "kir-helper.k" }));
const helperRetyped = validateKIRP(retypeObjectRelation(helperObject, "__main__", [
  ["open-product", [["a", 1], ["b", 2]]],
  ["open-product", [["x", 3]]],
  ["open-product", [["x", 4]]],
  ["closed-product", []],
  ["closed-product", []]
]));
assert.equal(helperRetyped.layer, "KIR-P");
assert.equal(helperRetyped.kind, "executable");
assert.ok(helperRetyped.rels.pick);
assert(!("instanceKey" in helperRetyped));
assert(!("callSites" in helperRetyped));

const library = decodeObject(compileLibraryBuffer("succ = |succ;\n", { source: "kir-lib.k" }));
const libraryKir = objectToKIRP(library);
assert.equal(libraryKir.kind, "library");
assert.equal(libraryKir.main, null);
assert(Object.values(libraryKir.rels).some((rel) => rel.body.op === "vid"));

console.log("OK");
