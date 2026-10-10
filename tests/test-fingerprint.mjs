import codes, { encodeCodeToString } from '../codes.mjs';
import hash from '../hash.mjs';
import assert from 'assert';

console.log("test-fingerprint:");
const codeDefs = {
  bits: { code: "union", union: { "0": "bits", "1": "bits", "_": "{}" } },
  nat: { code: "union", union: { zero: "{}", succ: "nat" } },
  pair: { code: "product", product: { x: "nat", y: "nat" } },
  b: { code: "product", product: { x: "bits", y: "bits" } },
  tree: { code: "union", union: {
    binary: "binNode",
    leaf: "nat",
    unary: "unNode"
  } },
  binNode: { code: "product", product: { value: "nat", left: "tree", right: "tree" } },
  unNode: { code: "product", product: { value: "nat", tree: "tree" } },
  "{}": { code: "product", product: {} }
};

const reps = codes.register(codeDefs);
let errors = 0;
for (const code in reps) {
  const rep = reps[code];
  const s = encodeCodeToString(rep);
  const h = hash(s);
  if (rep !== h) {
    errors++;
    console.log(` ERROR - fingerprint mismatch for ${code}: ${rep} !== ${h}`);
  }
}

if (errors === 0) {
  console.log("OK");
} else {
  console.log(" ----- ERRORS");
}
  