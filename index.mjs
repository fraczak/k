import { parse } from "./parser.mjs";
import { fromObject, isValue } from "./Value.mjs";
import { parseValue } from "./valueIO.mjs";
import { compileTypes } from "./compiler.mjs";
import {
  expandPatternsInRels,
  validatePatternDefinitions
} from "./named-patterns.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";

function compile(script, options = {}) {
  run.defs = annotate(script, options);
  const mainRel = run.defs.rels.__main__;
  return (value) => {
    const result = run(codes.find, mainRel.def, value, mainRel.typePatternGraph);
    if (result === undefined) return;
    return result;
  };
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data, options = {}) {
  let parsedData;
  if (isValue(data)) {
    parsedData = data;
  } else if (typeof data === "string") {
    parsedData = parseValue(data, null, null);
  } else  {
    parsedData = fromObject(data);
  }
  return compile(script, options)(parsedData);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";


function annotate(script, options = {}) {
  const { defs, exp } = parse(script);

  const representatives = codes.register(defs.codes);
  const rels = {...defs.rels, "__main__": {def: exp}};

  // 1. Inject library patterns into defs.patterns before validation and expansion
  // NOTE: Library patterns are known by their hashes ONLY unless --use is specified.
  if (options.libraries) {
    for (const lib of options.libraries) {
      const libPatterns =
        lib.patterns ||
        lib.defs?.patterns ||
        lib.sourceDefs?.patterns ||
        {};
      for (const [name, pat] of Object.entries(libPatterns)) {
        if (name.startsWith("@") && !(name in (defs.patterns || {}))) {
          if (!defs.patterns) defs.patterns = {};
          defs.patterns[name] = pat;
        }
      }
    }
  }

  // 2. Handle pattern aliases from useSpecs / use (e.g. float64[]:number[])
  const useSpecs = [...(options.useSpecs || options.use || [])];
  if (options.libraries && useSpecs.length > 0) {
    for (const spec of useSpecs) {
      const parts = spec.trim().split(/[\s,]+/);
      for (const item of parts) {
        if (!item) continue;
        const [rawLib, rawLocal] = item.includes(":") ? item.split(":", 2) : [item, item];
        const libName = rawLib.replace(/\[.*\]$/, "").trim();
        const localName = rawLocal.replace(/\[.*\]$/, "").trim();
        for (const lib of options.libraries) {
          const libPatterns = lib.patterns || lib.defs?.patterns || lib.sourceDefs?.patterns || {};
          const patHash = lib.patternAlias?.[libName] || (libName.startsWith("@") ? libName : null);
          const pat = (patHash && libPatterns[patHash]) || libPatterns[libName];
          if (pat) {
            if (!defs.patterns) defs.patterns = {};
            if (!(localName in defs.patterns)) {
              defs.patterns[localName] = pat;
            }
          }
        }
      }
    }
  }

  validatePatternDefinitions(defs.patterns || {}, options);
  expandPatternsInRels(rels, defs.patterns || {}, options);

  // 3. Inject library relations into the rels table so @hash refs resolve
  // NOTE: Library relations are known by their hashes ONLY unless --use is specified.
  if (options.libraries) {
    for (const lib of options.libraries) {
      const libRels = lib.rels || lib.defs?.rels || {};
      for (const [name, rel] of Object.entries(libRels)) {
        if (name.startsWith("@") && !(name in rels)) {
          rels[name] = { ...rel, _library: true };
        }
      }
    }
  }

  // 4. Handle relation aliases from useSpecs / use (e.g. inc:inc_bits)
  if (options.libraries && useSpecs.length > 0) {
    for (const spec of useSpecs) {
      const parts = spec.trim().split(/[\s,]+/);
      for (const item of parts) {
        if (!item) continue;
        const [rawLib, rawLocal] = item.includes(":") ? item.split(":", 2) : [item, item];
        const libName = rawLib.replace(/\[.*\]$/, "").trim();
        const localName = rawLocal.replace(/\[.*\]$/, "").trim();
        for (const lib of options.libraries) {
          const libRels = lib.rels || lib.defs?.rels || {};
          const relHash = lib.relAlias?.[libName] || (libName.startsWith("@") ? libName : null);
          const rel = (relHash && libRels[relHash]) || libRels[libName];
          if (rel && !(localName in rels)) {
            rels[localName] = { ...rel, _library: true };
          }
        }
      }
    }
  }

  const { relAlias, compileStats } = compileTypes(representatives, rels, options);
 
  return {rels, representatives, relAlias, compileStats, sourceDefs: defs};
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate, parseValue, fromObject };
export { compile, runScriptOnData as run, parse, annotate, parseValue, fromObject };
