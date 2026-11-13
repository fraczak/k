// canonical-pattern.mjs
// Canonical representation, hash resolution, and export helpers.

import { annotate } from "./index.mjs";
import { TypePatternGraph } from "./TypePatternGraph.mjs";
import {
  patternGraphToCanonical,
  patterns2filters,
  prettyFilter
} from "./pretty.mjs";
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

export function instantiateCanonicalFilter(
  canonicalFilterAst,
  canonicalParams = [],
  aliasArgs = []
) {
  if (!canonicalFilterAst) return canonicalFilterAst;
  const paramMap = new Map();
  for (let i = 0; i < canonicalParams.length; i++) {
    paramMap.set(
      canonicalParams[i],
      aliasArgs[i] ?? canonicalParams[i]
    );
  }
  const usedArgNames = new Set(
    aliasArgs.filter((a) => a && a !== "(...)")
  );
  const knotNames = new Set();
  function collectKnots(node) {
    if (!node || typeof node !== "object") return;
    if (
      node.name &&
      node.type !== "name" &&
      !paramMap.has(node.name)
    ) {
      knotNames.add(node.name);
    }
    if (node.fields) {
      for (const child of Object.values(node.fields)) {
        collectKnots(child);
      }
    }
  }
  collectKnots(canonicalFilterAst);

  const knotRename = new Map();
  let nextIdx = 0;
  for (const k of knotNames) {
    if (usedArgNames.has(k)) {
      while (
        usedArgNames.has(`X${nextIdx}`) ||
        knotNames.has(`X${nextIdx}`)
      ) {
        nextIdx++;
      }
      knotRename.set(k, `X${nextIdx++}`);
    }
  }

  function walk(node) {
    if (!node || typeof node !== "object") return node;
    if (
      (node.type === "name" || node.type === null) &&
      paramMap.has(node.name)
    ) {
      const arg = paramMap.get(node.name);
      if (arg === "(...)") {
        return { type: null, open: true, fields: {} };
      }
      return { type: "name", name: arg, open: true };
    }
    if (
      (node.type === "name" || node.type === null) &&
      knotRename.has(node.name)
    ) {
      return { ...node, name: knotRename.get(node.name) };
    }
    const res = { ...node };
    if (res.name && knotRename.has(res.name)) {
      res.name = knotRename.get(res.name);
    }
    if (res.fields) {
      res.fields = {};
      for (const [k, v] of Object.entries(node.fields)) {
        res.fields[k] = walk(v);
      }
    }
    return res;
  }

  return walk(canonicalFilterAst);
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
  const allPatterns = {};
  if (options.libraries) {
    for (const lib of options.libraries) {
      const lp =
        lib.patterns ||
        lib.defs?.patterns ||
        lib.sourceDefs?.patterns ||
        {};
      for (const [patName, patDef] of Object.entries(lp)) {
        if (patName.startsWith("@") && !(patName in allPatterns)) {
          allPatterns[patName] = patDef;
        }
      }
    }
  }
  if (options.patterns) {
    Object.assign(allPatterns, options.patterns);
  }
  if (name && pat) allPatterns[name] = pat;

  let pathMap = {};
  if (formalCount > 0 && name) {
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

function buildMapsForLibrary(lib) {
  const relMap = {};
  const patMap = {};
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
  return { relMap, patMap };
}

function findMatchingLibrary(libPath, libraries) {
  if (!libPath || !libraries || libraries.length === 0) return null;
  const baseName = libPath.split("/").pop();
  for (const lib of libraries) {
    if (lib.source) {
      if (
        lib.source === libPath ||
        lib.source.endsWith("/" + libPath) ||
        lib.source.split("/").pop() === baseName
      ) {
        return lib;
      }
    }
    if (lib.meta) {
      for (const entry of Object.values(lib.meta)) {
        for (const origin of entry?.origins || []) {
          if (
            origin.source &&
            (origin.source === libPath ||
              origin.source.split("/").pop() === baseName)
          ) {
            return lib;
          }
        }
      }
    }
  }
  return null;
}

function matchesSource(actualSource, requestedSource) {
  if (!actualSource || !requestedSource) return false;
  if (actualSource === requestedSource) return true;
  const reqBase = requestedSource.split("/").pop();
  const actBase = actualSource.split("/").pop();
  return reqBase === actBase;
}

function findFromMeta(libPath, name, type, libraries) {
  for (const lib of libraries) {
    if (!lib.meta) continue;
    for (const [hash, entry] of Object.entries(lib.meta)) {
      if (entry?.type !== type && entry?.type !== "any") continue;
      for (const origin of entry?.origins || []) {
        if (origin?.name === name && (origin.type == null || origin.type === type)) {
          if (!libPath || matchesSource(origin.source, libPath)) {
            return {
              hash,
              params: origin.params || entry.params || [],
              aliasArgs:
                origin.aliasArgs ||
                entry.aliasArgs ||
                origin.params ||
                entry.params ||
                []
            };
          }
        }
      }
    }
  }
  return null;
}

export function buildUsePreamble(exports = [], libraries = []) {
  if (exports.length === 0) return "";
  const globalRelMap = {};
  const globalPatMap = {};
  const libMap = new Map();

  for (const lib of libraries) {
    const maps = buildMapsForLibrary(lib);
    libMap.set(lib, maps);
    Object.assign(globalRelMap, maps.relMap);
    Object.assign(globalPatMap, maps.patMap);
  }

  const flatItems = [];
  for (const entry of exports) {
    if (!entry) continue;
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      for (const spec of trimmed.split(/[\s,]+/).filter(Boolean)) {
        flatItems.push({ lib: null, spec });
      }
    } else if (typeof entry === "object" && entry.use) {
      const trimmed = entry.use.trim();
      if (!trimmed) continue;
      for (const spec of trimmed.split(/[\s,]+/).filter(Boolean)) {
        flatItems.push({ lib: entry.lib || null, spec });
      }
    }
  }

  const lines = [];
  const seenRel = new Set();
  const seenPat = new Set();
  for (const item of flatItems) {
    const spec = item.spec;
    const [rawLib, rawLocal] = spec.includes(":")
      ? spec.split(":", 2)
      : [spec, spec];
    const isExplicitPattern =
      rawLib.includes("[") || rawLocal.includes("[");
    const libName = rawLib.replace(/\[.*\]$/, "").trim();
    const localName = rawLocal.replace(/\[.*\]$/, "").trim();

    let relTarget = null;
    let patTarget = null;

    if (!isExplicitPattern) {
      if (item.lib) {
        relTarget = findFromMeta(item.lib, libName, "rel", libraries);
      }
      if (!relTarget) {
        const matchedLib = item.lib ? findMatchingLibrary(item.lib, libraries) : null;
        if (matchedLib && libMap.get(matchedLib)?.relMap[libName]) {
          relTarget = libMap.get(matchedLib).relMap[libName];
        } else if (globalRelMap[libName]) {
          relTarget = globalRelMap[libName];
        }
      }
    }

    if (item.lib) {
      patTarget = findFromMeta(item.lib, libName, "pattern", libraries);
    }
    if (!patTarget) {
      const matchedLib = item.lib ? findMatchingLibrary(item.lib, libraries) : null;
      if (matchedLib && libMap.get(matchedLib)?.patMap[libName]) {
        patTarget = libMap.get(matchedLib).patMap[libName];
      } else if (globalPatMap[libName]) {
        patTarget = globalPatMap[libName];
      }
    }

    let emitted = false;
    if (!isExplicitPattern && relTarget) {
      const body = relTarget.hash.startsWith("@")
        ? relTarget.hash.slice(1)
        : relTarget.hash;
      if (!seenRel.has(localName)) {
        lines.push(`${localName} = @${body};`);
        seenRel.add(localName);
      }
      emitted = true;
    }
    if (patTarget) {
      if (isExplicitPattern || !emitted || relTarget) {
        const body = patTarget.hash.startsWith("@")
          ? patTarget.hash.slice(1)
          : patTarget.hash;
        const paramStr =
          patTarget.params && patTarget.params.length > 0
            ? `[${patTarget.params.join(", ")}]`
            : "[]";
        const args = patTarget.aliasArgs || patTarget.params;
        const argStr =
          args && args.length > 0
            ? `[${args.join(", ")}]`
            : paramStr;
        if (!seenPat.has(localName)) {
          lines.push(
            `${localName}${paramStr} = @${body}${argStr};`
          );
          seenPat.add(localName);
        }
        emitted = true;
      }
    }
    if (!emitted) {
      throw new Error(
        `--use: '${rawLib}' not found in loaded libraries`
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

const DEFAULT_MAX_PAT_LENGTH = 45;

export function canonicalBoundaryFilterSources(
  typePatternGraph,
  patternIds,
  options = {}
) {
  const maxPatLength = options.maxPatLength ?? DEFAULT_MAX_PAT_LENGTH;
  const leafOccurrences = [];

  function buildSingleRootFilter(rawRootId) {
    const filterKnots = [];
    const subGraph = new TypePatternGraph(
      typePatternGraph.registerCodeDef,
      typePatternGraph.findCode
    );
    const renamed = typePatternGraph.clone([rawRootId], subGraph);
    const rootId = subGraph.find(renamed[rawRootId]);

    const origByNew = new Map();
    for (const [origId, newId] of Object.entries(renamed)) {
      origByNew.set(
        subGraph.find(Number(newId)),
        typePatternGraph.find(Number(origId))
      );
    }

    const inDegree = subGraph.patterns.nodes.map(() => 0);
    inDegree[rootId]++;
    subGraph.edges.forEach((outEdges) =>
      Object.values(outEdges).forEach((destMap) =>
        Object.values(destMap).forEach((dst) => inDegree[dst]++)
      )
    );

    function hasOpenDescendant(startId, seen = new Set()) {
      if (seen.has(startId)) return false;
      seen.add(startId);
      const p = subGraph.get_pattern(startId);
      if (
        p.pattern === "(...)" ||
        p.pattern === "{...}" ||
        p.pattern === "<...>"
      ) {
        return true;
      }
      const edges = subGraph.edges[startId] || {};
      for (const key of Object.keys(edges)) {
        const dst = Object.values(edges[key])[0];
        if (hasOpenDescendant(dst, seen)) return true;
      }
      return false;
    }

    const dagKnots = new Map();
    let nextKnot = 0;

    function build(patternId, ancestorKnots) {
      const pattern = subGraph.get_pattern(patternId);
      if (pattern.pattern === "(...)") {
        const origId = origByNew.get(patternId) ?? patternId;
        const node = { type: null, open: true, fields: {} };
        leafOccurrences.push({ origId, node });
        return node;
      }

      if (ancestorKnots.has(patternId)) {
        const knot = ancestorKnots.get(patternId);
        knot.used = true;
        const refNode = { type: "name", name: knot.name };
        knot.refs.push(refNode);
        return refNode;
      }

      const isOpenStruct =
        pattern.pattern === "{...}" || pattern.pattern === "<...>";
      const shareAcrossDag =
        isOpenStruct || !hasOpenDescendant(patternId);

      if (
        shareAcrossDag &&
        inDegree[patternId] > 1 &&
        dagKnots.has(patternId)
      ) {
        const knot = dagKnots.get(patternId);
        knot.used = true;
        const refNode = { type: "name", name: knot.name };
        knot.refs.push(refNode);
        return refNode;
      }

      const knotEntry = {
        name: `K${nextKnot++}`,
        used: false,
        target: null,
        refs: []
      };
      filterKnots.push(knotEntry);
      const nextAncestors = new Map(ancestorKnots);
      nextAncestors.set(patternId, knotEntry);
      if (shareAcrossDag && inDegree[patternId] > 1) {
        dagKnots.set(patternId, knotEntry);
      }

      const edges = subGraph.edges[patternId] || {};
      const fields = () =>
        Object.keys(edges)
          .sort()
          .reduce((acc, key) => {
            acc[key] = build(
              Object.values(edges[key])[0],
              nextAncestors
            );
            return acc;
          }, {});

      let res;
      switch (pattern.pattern) {
        case "type": {
          const code = subGraph.findCode(pattern.type);
          if (code?.code === "product") {
            res = { type: "product", fields: fields() };
          } else if (code?.code === "union") {
            res = { type: "union", fields: fields() };
          } else {
            res = { type: "code", code: pattern.type };
          }
          break;
        }
        case "{...}":
          res = { type: "product", open: true, fields: fields() };
          break;
        case "<...>":
          res = { type: "union", open: true, fields: fields() };
          break;
        case "{}":
          res = { type: "product", fields: fields() };
          break;
        case "<>":
          res = { type: "union", fields: fields() };
          break;
      }
      knotEntry.target = res;
      if (knotEntry.used) {
        res.name = knotEntry.name;
      }
      return res;
    }

    const built = build(rootId, new Map());
    for (const knot of dagKnots.values()) {
      if (knot.used && knot.target) {
        knot.target.name = knot.name;
      }
    }
    return { filter: built, filterKnots };
  }

  const builtFilters = patternIds.map((id) => buildSingleRootFilter(id));
  const filters = builtFilters.map((b) => b.filter);

  const origCounts = new Map();
  for (const { origId } of leafOccurrences) {
    origCounts.set(origId, (origCounts.get(origId) || 0) + 1);
  }
  const sharedVarByOrig = new Map();
  let nextVar = 0;
  for (const { origId, node } of leafOccurrences) {
    if ((origCounts.get(origId) || 0) > 1) {
      if (!sharedVarByOrig.has(origId)) {
        sharedVarByOrig.set(origId, `X${nextVar++}`);
      }
      node.type = "name";
      node.name = sharedVarByOrig.get(origId);
      delete node.fields;
    }
  }
  const sharedVars = [...sharedVarByOrig.values()];

  for (const { filterKnots } of builtFilters) {
    let knotVar = sharedVars.length;
    for (const knot of filterKnots) {
      if (knot.used && knot.target) {
        const knotName = `X${knotVar++}`;
        knot.name = knotName;
        knot.target.name = knotName;
        for (const refNode of knot.refs) {
          refNode.name = knotName;
        }
      }
    }
  }

  const useCanonicalNames = filters.some(
    (filter) => prettyFilter(filter).length > maxPatLength
  );

  const resolvedByInline = new Map();
  const canonicalSources = filters.map((filter) => {
    const inlineStr = prettyFilter(filter);
    const isBareWildcard =
      (filter.type === null &&
        filter.open &&
        Object.keys(filter.fields || {}).length === 0 &&
        !filter.name) ||
      (filter.type === "name" && filter.open);
    if (isBareWildcard) {
      return `?${inlineStr}`;
    }
    if (!useCanonicalNames && !options.registerPatterns) {
      return `?${inlineStr}`;
    }
    let info = resolvedByInline.get(inlineStr);
    if (!info) {
      info = resolvePatternCanonicalInfo(
        null,
        { params: sharedVars, filter },
        options
      );
      resolvedByInline.set(inlineStr, info);
    }
    if (
      info.hash &&
      options.registerPatterns &&
      !options.registerPatterns[info.hash]
    ) {
      options.registerPatterns[info.hash] = {
        params: info.canonicalParams || info.params || [],
        filter: info.canonicalFilterAst || filter,
        _canonical: info.hash,
        _canonicalDef: info.def,
        _canonicalParams: info.canonicalParams,
        _graphParams: info.canonicalParams,
        _aliasArgs: info.canonicalParams || [],
        _canonicalFilterAst: info.canonicalFilterAst
      };
    }
    const args = (info.aliasArgs || []).join(", ");
    return `?${info.hash}[${args}]`;
  });

  if (!useCanonicalNames) {
    return patterns2filters(typePatternGraph, ...patternIds).map(
      (f) => `?${prettyFilter(f)}`
    );
  }
  return canonicalSources;
}

export default {
  resolvePatternCanonicalInfo,
  canonicalPatternHash,
  buildUsePreamble,
  canonicalBoundaryFilterSources,
  instantiateCanonicalFilter
};
