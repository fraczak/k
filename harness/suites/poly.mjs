import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  codes,
  decodeWire,
  encodeToWire,
  executeKVM,
  lowerToKVM,
  run,
  run_converged,
  valueForCode,
  Value
} from "../../backend-api.mjs";
import { compileLibrary, loadLibrary, decodeObject, compileObjectBuffer } from "../../object.mjs";
import { parse as parseIntValue } from "../../codecs/int.mjs";
import { BenchmarkSuite } from "../suite.mjs";
import { inputPatternForObjectRelation } from "../../backends/llvm/src/executable.mjs";
import { prepareRelation } from "../../backends/llvm/tests/perf-support.mjs";

export async function createPolySuite({ listLength = 40, cacheDir = null } = {}) {
  const ops = ["reverse", "concat", "split_by", "get_nth", "length"];
  const benchNames = Object.fromEntries(ops.map(op => [op, `bench_${op}`]));

  let depLib = null;
  for (const relPath of ["../../lib/bit.k", "../../lib/bits.k", "../../lib/arithmetics.k", "../../lib/list.k"]) {
    const filePath = fileURLToPath(import.meta.resolve(relPath));
    depLib = loadLibrary(compileLibrary(fs.readFileSync(filePath, "utf8"), {
      source: filePath,
      libraries: depLib ? [depLib] : []
    }));
  }

  const polyPath = fileURLToPath(import.meta.resolve("../../Examples/poly.k"));
  const polySource = fs.readFileSync(polyPath, "utf8");
  const polyLib = loadLibrary(compileLibrary(polySource, {
    source: polyPath,
    libraries: [depLib]
  }));

  const state = {
    codes: { ...depLib.codes, ...polyLib.codes },
    rels: { ...depLib.rels, ...polyLib.rels },
    typeAliases: {},
    relAliases: { ...polyLib.relAlias },
    meta: { ...depLib.meta, ...polyLib.meta }
  };

  for (const [hash, entry] of Object.entries(depLib.meta)) {
    if (entry.type === "code") {
      for (const origin of entry.origins || []) {
        if (origin.name) state.typeAliases[origin.name] = hash;
      }
    }
  }

  for (const op of ops) {
    state.relAliases[benchNames[op]] = polyLib.relAlias[op];
  }

  function intValue(text) {
    return valueForCode(parseIntValue(text), state.typeAliases.int, codes.find);
  }

  function makeList(elements) {
    let curr = Value.variant("nil", Value.product({}));
    for (let i = elements.length - 1; i >= 0; i--) {
      curr = Value.variant("cons", Value.product({
        car: elements[i],
        cdr: curr
      }));
    }
    return curr;
  }

  const relations = {};
  for (const op of ops) {
    const name = benchNames[op];
    relations[op] = prepareRelation(state, name);
  }
  codes.load(state.codes);

  const intElements = Array.from({ length: listLength }, (_, i) => intValue(String(i + 1)));
  const fullList = makeList(intElements);
  const halfLen = Math.floor(listLength / 2);
  const firstHalf = makeList(intElements.slice(0, halfLen));
  const secondHalf = makeList(intElements.slice(halfLen));
  const midIdx = intValue(String(halfLen));

  const rawCases = [
    { op: "reverse", label: `len ${listLength}`, inputVal: fullList },
    { op: "concat", label: `2x len ${halfLen}`, inputVal: Value.product({ xs: firstHalf, ys: secondHalf }) },
    { op: "split_by", label: `at ${halfLen} of ${listLength}`, inputVal: Value.product({ n: midIdx, xs: fullList }) },
    { op: "get_nth", label: `idx ${halfLen} of ${listLength}`, inputVal: Value.product({ n: midIdx, xs: fullList }) },
    { op: "length", label: `len ${listLength}`, inputVal: fullList }
  ];

  const suite = new BenchmarkSuite("poly", { state, cacheDir });

  for (const tc of rawCases) {
    const relation = relations[tc.op];
    let expected;
    try {
      run.defs = state;
      run_converged.defs = state;
      expected = run_converged(codes.find, relation.relDef.def, tc.inputVal, relation.relDef.typePatternGraph);
    } catch {
      expected = executeKVM(relation.kvmFunc, tc.inputVal, {
        rels: state.rels,
        codes: state.codes,
        options: { envelopeFree: true }
      });
    }

    const inferredPat = inputPatternForObjectRelation(relation.object, relation.relationName);
    const inputWire = encodeToWire(tc.inputVal, inferredPat);
    const inputPattern = decodeWire(inputWire).pattern;

    const outWire = encodeToWire(expected);
    const outputPattern = decodeWire(outWire).pattern;

    suite.addCase({
      op: tc.op,
      label: tc.label,
      relName: relation.relationName,
      relHash: relation.relHash,
      relDef: relation.relDef,
      object: relation.object,
      kvmFunc: relation.kvmFunc,
      inputVal: tc.inputVal,
      inputWire,
      inputPattern,
      outputPattern,
      expectedVal: expected
    });
  }

  return suite;
}
