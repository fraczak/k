import { annotate } from "./index.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";
import { TypePatternGraph } from "./TypePatternGraph.mjs";
import { patterns2filters, prettyRel } from "./pretty.mjs";

const MAGIC = Buffer.from([0x4b, 0x4f, 0x42, 0x4a, 0x00, 0x01, 0x0a]);
const LIB_MAGIC = Buffer.from([0x4b, 0x4c, 0x49, 0x42, 0x00, 0x01, 0x0a]);

function serializeTypePatternGraph(typePatternGraph) {
  return {
    patterns: {
      nodes: typePatternGraph.patterns.nodes,
      parent: typePatternGraph.patterns.parent.map((parent) => parent ?? null)
    },
    edges: typePatternGraph.edges,
    codeId: typePatternGraph.codeId
  };
}

function hydrateTypePatternGraph(serialized) {
  const graph = new TypePatternGraph(codes.register, codes.find);
  graph.patterns.nodes = serialized.patterns.nodes;
  graph.patterns.parent = serialized.patterns.parent.map((parent) => parent ?? undefined);
  graph.edges = serialized.edges;
  graph.codeId = serialized.codeId;
  return graph;
}

function serializeRelation(rel) {
  return {
    ...rel,
    typePatternGraph: serializeTypePatternGraph(rel.typePatternGraph)
  };
}

function hydrateRelation(rel) {
  return {
    ...rel,
    typePatternGraph: hydrateTypePatternGraph(rel.typePatternGraph)
  };
}

function serializeAnnotated(annotated) {
  return {
    rels: Object.fromEntries(
      Object.entries(annotated.rels).map(([name, rel]) => [name, serializeRelation(rel)])
    ),
    representatives: annotated.representatives,
    relAlias: annotated.relAlias,
    compileStats: annotated.compileStats
  };
}

function hydrateAnnotated(serialized) {
  return {
    ...serialized,
    rels: Object.fromEntries(
      Object.entries(serialized.rels).map(([name, rel]) => [name, hydrateRelation(rel)])
    )
  };
}

const NAME_RE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function isSourceName(name) {
  return NAME_RE.test(name) && !name.startsWith("@") && !name.startsWith(":");
}

function addOrigin(meta, hash, type, origin) {
  if (!hash) return;
  if (!meta[hash]) {
    meta[hash] = { type, origins: [] };
  } else if (meta[hash].type == null) {
    meta[hash].type = type;
  } else if (meta[hash].type !== type) {
    throw new Error(`Metadata type conflict for ${hash}: ${meta[hash].type} vs ${type}`);
  }
  if (meta[hash].origins.some((existing) =>
    existing.source === origin.source &&
    existing.name === origin.name &&
    existing.compiledAt === origin.compiledAt
  )) {
    return;
  }
  meta[hash].origins.push(origin);
}

function mergeMetaEntries(...metas) {
  const merged = {};
  for (const meta of metas) {
    for (const [hash, entry] of Object.entries(meta || {})) {
      const type = entry?.type;
      if (type !== "code" && type !== "rel") continue;
      for (const origin of entry.origins || []) {
        if (!origin?.name) continue;
        addOrigin(merged, hash, type, {
          ...(origin.source == null ? {} : { source: origin.source }),
          name: origin.name,
          ...(origin.compiledAt == null ? {} : { compiledAt: origin.compiledAt })
        });
      }
    }
  }
  return merged;
}

function buildMeta(annotated, source) {
  const meta = {};
  const representatives = annotated.representatives || {};
  const relAlias = annotated.relAlias || {};
  const now = new Date().toISOString();

  for (const [name, hash] of Object.entries(representatives)) {
    if (!isSourceName(name)) continue;
    addOrigin(meta, hash, "code", { source, name, compiledAt: now });
  }

  for (const [name, hash] of Object.entries(relAlias)) {
    if (name === "__main__") continue;
    if (!isSourceName(name)) continue;
    addOrigin(meta, hash, "rel", { source, name, compiledAt: now });
  }
  return meta;
}

function importedLibraryMeta(libraries = []) {
  return mergeMetaEntries(...libraries.map((library) => library.meta || {}));
}

function isEofParseError(error) {
  return error?.hash?.token === "EOF" || /got 'EOF'|Expecting/.test(error?.message || "");
}

