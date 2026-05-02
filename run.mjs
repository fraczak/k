import assert from "assert";
import { Product, Variant, edgeSubpattern, composePattern, withPattern } from "./Value.mjs"
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

const builtin = {
  "_log!": (arg) => {
    console.error(`_log!: ${arg}`);

    return arg;
  }
};

const codes = { };
const singletonPatternCache = new WeakMap();

function singletonOutputPattern(typePatternGraph, exp) {
  if (!typePatternGraph || !exp.patterns) return null;

  const outputPatternId = typePatternGraph.find(exp.patterns[1]);
  const outputPattern = typePatternGraph.get_pattern(outputPatternId);
  if (outputPattern.pattern !== "type") return null;
  return exportedPattern(typePatternGraph, outputPatternId);
}

function exportedPattern(typePatternGraph, patternId) {
  let graphCache = singletonPatternCache.get(typePatternGraph);
  if (!graphCache) {
    graphCache = new Map();
    singletonPatternCache.set(typePatternGraph, graphCache);
  }
  patternId = typePatternGraph.find(patternId);
  if (!graphCache.has(patternId)) {
    graphCache.set(
      patternId,
      patternToPropertyList(exportPatternGraph(typePatternGraph, patternId))
    );
  }
  return graphCache.get(patternId);
}

function singletonProjectionPattern(typePatternGraph, exp, label) {
  if (!typePatternGraph || !exp.patterns) return null;

  const inputPatternId = typePatternGraph.find(exp.patterns[0]);
  const inputPattern = typePatternGraph.get_pattern(inputPatternId);
  if (inputPattern.pattern !== "type") return null;

  const targets = typePatternGraph.edges[inputPatternId]?.[label] || [];
  if (targets.length !== 1) return null;
  const targetPatternId = typePatternGraph.find(targets[0]);
  if (typePatternGraph.get_pattern(targetPatternId).pattern !== "type") return null;
  return exportedPattern(typePatternGraph, targetPatternId);
}

function withStaticSingletonOutput(value, typePatternGraph, exp) {
  return withPattern(value, singletonOutputPattern(typePatternGraph, exp));
}

function verify(findCode, code, value) {
  "use strict";
  if (code == null) return false;
  code = findCode(code);
  switch (code.code) {
    case "product":
      if (! (value instanceof Product)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== Object.keys(code.product).length) return false;
        return fields.every((label) =>
          verify(findCode, code.product[label], value.product[label])
        );
      }
    case "union":
      if (! (value instanceof Product)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== 1) return false;
        return verify(findCode, code.union[fields[0]], value.product[fields[0]]);
      }
    default: 
      return codes[code.code](value);
  }
}

function run(findCode, exp, value, typePatternGraph) {
  // console.log("RUN", JSON.stringify({exp, value}, null, 2));
  "use strict";
  typePatternGraph = typePatternGraph || null;
  if (value === undefined) return;
  while (true) {    
    switch (exp.op) {
      case "code":
        if (verify(findCode, exp.code, value)) {
          return withStaticSingletonOutput(value, typePatternGraph, exp);
        }
        return;
      case "identity":
        return withStaticSingletonOutput(value, typePatternGraph, exp);
      case "ref": {
        const defn = run.defs.rels[exp.ref];
        if (defn != undefined) {
          exp = defn.def;
          typePatternGraph = defn.typePatternGraph;
          continue;
        }
        const builtin_func = builtin[exp.ref];
        if (builtin_func != null) {
          return withStaticSingletonOutput(builtin_func(value), typePatternGraph, exp);
        }
        throw(`Unknown ref: '${exp.ref}'`);
      }
      case "dot":
        return withPattern(
          value.product[exp.dot],
          singletonProjectionPattern(typePatternGraph, exp, exp.dot) ||
            singletonOutputPattern(typePatternGraph, exp) ||
            edgeSubpattern(value.pattern, exp.dot)
        );
      case "div":
        if (value.tag === exp.div) return withPattern(
          value.value,
          singletonProjectionPattern(typePatternGraph, exp, exp.div) ||
            singletonOutputPattern(typePatternGraph, exp) ||
            edgeSubpattern(value.pattern, exp.div)
        );
        return
      case "comp":
        for (let i = 0, len = exp.comp.length - 1; i < len; i++) {
          const result = run(findCode, exp.comp[i], value, typePatternGraph);
          if (result === undefined) return;
          value = result;
        }
        exp = exp.comp[exp.comp.length - 1];
        continue;
      case "union":
        if (exp.union.length === 0) return;
        for (let i = 0, len = exp.union.length -1; i < len; i++) {
          const result = run(findCode, exp.union[i], value, typePatternGraph);
          if (result !== undefined) {
            return withStaticSingletonOutput(result, typePatternGraph, exp);
          }
        }
        exp = exp.union[exp.union.length - 1];
        continue;
    
      case "product": {
        let result = {};
        const patternEntries = [];
        let len = exp.product.length;
        for (let i = 0; i < len; i++) {
          const { label, exp: e } = exp.product[i];
          const r = run(findCode, e, value, typePatternGraph);
          if (r === undefined) return;
          result[label] = r;
          patternEntries.push([label, r.pattern]);
        }
        return withStaticSingletonOutput(
          new Product(result, composePattern("closed-product", patternEntries)),
          typePatternGraph,
          exp
        );
      }
      case "vid":
        return withStaticSingletonOutput(
          new Variant(exp.vid, value, composePattern("closed-union", [[exp.vid, value.pattern]])),
          typePatternGraph,
          exp
        );
      case "filter": {
        return withStaticSingletonOutput(value, typePatternGraph, exp);
      }
      default:
        assert(false,`Unknown operation: '${exp.op}'`);
    
    }
  };
}

run.builtin = builtin;

export default run;
export { run  };
