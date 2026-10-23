// canonical-pattern.mjs
// Canonical representation, hash resolution, and export helpers.

import { annotate } from "./index.mjs";
import { patternGraphToCanonical, prettyFilter } from "./pretty.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { closedPatternToCodeHash } from "./repl-codecs.mjs";
import hash from "./hash.mjs";
import { expandFilter } from "./named-patterns.mjs";

function collectParamTraversal(filter) {
  const seen = new Set();
  const order = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "name" && typeof node.name === "string") {
      const match = node.name.match(/^__PARAM_(\d+)__$/);
      if (match) {
        const idx = Number(match[1]);
        if (!seen.has(idx)) {
          seen.add(idx);
          order.push(idx);
        }
      }
    }
    if (node.fields) {
      for (const k of Object.keys(node.fields).sort()) {
        walk(node.fields[k]);
      }
    }
  }
  walk(filter);
  return order;
}

function remapFilterVars(filter, map) {
  if (!filter || typeof filter !== "object") return filter;
  const res = { ...filter };
  if (filter.name && map[filter.name]) {
    res.name = map[filter.name];
  }
  if (filter.type === "name" && map[filter.name]) {
    res.name = map[filter.name];
  }
  if (filter.fields) {
    res.fields = {};
    for (const [k, v] of Object.entries(filter.fields)) {
      res.fields[k] = remapFilterVars(v, map);
    }
  }
  return res;
}

export function resolvePatternCanonicalInfo(name, pat, options = {}) {
  if (!pat) return { hash: null, def: null, params: null };
  if (pat._canonical && pat._canonicalDef) {
    return {
      hash: pat._canonical,
      def: pat._canonicalDef,
      params: pat._canonicalParams || pat.params || null
    };
  }
  if (typeof name === "string" && name.startsWith("@")) {
    pat._canonical = name;
  }
  const formalParams = pat.params || [];
  const formalCount = formalParams.length;
  const allPatterns = { ...(options.patterns || {}) };
  if (name && pat) allPatterns[name] = pat;

  let traversalParamIndices = [];
  if (formalCount > 0) {
    try {
      const markerArgs = formalParams.map((_, i) => ({
        type: "name",
        name: `__PARAM_${i}__`
      }));
      const expanded = expandFilter(
        { type: "pattern_apply", pattern: name, args: markerArgs },
        allPatterns
      );
      traversalParamIndices = collectParamTraversal(expanded);
    } catch {
      traversalParamIndices = [];
    }
  }

  const dummyParams = formalParams.map((_, i) => `P${i}`);
  const source = `? ${name}[${dummyParams.join(", ")}]`;
  try {
    const annotated = annotate(source, {
      libraries: options.libraries || [],
      patterns: allPatterns
    });
    const mainRel = annotated.rels.__main__;
    let canonicalFilter = null;
    let canonicalParams = null;
    if (
      mainRel?.typePatternGraph &&
      mainRel?.def?.patterns?.[0] != null
    ) {
      const rootId = mainRel.typePatternGraph.find(
        mainRel.def.patterns[0]
      );
      const res = patternGraphToCanonical(
        mainRel.typePatternGraph,
        rootId,
        formalCount
      );
      canonicalFilter = res.filter;
      canonicalParams = res.canonicalParams;

      const propList = patternToPropertyList(
        exportPatternGraph(mainRel.typePatternGraph, rootId)
      );
      const codeHash = closedPatternToCodeHash(propList);
      if (codeHash) {
        pat._canonical = codeHash;
        pat._canonicalDef = prettyFilter(canonicalFilter);
        pat._canonicalParams = canonicalParams;
        return {
          hash: codeHash,
          def: pat._canonicalDef,
          params: pat._canonicalParams
        };
      }
    }

    let finalFilter = canonicalFilter;
    if (
      canonicalFilter &&
      formalCount > 0 &&
      canonicalParams?.length > 0
    ) {
      const remap = {};
      for (let j = 0; j < canonicalParams.length; j++) {
        const origVar = canonicalParams[j];
        const paramIdx = traversalParamIndices[j];
        if (paramIdx != null) {
          const targetVar =
            canonicalParams[paramIdx] || `X${paramIdx}`;
          if (origVar !== targetVar) {
            remap[origVar] = targetVar;
          }
        }
      }
      if (Object.keys(remap).length > 0) {
        finalFilter = remapFilterVars(canonicalFilter, remap);
      }
    }

    if (finalFilter) {
      pat._canonicalDef = prettyFilter(finalFilter);
      pat._canonicalParams = canonicalParams;
    }

    const relHash = annotated.relAlias?.__main__ || null;
    if (relHash) {
      const isIdentity =
        traversalParamIndices.length === formalCount &&
        traversalParamIndices.every((idx, pos) => idx === pos);
      let finalHash = relHash;
      if (!isIdentity && traversalParamIndices.length > 0) {
        finalHash = hash(
          `${relHash}:${traversalParamIndices.join(",")}`
        );
      }
      pat._canonical = finalHash;
      return {
        hash: finalHash,
        def: pat._canonicalDef || null,
        params: pat._canonicalParams || null
      };
    }
  } catch {
    return {
      hash: pat._canonical || null,
      def: pat._canonicalDef || null,
      params: pat._canonicalParams || null
    };
  }
  return {
    hash: pat._canonical || null,
    def: pat._canonicalDef || null,
    params: pat._canonicalParams || null
  };
}

