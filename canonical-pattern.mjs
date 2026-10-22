// canonical-pattern.mjs
// Canonical representation, hash resolution, and export helpers.

import { annotate } from "./index.mjs";
import { patternGraphToCanonical, prettyFilter } from "./pretty.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { closedPatternToCodeHash } from "./repl-codecs.mjs";

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
  const params = pat.params || [];
  const source = `? ${name}[${params.join(", ")}]`;
  try {
    const annotated = annotate(source, {
      libraries: options.libraries || [],
      patterns: options.patterns || {}
    });
    const mainRel = annotated.rels.__main__;
    if (
      mainRel?.typePatternGraph &&
      mainRel?.def?.patterns?.[0] != null
    ) {
      const rootId = mainRel.typePatternGraph.find(
        mainRel.def.patterns[0]
      );
      const expectedParamCount =
        pat.params != null ? pat.params.length : null;
      const { filter: canonicalFilter, canonicalParams } =
        patternGraphToCanonical(
          mainRel.typePatternGraph,
          rootId,
          expectedParamCount
        );
      if (canonicalFilter) {
        pat._canonicalDef = prettyFilter(canonicalFilter);
        pat._canonicalParams = canonicalParams;
      }
      const propList = patternToPropertyList(
        exportPatternGraph(mainRel.typePatternGraph, rootId)
      );
      const codeHash = closedPatternToCodeHash(propList);
      if (codeHash) {
        pat._canonical = codeHash;
        return {
          hash: codeHash,
          def: pat._canonicalDef || null,
          params: pat._canonicalParams || null
        };
      }
    }
    const relHash = annotated.relAlias?.__main__ || null;
    if (relHash) {
      pat._canonical = relHash;
      return {
        hash: relHash,
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
