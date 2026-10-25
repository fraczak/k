// canonical-pattern.mjs
// Canonical representation, hash resolution, and export helpers.

import { annotate } from "./index.mjs";
import { patternGraphToCanonical, prettyFilter } from "./pretty.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { closedPatternToCodeHash } from "./repl-codecs.mjs";
import { expandFilter } from "./named-patterns.mjs";

function collectFilterKnots(filter) {
  const knots = new Set();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.name && node.type !== "name") {
      knots.add(node.name);
    }
    if (node.fields) {
      for (const child of Object.values(node.fields)) {
        walk(child);
      }
    }
    if (node.args) {
      for (const arg of node.args) {
        walk(arg);
      }
    }
  }
  walk(filter);
  return knots;
}

function skeletonizeFilter(filter, knots) {
  let leafIdx = 0;
  function walk(node) {
    if (!node || typeof node !== "object") return node;
    if (node.type === "name" && knots.has(node.name)) {
      return { ...node };
    }
    if (node.name && node.type !== "name") {
      const knotName = node.name;
      if (node.fields) {
        const newFields = {};
        for (const [k, v] of Object.entries(node.fields)) {
          newFields[k] = walk(v);
        }
        return { ...node, name: knotName, fields: newFields };
      }
      return { ...node };
    }
    if (node.type === "product" || node.type === "union") {
      const newFields = {};
      for (const [k, v] of Object.entries(node.fields || {})) {
        newFields[k] = walk(v);
      }
      return { ...node, fields: newFields };
    }
    if (node.type === "code") {
      return { ...node };
    }
    if (node.type === "pattern_apply") {
      const pos =
        node.start && node.end
          ? ` (lines ${node.start.line}:${node.start.column}...` +
            `${node.end.line}:${node.end.column})`
          : node.start
          ? ` (lines ${node.start.line}:${node.start.column})`
          : "";
      const suffix = node.pattern?.startsWith("@") ? "" : "[]";
      throw new Error(
        `Unknown pattern template '${node.pattern}${suffix}'${pos}`
      );
    }
    if (node.type === "name" || node.type === null) {
      return {
        type: "name",
        name: `__LEAF_${leafIdx++}__`,
        open: true
      };
    }
    return node;
  }
  return walk(filter);
}

function collectParamPaths(filter) {
  const map = {};
  function walk(node, path) {
    if (!node || typeof node !== "object") return;
    if (node.type === "name" && typeof node.name === "string") {
      const m = node.name.match(/^__PARAM_(\d+)__$/);
      if (m) {
        const idx = Number(m[1]);
        if (!map[idx]) map[idx] = [];
        map[idx].push(path);
      }
    }
    if (node.fields) {
      for (const k of Object.keys(node.fields).sort()) {
        walk(node.fields[k], [...path, k]);
      }
    }
  }
  walk(filter, []);
  return map;
}

function findVarAtPath(filter, path) {
  let curr = filter;
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (!curr?.fields?.[key]) return null;
    curr = curr.fields[key];
  }
  return curr?.name || (curr?.type === "name" ? curr.name : null);
}

function collectCanonicalVarPaths(canonicalFilter) {
  const paths = {};
  function walk(node, path) {
    if (!node || typeof node !== "object") return;
    const name =
      node.name || (node.type === "name" ? node.name : null);
    if (name && /^X\d+$/.test(name) && !paths[name]) {
      paths[name] = path;
    }
    if (node.fields) {
      for (const k of Object.keys(node.fields).sort()) {
        walk(node.fields[k], [...path, k]);
      }
    }
  }
  walk(canonicalFilter, []);
  return paths;
}

function toAstFilter(node, canonicalParams = []) {
  if (!node || typeof node !== "object") return node;
  const res = { ...node };
  if (res.type === null) {
    return {
      type: "name",
      name: res.name,
      open: true
    };
  }
  if (res.type === "name") {
    return {
      type: "name",
      name: res.name,
      ...(canonicalParams.includes(res.name)
        ? { open: true }
        : {})
    };
  }
  if (res.fields) {
    res.fields = {};
    for (const [k, v] of Object.entries(node.fields)) {
      res.fields[k] = toAstFilter(v, canonicalParams);
    }
  }
  return res;
}