function annotateLibrary(script, options = {}) {
  try {
    return annotate(script, options);
  } catch (error) {
    if (!isEofParseError(error)) throw error;
    return annotate(`${script}\n()`, options);
  }
}

function collectReachable(mainName, rels, allCodes) {
  const reachableRels = new Set();
  const reachableCodes = new Set();

  function walkExp(exp) {
    if (!exp) return;
    switch (exp.op) {
      case "ref":
        if (exp.ref in rels && !reachableRels.has(exp.ref)) {
          reachableRels.add(exp.ref);
          walkExp(rels[exp.ref].def);
        }
        break;
      case "code":
        walkCode(exp.code);
        break;
      case "filter":
        walkFilter(exp.filter);
        break;
      case "comp":
        exp.comp.forEach(walkExp);
        break;
      case "union":
        exp.union.forEach(walkExp);
        break;
      case "product":
        exp.product.forEach(({ exp: e }) => walkExp(e));
        break;
    }
  }

  function walkFilter(filter) {
    if (!filter) return;
    if (filter.type === "code") walkCode(filter.code);
    if (filter.fields) Object.values(filter.fields).forEach(walkFilter);
  }

  function walkCode(hash) {
    if (!hash || reachableCodes.has(hash)) return;
    if (!(hash in allCodes)) return;
    reachableCodes.add(hash);
    const code = allCodes[hash];
    const fields = code[code.code];
    if (fields) Object.values(fields).forEach(walkCode);
  }

  // Walk from main
  reachableRels.add(mainName);
  walkExp(rels[mainName].def);

  // Also collect codes referenced in typePatternGraphs of reachable rels
  for (const relName of reachableRels) {
    const rel = rels[relName];
    if (rel.typePatternGraph) {
      const codeId = rel.typePatternGraph.codeId || (rel.typePatternGraph.codeId);
      if (codeId) Object.values(codeId).forEach(walkCode);
    }
  }

  return { reachableRels, reachableCodes };
}

function compileObject(script, options = {}) {
  const annotated = annotate(script, options);
  const allCodes = codes.dump();
  const serialized = serializeAnnotated(annotated);
  const meta = mergeMetaEntries(
    importedLibraryMeta(options.libraries),
    buildMeta(annotated, options.source || null)
  );

  // Prune to reachable from main
  const { reachableRels, reachableCodes } = collectReachable("__main__", serialized.rels, allCodes);
  const prunedCodes = Object.fromEntries(
    Object.entries(allCodes).filter(([h]) => reachableCodes.has(h))
  );
  const prunedRels = Object.fromEntries(
    Object.entries(serialized.rels).filter(([name]) => reachableRels.has(name))
  );
  const prunedMeta = Object.fromEntries(
    Object.entries(meta).filter(([h]) => reachableRels.has(h) || reachableCodes.has(h))
  );

  return {
    format: "k-object",
    version: 2,
    codes: prunedCodes,
    rels: prunedRels,
    relAlias: serialized.relAlias,
    compileStats: serialized.compileStats,
    meta: prunedMeta,
    main: "__main__"
  };
}

function rewriteRefsToCanonical(exp, relAlias) {
  if (!exp) return exp;
  const rewritten = { ...exp };
  switch (exp.op) {
    case "ref":
      if (relAlias[exp.ref]) rewritten.ref = relAlias[exp.ref];
      break;
    case "comp":
      rewritten.comp = exp.comp.map(e => rewriteRefsToCanonical(e, relAlias));
      break;
    case "union":
      rewritten.union = exp.union.map(e => rewriteRefsToCanonical(e, relAlias));
      break;
    case "product":
      rewritten.product = exp.product.map(({ label, exp: e }) => ({
        label, exp: rewriteRefsToCanonical(e, relAlias)
      }));
      break;
  }
  return rewritten;
}

