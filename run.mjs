import assert from "assert";
import { Product, Variant, edgeSubpattern, composePattern, withPattern } from "./Value.mjs"
import { exportPatternGraph, intersectPropertyListPatterns } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

const builtin = {
  "_log!": (arg) => {
    console.error(`_log!: ${arg}`);

    return arg;
  }
};

const codes = { };
const staticPatternCache = new WeakMap();
const intersectionCache = new Map();
const singletonCheckCache = new WeakMap();
const patternPairCache = new WeakMap();
const NULL_INTERSECTION = {};

function staticPattern(typePatternGraph, exp, index) {
  if (!typePatternGraph || !exp.patterns) return null;
  return exportedPattern(typePatternGraph, exp.patterns[index]);
}

function isSingletonPattern(pattern) {
  if (singletonCheckCache.has(pattern)) return singletonCheckCache.get(pattern);
  const result = pattern.every(([kind]) => kind === "closed-product" || kind === "closed-union");
  singletonCheckCache.set(pattern, result);
  return result;
}

function intersectPatterns(left, right) {
  if (!left || left.length === 0) return right;
  if (!right || right.length === 0) return left;
  if (left === right) return left;
  if (left[0]?.[0] === "any") return right;
  if (right[0]?.[0] === "any") return left;

  const cached = patternPairCache.get(left)?.get(right);
  if (cached !== undefined) return cached === NULL_INTERSECTION ? null : cached;

  function cache(result) {
    let rightMap = patternPairCache.get(left);
    if (!rightMap) {
      rightMap = new WeakMap();
      patternPairCache.set(left, rightMap);
    }
    rightMap.set(right, result || NULL_INTERSECTION);
    return result;
  }

  if (isSingletonPattern(left) || isSingletonPattern(right)) {
    try {
      return cache(intersectPropertyListPatterns(left, right));
    } catch {
      return cache(null);
    }
  }

  const leftKey = JSON.stringify(left);
  const rightKey = JSON.stringify(right);
  if (leftKey === rightKey) return left;

  const key = `${leftKey}\n${rightKey}`;
  if (intersectionCache.has(key)) return cache(intersectionCache.get(key));

  try {
    const pattern = intersectPropertyListPatterns(left, right);
    intersectionCache.set(key, pattern);
    return cache(pattern);
  } catch {
    intersectionCache.set(key, null);
    return cache(null);
  }
}

function exportedPattern(typePatternGraph, patternId) {
  let graphCache = staticPatternCache.get(typePatternGraph);
  if (!graphCache) {
    graphCache = new Map();
    staticPatternCache.set(typePatternGraph, graphCache);
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

function expLocation(exp) {
  return exp.start ? ` (lines ${exp.start.line}:${exp.start.column}...${exp.end?.line}:${exp.end?.column})` : "";
}

function patternPreview(pattern) {
  return JSON.stringify(pattern);
}

function constrainInput(value, typePatternGraph, exp) {
  const constraint = staticPattern(typePatternGraph, exp, 0);
  if (!constraint && (!value.pattern || value.pattern.length === 0)) return value;
  const pattern = intersectPatterns(constraint, value.pattern);
  if (!pattern) {
    throw new TypeError(
      `Type Error in '${exp.op}'${expLocation(exp)}\n` +
      ` - Value envelope does not intersect expression input pattern.\n` +
      ` - input pattern: ${patternPreview(constraint)}\n` +
      ` - value envelope: ${patternPreview(value.pattern)}`
    );
  }
  return withPattern(value, pattern);
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
  value = constrainInput(value, typePatternGraph, exp);
  if (value === undefined) return;
  while (true) {    
    switch (exp.op) {
      case "code":
        if (verify(findCode, exp.code, value)) {
          return value;
        }
        return;
      case "identity":
        return value;
      case "ref": {
        const defn = run.defs.rels[exp.ref];
        if (defn != undefined) {
          return run(findCode, defn.def, value, defn.typePatternGraph);
        }
        const builtin_func = builtin[exp.ref];
        if (builtin_func != null) {
          return builtin_func(value);
        }
        throw(`Unknown ref: '${exp.ref}'`);
      }
      case "dot":
        return withPattern(value.product[exp.dot], edgeSubpattern(value.pattern, exp.dot));
      case "div":
        if (value.tag === exp.div) return withPattern(value.value, edgeSubpattern(value.pattern, exp.div));
        return
      case "comp":
        for (let i = 0, len = exp.comp.length - 1; i < len; i++) {
          const result = run(findCode, exp.comp[i], value, typePatternGraph);
          if (result === undefined) return;
          value = result;
        }
        exp = exp.comp[exp.comp.length - 1];
        value = constrainInput(value, typePatternGraph, exp);
        if (value === undefined) return;
        continue;
      case "union":
        if (exp.union.length === 0) return;
        for (let i = 0, len = exp.union.length -1; i < len; i++) {
          const result = run(findCode, exp.union[i], value, typePatternGraph);
          if (result !== undefined) {
            return result;
          }
        }
        exp = exp.union[exp.union.length - 1];
        value = constrainInput(value, typePatternGraph, exp);
        if (value === undefined) return;
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
        return new Product(result, composePattern("closed-product", patternEntries));
      }
      case "vid":
        return new Variant(exp.vid, value, composePattern("open-union", [[exp.vid, value.pattern]]));
      case "filter": {
        return value;
      }
      default:
        assert(false,`Unknown operation: '${exp.op}'`);
    
    }
  };
}

run.builtin = builtin;

export default run;
export { run  };
