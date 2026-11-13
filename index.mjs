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


function resolveUseImports(useSpecs, libraries) {
  const importedPatterns = new Map();
  const importedRels = new Map();
  if (!libraries || useSpecs.length === 0) {
    return { importedPatterns, importedRels };
  }

  for (const spec of useSpecs) {
    const parts = spec.trim().split(/[\s,]+/);
    for (const item of parts) {
      if (!item) continue;
      const [rawLib, rawLocal] = item.includes(":") ? item.split(":", 2) : [item, item];
      const hasExplicitBrackets =
        /\[.*\]$/.test(rawLib.trim()) || /\[.*\]$/.test(rawLocal.trim());
      const libName = rawLib.replace(/\[.*\]$/, "").trim();
      const localName = rawLocal.replace(/\[.*\]$/, "").trim();

      let matchedRel = null;
      if (!hasExplicitBrackets && libName !== "__main__" && localName !== "__main__") {
        for (const lib of libraries) {
          const libRels = lib.rels || lib.defs?.rels || {};
          const relHash = lib.relAlias?.[libName] || (libName.startsWith("@") ? libName : null);
          const rel = (relHash && libRels[relHash]) || libRels[libName];
          if (!rel) continue;
          const resolvedHash = relHash || libName;
          if (matchedRel && matchedRel.hash && resolvedHash && matchedRel.hash !== resolvedHash) {
            console.warn(
              `WARNING: Relation '${localName}' declared by --use is redefined; later definition wins.`
            );
          }
          matchedRel = { hash: resolvedHash, rel };
        }
      }

      if (matchedRel) {
        if (importedRels.has(localName)) {
          console.warn(
            `WARNING: Relation '${localName}' declared by --use is redefined; later definition wins.`
          );
        }
        importedRels.set(localName, matchedRel);
        continue;
      }

      let matchedPat = null;
      for (const lib of libraries) {
        const libPatterns = lib.patterns || lib.defs?.patterns || lib.sourceDefs?.patterns || {};
        const patHash = lib.patternAlias?.[libName] || (libName.startsWith("@") ? libName : null);
        const pat = (patHash && libPatterns[patHash]) || libPatterns[libName];
        if (!pat) continue;
        const resolvedHash = patHash || pat._canonical || null;
        if (
          matchedPat &&
          ((matchedPat.hash && resolvedHash && matchedPat.hash !== resolvedHash) ||
            (!matchedPat.hash && matchedPat.pat !== pat))
        ) {
          console.warn(
            `WARNING: Pattern '${localName}[]' declared by --use is redefined; later definition wins.`
          );
        }
        matchedPat = { hash: resolvedHash, pat };
      }

      if (matchedPat) {
        if (importedPatterns.has(localName)) {
          console.warn(
            `WARNING: Pattern '${localName}[]' declared by --use is redefined; later definition wins.`
          );
        }
        importedPatterns.set(localName, matchedPat);
      }
    }
  }

  return { importedPatterns, importedRels };
}

function annotate(script, options = {}) {
  const { defs, exp } = parse(script);

  const representatives = codes.register(defs.codes);
  const localPatterns = { ...(defs.patterns || {}) };
  const localRels = { ...(defs.rels || {}) };
  const useSpecs = [...(options.useSpecs || options.use || [])];
  const { importedPatterns, importedRels } = resolveUseImports(
    useSpecs,
    options.libraries
  );

  // 1. Inject library @hash patterns; friendly names only come from --use or local definitions.
  defs.patterns = {};
  if (options.libraries) {
    for (const lib of options.libraries) {
      const libPatterns =
        lib.patterns ||
        lib.defs?.patterns ||
        lib.sourceDefs?.patterns ||
        {};
      for (const [name, pat] of Object.entries(libPatterns)) {
        if (name.startsWith("@") && !(name in defs.patterns)) {
          defs.patterns[name] = pat;
        }
      }
    }
  }

  // 2. Apply --use pattern aliases, then local pattern definitions (later wins with warning on collision).
  for (const [localName, { pat }] of importedPatterns.entries()) {
    defs.patterns[localName] = pat;
  }
  for (const [name, pat] of Object.entries(localPatterns)) {
    if (!name.startsWith("@") && importedPatterns.has(name)) {
      console.warn(
        `WARNING: Pattern '${name}[]' declared by --use is redefined by local definition; later definition wins.`
      );
    }
    defs.patterns[name] = pat;
  }

  validatePatternDefinitions(defs.patterns, options);

  // 3. Inject library @hash relations, then --use relation aliases, then local relations.
  const rels = {};
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

  const useRelHashes = {};
  for (const [localName, { hash, rel }] of importedRels.entries()) {
    rels[localName] = { ...rel, _library: true };
    if (hash) useRelHashes[localName] = hash;
  }
  for (const [name, rel] of Object.entries(localRels)) {
    if (!name.startsWith("@") && importedRels.has(name)) {
      console.warn(
        `WARNING: Relation '${name}' declared by --use is redefined by local definition; later definition wins.`
      );
      delete useRelHashes[name];
    }
    rels[name] = rel;
  }
  rels.__main__ = { def: exp };

  expandPatternsInRels(rels, defs.patterns, options);

  const { relAlias, compileStats } = compileTypes(representatives, rels, {
    ...options,
    _useRelAlias: useRelHashes
  });
 
  return {rels, representatives, relAlias, compileStats, sourceDefs: defs};
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate, parseValue, fromObject };
export { compile, runScriptOnData as run, parse, annotate, parseValue, fromObject };
