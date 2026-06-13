import assert from "node:assert";
import { compileLibraryBuffer, compileObjectBuffer, decodeObject } from "../object.mjs";
import { objectToKIRP } from "../kir.mjs";
import { objectToKIRP as backendObjectToKIRP } from "../backend-api.mjs";

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

const library = decodeObject(compileLibraryBuffer("succ = |succ;\n", { source: "kir-lib.k" }));
const libraryKir = objectToKIRP(library);
assert.equal(libraryKir.kind, "library");
assert.equal(libraryKir.main, null);
assert(Object.values(libraryKir.rels).some((rel) => rel.body.op === "vid"));

console.log("OK");