function compileLibrary(script, options = {}) {
  const annotated = annotateLibrary(script, options);
  const serialized = serializeAnnotated(annotated);
  const meta = mergeMetaEntries(
    importedLibraryMeta(options.libraries),
    buildMeta(annotated, options.source || null)
  );
  const relAlias = serialized.relAlias || {};

  // Key rels by canonical hash, rewrite internal refs to canonical hashes
  const libRels = {};
  for (const [name, rel] of Object.entries(serialized.rels)) {
    if (name === "__main__") continue;
    const canonicalName = relAlias[name] || name;
    const { varRefs, ...relWithoutVarRefs } = rel;
    libRels[canonicalName] = {
      ...relWithoutVarRefs,
      def: rewriteRefsToCanonical(rel.def, relAlias)
    };
  }

  return {
    format: "k-object",
    version: 2,
    codes: codes.dump(),
    rels: libRels,
    relAlias: serialized.relAlias,
    compileStats: serialized.compileStats,
    meta,
    main: null
  };
}

function hydrateObject(object) {
  if (object?.format !== "k-object") {
    throw new Error("Unsupported k object file");
  }
  // v1 compat: defs wrapper
  if (object.version === 1) {
    codes.load(object.codes);
    return {
      ...object,
      defs: hydrateAnnotated(object.defs)
    };
  }
  // v2: flat rels
  codes.load(object.codes);
  const hydratedRels = Object.fromEntries(
    Object.entries(object.rels).map(([name, rel]) => [name, hydrateRelation(rel)])
  );
  return { ...object, rels: hydratedRels };
}

function loadLibrary(object) {
  const hydrated = isHydratedObject(object) ? object : hydrateObject(object);
  if (hydrated.main != null) {
    throw new Error("Expected a library (main: null), got an executable");
  }
  return hydrated;
}

function isHydratedObject(object) {
  // v2 format
  if (object?.rels) {
    const firstRel = Object.values(object.rels)[0];
    return firstRel?.typePatternGraph instanceof TypePatternGraph;
  }
  // v1 format
  return object?.defs?.rels?.[object.main]?.typePatternGraph instanceof TypePatternGraph;
}

function encodeObject(object) {
  const magic = object.main == null ? LIB_MAGIC : MAGIC;
  const payload = Buffer.from(JSON.stringify(object), "utf8");
  if (payload.length > 0xffffffff) {
    throw new Error("k object payload is too large");
  }

  const header = Buffer.alloc(magic.length + 4);
  magic.copy(header, 0);
  header.writeUInt32BE(payload.length, magic.length);
  return Buffer.concat([header, payload]);
}

function decodeObject(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("k object input must be a Buffer");
  }
  const isObj = buffer.length >= MAGIC.length && buffer.subarray(0, MAGIC.length).equals(MAGIC);
  const isLib = buffer.length >= LIB_MAGIC.length && buffer.subarray(0, LIB_MAGIC.length).equals(LIB_MAGIC);
  if (!isObj && !isLib) {
    throw new Error("Invalid k object file header");
  }

  const magic = isLib ? LIB_MAGIC : MAGIC;
  const length = buffer.readUInt32BE(magic.length);
  const payloadStart = magic.length + 4;
  const payloadEnd = payloadStart + length;
  if (payloadEnd !== buffer.length) {
    throw new Error("Invalid k object file length");
  }

  return hydrateObject(JSON.parse(buffer.subarray(payloadStart, payloadEnd).toString("utf8")));
}

function encodeLibrary(object) {
  return encodeObject(object);
}

function decodeLibrary(buffer) {
  const object = decodeObject(buffer);
  if (object.main != null) {
    throw new Error("Expected a library (main: null), got an executable");
  }
  return object;
}

function compileObjectBuffer(script, options = {}) {
  return encodeObject(compileObject(script, options));
}

function compileLibraryBuffer(script, options = {}) {
  return encodeObject(compileLibrary(script, options));
}

function getRels(hydrated) {
  // v2: flat rels; v1: defs.rels
  return hydrated.rels || hydrated.defs?.rels;
}

function runObject(object, value) {
  const hydrated = isHydratedObject(object) ? object : hydrateObject(object);
  const rels = getRels(hydrated);
  run.defs = hydrated.defs || { rels };
  const mainRel = rels[hydrated.main];
  return run(codes.find, mainRel.def, value, mainRel.typePatternGraph);
}

function objectToFunction(object) {
  const hydrated = isHydratedObject(object) ? object : hydrateObject(object);
  return (value) => runObject(hydrated, value);
}

function hashAlias(hash) {
  return hash.startsWith("@") ? hash.slice(1) : hash;
}

