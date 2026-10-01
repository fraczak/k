import { annotate } from "../../index.mjs";
import { exportPatternGraph } from "./codec.mjs";
import { patternToPropertyList } from "./pattern-json.mjs";

const patternCache = new Map();

export function rootPatternIdFromMainRel(mainRel) {
  if (!mainRel || !mainRel.typePatternGraph) {
    throw new Error("Could not resolve __main__ relation");
  }

  switch (mainRel.def.op) {
    case "filter":
    case "code":
      return mainRel.typePatternGraph.find(mainRel.def.patterns[0]);
    default:
      throw new Error(`Main expression must be a filter or a type name, got '${mainRel.def.op}'`);
  }
}

export function patternFromFilter(script, options = {}) {
  if (!script || typeof script !== "string") {
    throw new Error("patternFromFilter requires a k script string");
  }
  const cacheKey = script.trim();
  if (options && Object.keys(options).length === 0 && patternCache.has(cacheKey)) {
    return patternCache.get(cacheKey);
  }

  const annotated = annotate(script, options);
  const mainRel = annotated.rels.__main__;
  const root = rootPatternIdFromMainRel(mainRel);
  const pattern = exportPatternGraph(mainRel.typePatternGraph, root);
  const propertyList = patternToPropertyList(pattern);

  if (options && Object.keys(options).length === 0) {
    patternCache.set(cacheKey, propertyList);
  }
  return propertyList;
}

export default {
  patternFromFilter,
  rootPatternIdFromMainRel
};
