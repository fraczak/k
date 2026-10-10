import assert from "node:assert/strict";
import { compileObjectBuffer, decodeObject } from "@fraczak/k/object.mjs";
import { compileObjectToLLVM } from "../src/llvm.mjs";
import { compileAndRunLLVM } from "../src/executable.mjs";
import { Value } from "@fraczak/k/Value.mjs";

console.log("==> LLVM Open Product Field Alignment Test");

// Test expression from user:
// len_ = ?X <{.list/nil if, .len then} .then,
//             {.list/cons.cdr list, .len inc len} ?X len_ >;
const src = `
0 = {}|0;
inc = |1;
len = {()list, 0 len} len_;
len_ = ?X <{.list/nil if, .len then} .then, {.list/cons.cdr list, .len inc len} ?X len_ >;
len
`;

// Input schema for list:
// cons is a closed product with fields 'car' (index 0) and
// 'cdr' (index 1).
const listPattern = [
  ["closed-union", [["cons", 1], ["nil", 2]]],
  ["closed-product", [["car", 3], ["cdr", 0]]],
  ["closed-product", []],
  ["any", []]
];

const obj = decodeObject(
  compileObjectBuffer(src, { source: "open-product-misalignment.k" })
);
const { llvm } = compileObjectToLLVM(obj, { inputPattern: listPattern });

// -----------------------------------------------------------------------
// Test 1: Static IR Field Index for .cdr
// -----------------------------------------------------------------------
// In cons payload { car, cdr }, 'car' is index 0 (byte offset 0) and
// 'cdr' is index 1 (byte offset 24 = 1 * K_FIELD_SIZE).
// The specialized LLVM IR for projecting .cdr MUST access byte offset 24.
// When misaligned, it accesses byte offset 0 (which is 'car').

const cdrLabelMatch = llvm.match(
  /(@k_label_\d+)\s*=\s*private unnamed_addr constant \[4 x i8\] c"cdr\\00"/
);
assert.ok(cdrLabelMatch, "LLVM IR should define label constant for 'cdr'");
const cdrLabelGlobal = cdrLabelMatch[1];

const lines = llvm.split("\n");
let cdrFieldSlotOffset = null;
let cdrDynamicFallbackEmitted = false;

for (let i = 0; i < lines.length; i++) {
  if (
    lines[i].includes(cdrLabelGlobal) &&
    lines[i].includes("getelementptr inbounds [4 x i8]")
  ) {
    const localLabelVar = lines[i].trim().split("=")[0].trim();
    for (let j = i; j < Math.min(lines.length, i + 35); j++) {
      if (
        lines[j].includes("getelementptr inbounds i8, ptr %product_fields_ptr") &&
        lines[j].includes(", i64 ")
      ) {
        const offsetMatch = lines[j].match(/, i64 (\d+)/);
        if (offsetMatch) cdrFieldSlotOffset = Number(offsetMatch[1]);
      }
      if (
        lines[j].includes("call ptr @k_product_get_n") &&
        lines[j].includes(localLabelVar)
      ) {
        cdrDynamicFallbackEmitted = true;
      }
    }
    if (cdrFieldSlotOffset !== null) break;
  }
}

console.log(`- Detected .cdr field slot byte offset: ${cdrFieldSlotOffset} (expected 24)`);
console.log(`- Detected dynamic fallback (@k_product_get_n) emitted for .cdr: ${cdrDynamicFallbackEmitted}`);

// -----------------------------------------------------------------------
// Test 2: Execution without dynamic fallback
// -----------------------------------------------------------------------
// When dynamic fallback (@k_product_get_n) is removed from the emitted
// LLVM IR (forcing runtime to rely on the statically generated index),
// the misalignment causes .cdr projection to load 'car' (a leaf),
// causing the next iteration of len_ to fail because 'car' is not a list.
const llvmNoFallback = llvm.replace(
  /call ptr @k_product_get_n\([^)]+\)/g,
  "bitcast ptr null to ptr"
);

// Build test list: [1, 2] = cons(car: 1, cdr: cons(car: 2, cdr: nil))
const nil = Value.variant("nil", Value.product({}));
const cons2 = Value.variant("cons", Value.product({
  car: Value.variant("1", Value.product({})),
  cdr: nil
}));
const cons1 = Value.variant("cons", Value.product({
  car: Value.variant("1", Value.product({})),
  cdr: cons2
}));

let runtimeStatusNoFallback = null;
try {
  const res = compileAndRunLLVM(llvmNoFallback, { input: cons1 });
  runtimeStatusNoFallback = res.status;
} catch (err) {
  runtimeStatusNoFallback = err.status ?? 2;
}

console.log(`- Runtime exit status without fallback: ${runtimeStatusNoFallback} (expected 0)`);

// -----------------------------------------------------------------------
// Assertions to expose misalignment
// -----------------------------------------------------------------------
const exposeMode = process.argv.includes("--assert");

if (exposeMode) {
  assert.equal(
    cdrFieldSlotOffset,
    24,
    `Misalignment: .cdr projected at byte offset ${cdrFieldSlotOffset} (car) instead of 24 (cdr)`
  );
  assert.equal(
    cdrDynamicFallbackEmitted,
    false,
    "Dynamic fallback: LLVM emits @k_product_get_n fallback to mask misalignment"
  );
  assert.equal(
    runtimeStatusNoFallback,
    0,
    `Runtime failure: status ${runtimeStatusNoFallback} when relying on static index`
  );
} else {
  console.log("\nSummary:");
  console.log(`  Offset misalignment: ${cdrFieldSlotOffset === 24 ? "ALIGNED" : "MISALIGNED (offset 0 instead of 24)"}`);
  console.log(`  Dynamic fallback used: ${cdrDynamicFallbackEmitted ? "YES (papers over bug at runtime)" : "NO"}`);
  console.log(`  Status without fallback: ${runtimeStatusNoFallback === 0 ? "OK" : "FAILS (status " + runtimeStatusNoFallback + ")"}`);
}