function shortestUniqueAliases(hashes, minimumLength = 4) {
  const sorted = [...new Set(hashes)].sort();
  const aliases = {};

  for (const hash of sorted) {
    const base = hashAlias(hash);
    let length = Math.min(minimumLength, base.length);
    while (
      sorted.some((other) =>
        other !== hash && hashAlias(other).startsWith(base.slice(0, length))
      )
    ) {
      length += 1;
      if (length > base.length) {
        throw new Error(`Cannot derive unique prefix alias for ${hash}`);
      }
    }
    aliases[hash] = base.slice(0, length);
  }

  return aliases;
}

function rewriteCodesInFilter(filter, aliases) {
  const rewritten = { ...filter };
  if (rewritten.type === "code" && aliases[rewritten.code]) {
    rewritten.code = aliases[rewritten.code];
  }
  if (rewritten.fields) {
    rewritten.fields = Object.fromEntries(
      Object.entries(rewritten.fields).map(([label, child]) => [label, rewriteCodesInFilter(child, aliases)])
    );
  }
  return rewritten;
}

function rewriteRefsInExp(exp, aliases, relAliases) {
  const rewritten = { ...exp };
  switch (rewritten.op) {
    case "filter":
      rewritten.filter = rewriteCodesInFilter(rewritten.filter, aliases);
      break;
    case "code":
      if (aliases[rewritten.code]) rewritten.code = aliases[rewritten.code];
      break;
    case "ref":
      if (relAliases[rewritten.ref]) rewritten.ref = aliases[relAliases[rewritten.ref]] || relAliases[rewritten.ref];
      else if (aliases[rewritten.ref]) rewritten.ref = aliases[rewritten.ref];
      break;
    case "comp":
      rewritten.comp = rewritten.comp.map((child) => rewriteRefsInExp(child, aliases, relAliases));
      break;
    case "union":
      rewritten.union = rewritten.union.map((child) => rewriteRefsInExp(child, aliases, relAliases));
      break;
    case "product":
      rewritten.product = rewritten.product.map(({ label, exp: child }) => ({
        label,
        exp: rewriteRefsInExp(child, aliases, relAliases)
      }));
      break;
  }
  return rewritten;
}

function codeToSource(code, aliases) {
  const fields = code[code.code];
  const body = Object.keys(fields)
    .sort()
    .map((label) => {
      return `${aliases[fields[label]] || fields[label]} ${JSON.stringify(label)}`;
    })
    .join(", ");
  return code.code === "product" ? `{${body}}` : `< ${body} >`;
}

function boundaryFilterSource(typePatternGraph, patternId, aliases) {
  const [filter] = patterns2filters(typePatternGraph, patternId);
  return prettyRel({ op: "filter", filter: rewriteCodesInFilter(filter, aliases) });
}

function decompileObject(object) {
  const hydrated = isHydratedObject(object) ? object : hydrateObject(object);
  const rels = getRels(hydrated);
  const relAliases = hydrated.defs?.relAlias || hydrated.relAlias || {};
  const aliases = shortestUniqueAliases([
    ...Object.keys(hydrated.codes),
    ...Object.values(relAliases)
  ]);

  const codeDefs = Object.keys(hydrated.codes)
    .sort()
    .map((name) => `$ ${aliases[name]} = ${codeToSource(hydrated.codes[name], aliases)};`);
  const emittedRelAliases = new Set();
  const relDefForName = (name) => {
    const rel = rels[name];
    if (!rel) return null;
    const relName = relAliases[name] || name;
    if (emittedRelAliases.has(relName)) return null;
    emittedRelAliases.add(relName);
    return `${aliases[relName] || relName} = ${prettyRel(rewriteRefsInExp(rel.def, aliases, relAliases))};`;
  };
  const compileStats = hydrated.defs?.compileStats || hydrated.compileStats;
  const sccs = compileStats?.sccs || [];
  const relGroups = sccs.map(({ members }) =>
    members.map(relDefForName).filter((line) => line != null)
  ).filter((group) => group.length > 0);
  const missingRelGroup = Object.keys(rels)
    .filter((name) => !sccs.some(({ members }) => members.includes(name)))
    .map(relDefForName)
    .filter((line) => line != null);
  if (missingRelGroup.length > 0) relGroups.push(missingRelGroup);
  const relDefs = relGroups.flatMap((group, index) =>
    index === 0 ? group : ["", ...group]
  );

  if (hydrated.main == null) {
    // Library: no main section
    return [
      "----- codes -----",
      ...codeDefs,
      "----- rels -----",
      ...relDefs,
      ""
    ].join("\n");
  }

  const mainRel = relAliases[hydrated.main] || hydrated.main;
  const mainRelDef = rels[hydrated.main];
  const main = [
    boundaryFilterSource(mainRelDef.typePatternGraph, mainRelDef.def.patterns[0], aliases),
    aliases[mainRel] || mainRel,
    boundaryFilterSource(mainRelDef.typePatternGraph, mainRelDef.def.patterns[1], aliases)
  ].join(" ");

  return [
    "----- codes -----",
    ...codeDefs,
    "----- rels -----",
    ...relDefs,
    "----- main -----",
    main,
    ""
  ].join("\n");
}