export function canonicalPatternHash(name, pat, options = {}) {
  return resolvePatternCanonicalInfo(name, pat, options).hash;
}

export function buildExportPreamble(exports = [], libraries = []) {
  if (exports.length === 0) return "";
  const relMap = {};
  const patMap = {};
  for (const lib of libraries) {
    for (const [name, hash] of Object.entries(lib.relAlias || {})) {
      if (name !== "__main__") relMap[name] = { hash };
    }
    for (const [name, hash] of Object.entries(lib.patternAlias || {})) {
      patMap[name] = {
        hash,
        params:
          lib.patterns?.[name]?.params ||
          lib.patterns?.[hash]?.params ||
          []
      };
    }
    for (const [name, pat] of Object.entries(lib.patterns || {})) {
      if (!patMap[name]) {
        patMap[name] = {
          hash: pat._canonical || lib.patternAlias?.[name] || name,
          params: pat.params || []
        };
      }
    }
    for (const [hash, entry] of Object.entries(lib.meta || {})) {
      for (const origin of entry?.origins || []) {
        const type = origin?.type || entry?.type;
        if (type === "rel") {
          if (origin?.name && origin.name !== "__main__") {
            relMap[origin.name] = { hash };
          }
        } else if (type === "pattern") {
          if (origin?.name) {
            patMap[origin.name] = {
              hash,
              params: entry.params || origin.params || []
            };
          }
        }
      }
    }
  }

  const lines = [];
  for (const spec of exports) {
    const [rawLib, rawLocal] = spec.includes(":")
      ? spec.split(":", 2)
      : [spec, spec];
    const isExplicitPattern =
      rawLib.includes("[") || rawLocal.includes("[");
    const libName = rawLib.replace(/\[.*\]$/, "").trim();
    const localName = rawLocal.replace(/\[.*\]$/, "").trim();

    let emitted = false;
    if (!isExplicitPattern && relMap[libName]) {
      const target = relMap[libName];
      const body = target.hash.startsWith("@")
        ? target.hash.slice(1)
        : target.hash;
      lines.push(`${localName} = @${body};`);
      emitted = true;
    }
    if (patMap[libName]) {
      if (isExplicitPattern || !emitted || relMap[libName]) {
        const target = patMap[libName];
        const body = target.hash.startsWith("@")
          ? target.hash.slice(1)
          : target.hash;
        const paramStr =
          target.params && target.params.length > 0
            ? `[${target.params.join(", ")}]`
            : "[]";
        lines.push(`${localName}${paramStr} = @${body}${paramStr};`);
        emitted = true;
      }
    }
    if (!emitted) {
      throw new Error(
        `--export: '${rawLib}' not found in loaded libraries`
      );
    }
  }
  return lines.join("\n") + "\n";
}

export default {
  resolvePatternCanonicalInfo,
  canonicalPatternHash,
  buildExportPreamble
};