export function resolvePatternCanonicalInfo(name, pat, options = {}) {
  if (!pat) return { hash: null, def: null, params: null };
  if (
    pat._canonical &&
    pat._canonicalDef &&
    pat._canonicalParams &&
    pat._aliasArgs
  ) {
    return {
      hash: pat._canonical,
      def: pat._canonicalDef,
      params: pat._canonicalParams,
      aliasArgs: pat._aliasArgs,
      canonicalParams: pat._graphParams || [],
      canonicalFilterAst: pat._canonicalFilterAst || null
    };
  }
  const isDirectCanonical =
    typeof name === "string" && name.startsWith("@");
  if (isDirectCanonical) {
    pat._canonical = name;
  }
  const formalParams = pat.params || [];
  const formalCount = formalParams.length;
  const allPatterns = { ...(options.patterns || {}) };
  if (options.libraries) {
    for (const lib of options.libraries) {
      const lp =
        lib.patterns ||
        lib.defs?.patterns ||
        lib.sourceDefs?.patterns ||
        {};
      Object.assign(allPatterns, lp);
    }
  }
  if (name && pat) allPatterns[name] = pat;

  let pathMap = {};
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
      pathMap = collectParamPaths(expanded);
    } catch {
      pathMap = {};
    }
  }

  if (!pat.filter) {
    return {
      hash: pat._canonical || null,
      def: null,
      params: formalParams
    };
  }

  const expandedFilter = expandFilter(pat.filter, allPatterns);

  const knots = collectFilterKnots(expandedFilter);
  const skeletonFilter = isDirectCanonical
    ? expandedFilter
    : skeletonizeFilter(expandedFilter, knots);
  const source = `? ${prettyFilter(skeletonFilter)}`;
  try {
    const annotated = annotate(source, {
      libraries: options.libraries || [],
      patterns: allPatterns
    });
    const mainRel = annotated.rels.__main__;
    let canonicalFilter = null;
    let graphParams = null;
    let codeHash = null;
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
        null
      );
      canonicalFilter = res.filter;
      graphParams = res.canonicalParams;

      const propList = patternToPropertyList(
        exportPatternGraph(mainRel.typePatternGraph, rootId)
      );
      codeHash = closedPatternToCodeHash(propList);
    }

    if (canonicalFilter) {
      pat._canonicalDef = prettyFilter(canonicalFilter);
    }

    const varPaths = collectCanonicalVarPaths(canonicalFilter);
    const tokens = (graphParams || []).map((cVar) => {
      const path = varPaths[cVar];
      return path ? findVarAtPath(expandedFilter, path) : null;
    });
    const tokenCounts = {};
    for (const t of tokens) {
      if (t) tokenCounts[t] = (tokenCounts[t] || 0) + 1;
    }
    const aliasArgs = tokens.map((t) => {
      if (!t) return "(...)";
      if (formalParams.includes(t)) return t;
      if (tokenCounts[t] > 1) return t;
      return "(...)";
    });

    const selectedParams = formalParams.map((_, i) => {
      const paths = pathMap[i] || [];
      for (const p of paths) {
        const v = findVarAtPath(canonicalFilter, p);
        if (v) return v;
      }
      return graphParams?.[i] || `X${i}`;
    });

    const relHash = annotated.relAlias?.__main__ || null;
    const finalHash =
      codeHash || relHash || pat._canonical || null;

    pat._canonical = finalHash;
    pat._canonicalParams =
      formalCount > 0 ? selectedParams : [];
    pat._graphParams = graphParams || [];
    pat._aliasArgs = aliasArgs;
    pat._canonicalFilterAst = toAstFilter(
      canonicalFilter,
      graphParams || []
    );

    return {
      hash: pat._canonical,
      def: pat._canonicalDef || null,
      params: pat._canonicalParams,
      aliasArgs: pat._aliasArgs,
      canonicalParams: pat._graphParams,
      canonicalFilterAst: pat._canonicalFilterAst
    };
  } catch (err) {
    if (isDirectCanonical) {
      return {
        hash: pat._canonical || null,
        def: pat._canonicalDef || null,
        params: pat._canonicalParams || null
      };
    }
    throw err;
  }
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
          lib.patterns?.[name]?._canonicalParams ||
          lib.patterns?.[hash]?.params ||
          [],
        aliasArgs:
          lib.patterns?.[name]?._aliasArgs ||
          lib.meta?.[hash]?.origins?.find((o) => o.name === name)
            ?.aliasArgs ||
          lib.patterns?.[name]?.params ||
          []
      };
    }
    for (const [name, pat] of Object.entries(lib.patterns || {})) {
      if (!patMap[name]) {
        patMap[name] = {
          hash: pat._canonical || lib.patternAlias?.[name] || name,
          params: pat.params || [],
          aliasArgs: pat._aliasArgs || pat.params || []
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
              params: origin.params || entry.params || [],
              aliasArgs:
                origin.aliasArgs ||
                entry.aliasArgs ||
                origin.params ||
                []
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
        const args = target.aliasArgs || target.params;
        const argStr =
          args && args.length > 0
            ? `[${args.join(", ")}]`
            : paramStr;
        lines.push(
          `${localName}${paramStr} = @${body}${argStr};`
        );
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