function decompileObjectBuffer(buffer) {
  return decompileObject(decodeObject(buffer));
}

function hashBody(hash) {
  return hash.startsWith("@") ? hash.slice(1) : hash;
}

function compareAliasEntries(left, right) {
  return (
    left.typeOrder - right.typeOrder ||
    left.name.localeCompare(right.name) ||
    compareMaybeTimestamp(left.compiledAt, right.compiledAt) ||
    left.hash.localeCompare(right.hash) ||
    left.source.localeCompare(right.source)
  );
}

function compareMaybeTimestamp(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.localeCompare(right);
}

function originComment(origin) {
  return JSON.stringify({
    ...(origin.source == null ? {} : { source: origin.source }),
    ...(origin.compiledAt == null ? {} : { compiledAt: origin.compiledAt })
  });
}

function extractAliasesFromObject(object) {
  const hydrated = isHydratedObject(object) ? object : hydrateObject(object);
  const entries = [];

  for (const [hash, entry] of Object.entries(hydrated.meta || {})) {
    const type = entry?.type;
    if (type !== "code" && type !== "rel") continue;
    const typeOrder = type === "code" ? 0 : 1;
    for (const origin of entry.origins || []) {
      if (!origin?.name || !isSourceName(origin.name)) continue;
      entries.push({
        type,
        typeOrder,
        hash,
        name: origin.name,
        source: origin.source || "",
        compiledAt: origin.compiledAt,
        comment: originComment(origin)
      });
    }
  }

  entries.sort(compareAliasEntries);

  const activeEntries = new Set();
  for (let i = 0; i < entries.length; i++) {
    const next = entries[i + 1];
    if (!next || next.type !== entries[i].type || next.name !== entries[i].name) {
      activeEntries.add(entries[i]);
    }
  }

  const lines = [];
  let lastType = null;
  for (const entry of entries) {
    if (lastType != null && lastType !== entry.type) lines.push("");
    lastType = entry.type;
    const prefix = entry.type === "code" ? "$ " : "";
    const line = `${prefix}${entry.name} = @${hashBody(entry.hash)}; # ${entry.comment}`;
    lines.push(activeEntries.has(entry) ? line : `# ${line}`);
  }

  return `${lines.join("\n")}${lines.length === 0 ? "" : "\n"}`;
}

function extractAliasesFromObjectBuffer(buffer) {
  return extractAliasesFromObject(decodeObject(buffer));
}

export {
  compileObject,
  compileObjectBuffer,
  compileLibrary,
  compileLibraryBuffer,
  encodeObject,
  encodeLibrary,
  decodeObject,
  decodeLibrary,
  hydrateObject,
  loadLibrary,
  runObject,
  objectToFunction,
  decompileObject,
  decompileObjectBuffer,
  extractAliasesFromObject,
  extractAliasesFromObjectBuffer
};

export default {
  compileObject,
  compileObjectBuffer,
  compileLibrary,
  compileLibraryBuffer,
  encodeObject,
  encodeLibrary,
  decodeObject,
  decodeLibrary,
  hydrateObject,
  loadLibrary,
  runObject,
  objectToFunction,
  decompileObject,
  decompileObjectBuffer,
  extractAliasesFromObject,
  extractAliasesFromObjectBuffer
};
