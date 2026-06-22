import assert from "assert";
import { Value, edgeSubpattern, composePattern, withPattern, isProduct, isVariant } from "./Value.mjs"
import { exportPatternGraph, intersectPropertyListPatterns } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { jsIntrinsicFunctions } from "./intrinsics.mjs";

const builtin = jsIntrinsicFunctions;

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

function outputPattern(typePatternGraph, exp) {
  return staticPattern(typePatternGraph, exp, 1);
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
  return constrainWithPattern(value, constraint, exp);
}

function constrainWithPattern(value, constraint, exp) {
  if (!constraint) return value;
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

function projectionPattern(staticOutputPattern, valuePattern, label, exp) {
  const dynamicOutputPattern = edgeSubpattern(valuePattern, label);
  const pattern = intersectPatterns(staticOutputPattern, dynamicOutputPattern);
  if (!pattern && staticOutputPattern && dynamicOutputPattern) {
    throw new TypeError(
      `Type Error in '${exp.op}'${expLocation(exp)}\n` +
      ` - Projected value envelope does not intersect expression output pattern.\n` +
      ` - output pattern: ${patternPreview(staticOutputPattern)}\n` +
      ` - projected envelope: ${patternPreview(dynamicOutputPattern)}`
    );
  }
  return pattern;
}

function compiledExp(findCode, exp, typePatternGraph) {
  const cached = exp._compiledRun;
  if (cached?.findCode === findCode && cached?.typePatternGraph === typePatternGraph && cached?.defs === run.defs) {
    return cached.fn;
  }

  const compiled = {
    findCode,
    typePatternGraph,
    defs: run.defs,
    target: null,
    fn(value) {
      return compiled.target(value);
    }
  };
  exp._compiledRun = compiled;

  const inputPattern = staticPattern(typePatternGraph, exp, 0);
  const staticOutputPattern = outputPattern(typePatternGraph, exp);
  const constrain = (value) => {
    if (value === undefined) return undefined;
    return constrainWithPattern(value, inputPattern, exp);
  };
  const defined = (value) => value;

  let fn;
  switch (exp.op) {
    case "code":
      fn = (value) => {
        value = constrain(value);
        if (value === undefined) return undefined;
        return verify(findCode, exp.code, value) ? value : undefined;
      };
      break;
    case "identity":
      fn = defined;
      break;
    case "filter":
      fn = constrain;
      break;
    case "ref":
      {
        const defn = run.defs.rels[exp.ref];
        if (defn != undefined) {
          const refFn = compiledRel(findCode, defn, exp.ref);
          fn = (value) => {
            return value === undefined ? undefined : refFn(value);
          };
        } else {
          const builtin_func = builtin[exp.ref];
          if (builtin_func != null) {
            fn = (value) => {
              value = constrain(value);
              return value === undefined ? undefined : builtin_func(value);
            };
          } else {
            fn = () => {
              throw(`Unknown ref: '${exp.ref}'`);
            };
          }
        }
      }
      break;
    case "dot":
      fn = (value) => {
        if (value === undefined) return undefined;
        return withPattern(value.product[exp.dot], projectionPattern(staticOutputPattern, value.pattern, exp.dot, exp));
      };
      break;
    case "div":
      fn = (value) => {
        if (value === undefined || value.tag !== exp.div) return undefined;
        return withPattern(value.value, projectionPattern(staticOutputPattern, value.pattern, exp.div, exp));
      };
      break;
    case "comp": {
      const parts = exp.comp.map((part) => compiledExp(findCode, part, typePatternGraph));
      fn = (value) => {
        value = constrain(value);
        for (let i = 0, len = parts.length; i < len; i++) {
          value = parts[i](value);
          if (value === undefined) return undefined;
        }
        return value;
      };
      break;
    }
    case "union": {
      const parts = exp.union.map((part) => compiledExp(findCode, part, typePatternGraph));
      fn = (value) => {
        if (value === undefined) return undefined;
        for (let i = 0, len = parts.length; i < len; i++) {
          const result = parts[i](value);
          if (result !== undefined) return result;
        }
        return undefined;
      };
      break;
    }
    case "product": {
      const labels = exp.product.map(({ label }) => label);
      const fieldFns = exp.product.map(({ exp: e }) => compiledExp(findCode, e, typePatternGraph));
      fn = (value) => {
        if (value === undefined) return undefined;
        const result = {};
        const patternEntries = [];
        for (let i = 0, len = labels.length; i < len; i++) {
          const r = fieldFns[i](value);
          if (r === undefined) return undefined;
          const label = labels[i];
          result[label] = r;
          patternEntries.push([label, r.pattern]);
        }
        const dynamicOutputPattern = composePattern("closed-product", patternEntries);
        const pattern = staticOutputPattern && dynamicOutputPattern
          ? intersectPatterns(staticOutputPattern, dynamicOutputPattern)
          : staticOutputPattern || dynamicOutputPattern;
        if (!pattern && staticOutputPattern && dynamicOutputPattern) {
          throw new TypeError(
            `Type Error in '${exp.op}'${expLocation(exp)}\n` +
            ` - Product value envelope does not intersect expression output pattern.\n` +
            ` - output pattern: ${patternPreview(staticOutputPattern)}\n` +
            ` - product envelope: ${patternPreview(dynamicOutputPattern)}`
          );
        }
        return Value.product(result, pattern);
      };
      break;
    }
    case "vid":
      fn = (value) => {
        if (value === undefined) return undefined;
        return Value.variant(exp.vid, value, composePattern("open-union", [[exp.vid, value.pattern]]));
      };
      break;
    default:
      assert(false,`Unknown operation: '${exp.op}'`);
  }

  compiled.target = fn;
  return compiled.fn;
}

function compiledRel(findCode, relDef, name = "<anonymous>") {
  const cached = relDef._compiledRunRel;
  if (cached?.findCode === findCode && cached?.defs === run.defs) {
    return cached.fn;
  }

  const compiled = {
    findCode,
    defs: run.defs,
    target: null,
    fn(value) {
      return compiled.target(value);
    }
  };
  relDef._compiledRunRel = compiled;

  const exp = relDef.def;
  const typePatternGraph = relDef.typePatternGraph || null;
  const inputPattern = staticPattern(typePatternGraph, exp, 0);
  const staticOutputPattern = outputPattern(typePatternGraph, exp);
  const bodyFn = compiledExp(findCode, exp, typePatternGraph);

  compiled.target = (value) => {
    if (value === undefined) return undefined;
    value = constrainWithPattern(value, inputPattern, exp);
    const result = bodyFn(value);
    if (result === undefined) return undefined;
    try {
      return constrainWithPattern(result, staticOutputPattern, exp);
    } catch (error) {
      error.message = `Type Error in output of '${name}'\n - ${error.message}`;
      throw error;
    }
  };
  return compiled.fn;
}

function assertConvergedRel(rel, name) {
  const status = rel?.typeDerivation?.status || "unknown";
  if (status !== "converged") {
    throw new Error(`Cannot run '${name}' without envelopes: type derivation is ${status}`);
  }
}

function compiledConvergedExp(findCode, exp, typePatternGraph, options = {}) {
  const requireConverged = options.requireConverged === true;
  const cached = exp._compiledConvergedRun;
  if (
    cached?.findCode === findCode &&
    cached?.typePatternGraph === typePatternGraph &&
    cached?.defs === run_converged.defs &&
    cached?.requireConverged === requireConverged
  ) {
    return cached.fn;
  }

  const compiled = {
    findCode,
    typePatternGraph,
    defs: run_converged.defs,
    requireConverged,
    target: null,
    fn(value) {
      return compiled.target(value);
    }
  };
  exp._compiledConvergedRun = compiled;

  let fn;
  switch (exp.op) {
    case "code":
    case "filter":
    case "identity":
      fn = (value) => value;
      break;
    case "ref":
      {
        const defn = run_converged.defs?.rels?.[exp.ref];
        if (defn != undefined) {
          if (requireConverged) assertConvergedRel(defn, exp.ref);
          const refFn = compiledConvergedExp(findCode, defn.def, defn.typePatternGraph, options);
          fn = (value) => value === undefined ? undefined : refFn(value);
        } else {
          const builtin_func = builtin[exp.ref];
          if (builtin_func != null) {
            fn = (value) => value === undefined ? undefined : builtin_func(value);
          } else {
            fn = () => {
              throw(`Unknown ref: '${exp.ref}'`);
            };
          }
        }
      }
      break;
    case "dot":
      fn = (value) => {
        if (value === undefined || !isProduct(value)) return undefined;
        return Object.hasOwn(value.product, exp.dot) ? value.product[exp.dot] : undefined;
      };
      break;
    case "div":
      fn = (value) => {
        if (value === undefined || !isVariant(value) || value.tag !== exp.div) return undefined;
        return value.value;
      };
      break;
    case "comp": {
      const parts = exp.comp.map((part) => compiledConvergedExp(findCode, part, typePatternGraph, options));
      fn = (value) => {
        for (let i = 0, len = parts.length; i < len; i++) {
          value = parts[i](value);
          if (value === undefined) return undefined;
        }
        return value;
      };
      break;
    }
    case "union": {
      const parts = exp.union.map((part) => compiledConvergedExp(findCode, part, typePatternGraph, options));
      fn = (value) => {
        if (value === undefined) return undefined;
        for (let i = 0, len = parts.length; i < len; i++) {
          const result = parts[i](value);
          if (result !== undefined) return result;
        }
        return undefined;
      };
      break;
    }
    case "product": {
      const labels = exp.product.map(({ label }) => label);
      const fieldFns = exp.product.map(({ exp: e }) => compiledConvergedExp(findCode, e, typePatternGraph, options));
      fn = (value) => {
        if (value === undefined) return undefined;
        const result = {};
        for (let i = 0, len = labels.length; i < len; i++) {
          const r = fieldFns[i](value);
          if (r === undefined) return undefined;
          result[labels[i]] = r;
        }
        return Value.product(result);
      };
      break;
    }
    case "vid":
      fn = (value) => value === undefined ? undefined : Value.variant(exp.vid, value);
      break;
    default:
      assert(false,`Unknown operation: '${exp.op}'`);
  }

  compiled.target = fn;
  return compiled.fn;
}

function verify(findCode, code, value) {
  "use strict";
  if (code == null) return false;
  code = findCode(code);
  switch (code.code) {
    case "product":
      if (!isProduct(value)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== Object.keys(code.product).length) return false;
        return fields.every((label) =>
          verify(findCode, code.product[label], value.product[label])
        );
      }
    case "union":
      if (!isProduct(value)) return false;
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
  return compiledExp(findCode, exp, typePatternGraph || null)(value);
}

function run_rel(findCode, relDef, value, name) {
  return compiledRel(findCode, relDef, name)(value);
}

function run_converged(findCode, exp, value, typePatternGraph, options = {}) {
  const graph = typePatternGraph || null;
  const result = compiledConvergedExp(findCode, exp, graph, options)(value);
  if (result === undefined) return undefined;
  return withPattern(result, outputPattern(graph, exp));
}

run.builtin = builtin;
run_converged.builtin = builtin;
run_converged.defs = null;

const run_coverged = run_converged;

export default run;
export { run, run_rel, run_converged, run_coverged, constrainWithPattern, intersectPatterns, projectionPattern, verify };
