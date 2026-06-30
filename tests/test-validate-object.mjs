import assert from "node:assert";
import { compileLibraryBuffer, compileObjectBuffer, decodeObject } from "../object.mjs";
import { objectToKIRP, retypeObjectRelation } from "../kir.mjs";
import { validateKIRP, validateObjectPayload } from "../objects/validate.mjs";

const object = decodeObject(compileObjectBuffer("id = (); id", { source: "validate.k" }));
assert.equal(validateObjectPayload(object), object);
assert.equal(validateKIRP(objectToKIRP(object)).format, "k-ir");
const retyped = validateKIRP(retypeObjectRelation(object, "__main__", [["open-product", []]]));
assert.equal(retyped.layer, "KIR-P");
assert.equal(retyped.kind, "executable");
assert(!("instanceKey" in retyped));

const library = decodeObject(compileLibraryBuffer("succ = |succ;\n", { source: "validate-lib.k" }));
assert.equal(validateObjectPayload(library), library);
assert.equal(validateKIRP(objectToKIRP(library)).kind, "library");

const badObject = {
  ...object,
  rels: {
    ...object.rels,
    __main__: {
      ...object.rels.__main__,
      typeDerivation: { status: "maybe" }
    }
  }
};
assert.throws(
  () => validateObjectPayload(badObject),
  /typeDerivation\.status must be one of/
);

const badKir = objectToKIRP(object);
badKir.rels.__main__.inputPattern = 999;
assert.throws(
  () => validateKIRP(badKir),
  /inputPattern is out of range/
);

console.log("OK");
