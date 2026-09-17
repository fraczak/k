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

  const arithmeticsPath = fileURLToPath(import.meta.resolve("../../Examples/arithmetics.k"));
  const arithmeticsSource = fs.readFileSync(arithmeticsPath, "utf8");
  const arithmeticsLib = loadLibrary(compileLibrary(arithmeticsSource, { source: arithmeticsPath }));

  const polyPath = fileURLToPath(import.meta.resolve("../../Examples/poly.k"));
  const polySource = fs.readFileSync(polyPath, "utf8");

  function buildExportPreamble(exports, libraries) {
    const aliasMap = {};
    for (const lib of libraries) {
      for (const [name, hash] of Object.entries(lib.relAlias || {})) {
        if (name !== "__main__") aliasMap[name] = hash;
      }
    }
    const lines = [];
    for (const spec of exports) {
      const [libName, localName] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
      const hash = aliasMap[libName];
      if (!hash) throw new Error(`--export: '${libName}' not found in loaded libraries`);
      const body = hash.startsWith("@") ? hash.slice(1) : hash;
      lines.push(`${localName} = @${body};`);
    }
    return lines.join("\n") + "\n";
  }

  const neededExports = ["0", "int", "inc", "dec", "nat", "zero_int?", "nil", "cons", "car", "cdr"];
  const exportPreamble = buildExportPreamble(neededExports, [arithmeticsLib]);
  const polyLib = loadLibrary(compileLibrary(exportPreamble + polySource, {
    source: polyPath,
    libraries: [arithmeticsLib]
  }));

  const state = {
    codes: { ...arithmeticsLib.codes, ...polyLib.codes },
    rels: { ...arithmeticsLib.rels, ...polyLib.rels },
    typeAliases: {},
    relAliases: { ...polyLib.relAlias },
    meta: { ...arithmeticsLib.meta, ...polyLib.meta }
  };

  for (const [hash, entry] of Object.entries(arithmeticsLib.meta)) {
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
