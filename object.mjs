import { annotate } from "./index.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";
import { TypePatternGraph } from "./TypePatternGraph.mjs";
import { patterns2filters, prettyRel } from "./pretty.mjs";

const MAGIC = Buffer.from([0x4b, 0x4f, 0x42, 0x4a, 0x00, 0x01, 0x0a]);

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

function compileObject(script, options = {}) {
  const annotated = annotate(script, options);
  return {
    format: "k-object",
    version: 1,
    codes: codes.dump(),
    main: "__main__",
    defs: serializeAnnotated(annotated)
  };
}

function hydrateObject(object) {
  if (object?.format !== "k-object" || object.version !== 1) {
    throw new Error("Unsupported k object file");
  }
  codes.load(object.codes);
  return {
    ...object,
    defs: hydrateAnnotated(object.defs)
  };
}

function isHydratedObject(object) {
  return object?.defs?.rels?.[object.main]?.typePatternGraph instanceof TypePatternGraph;
}

function encodeObject(object) {
  const payload = Buffer.from(JSON.stringify(object), "utf8");
  if (payload.length > 0xffffffff) {
    throw new Error("k object payload is too large");
  }

  const header = Buffer.alloc(MAGIC.length + 4);
  MAGIC.copy(header, 0);
  header.writeUInt32BE(payload.length, MAGIC.length);
  return Buffer.concat([header, payload]);
}

function decodeObject(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("k object input must be a Buffer");
  }
  if (buffer.length < MAGIC.length + 4 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid k object file header");
  }

  const length = buffer.readUInt32BE(MAGIC.length);
  const payloadStart = MAGIC.length + 4;
  const payloadEnd = payloadStart + length;
  if (payloadEnd !== buffer.length) {
    throw new Error("Invalid k object file length");
  }

  return hydrateObject(JSON.parse(buffer.subarray(payloadStart, payloadEnd).toString("utf8")));
}

function compileObjectBuffer(script, options = {}) {
  return encodeObject(compileObject(script, options));
}

function runObject(object, value) {
  const hydrated = isHydratedObject(object) ? object : hydrateObject(object);
  run.defs = hydrated.defs;
  const mainRel = hydrated.defs.rels[hydrated.main];
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
  const relAliases = hydrated.defs.relAlias || {};
  const aliases = shortestUniqueAliases([
    ...Object.keys(hydrated.codes),
    ...Object.values(relAliases)
  ]);

  const codeDefs = Object.keys(hydrated.codes)
    .sort()
    .map((name) => `$ ${aliases[name]} = ${codeToSource(hydrated.codes[name], aliases)};`);
  const emittedRelAliases = new Set();
  const relDefForName = (name) => {
    const rel = hydrated.defs.rels[name];
    if (!rel) return null;
    const relName = relAliases[name] || name;
    if (emittedRelAliases.has(relName)) return null;
    emittedRelAliases.add(relName);
    return `${aliases[relName] || relName} = ${prettyRel(rewriteRefsInExp(rel.def, aliases, relAliases))};`;
  };
  const sccs = hydrated.defs.compileStats?.sccs || [];
  const relGroups = sccs.map(({ members }) =>
    members.map(relDefForName).filter((line) => line != null)
  ).filter((group) => group.length > 0);
  const missingRelGroup = Object.keys(hydrated.defs.rels)
    .filter((name) => !sccs.some(({ members }) => members.includes(name)))
    .map(relDefForName)
    .filter((line) => line != null);
  if (missingRelGroup.length > 0) relGroups.push(missingRelGroup);
  const relDefs = relGroups.flatMap((group, index) =>
    index === 0 ? group : ["", ...group]
  );
  const mainRel = relAliases[hydrated.main] || hydrated.main;
  const mainRelDef = hydrated.defs.rels[hydrated.main];
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

export {
  compileObject,
  compileObjectBuffer,
  encodeObject,
  decodeObject,
  hydrateObject,
  runObject,
  objectToFunction,
  decompileObject,
  decompileObjectBuffer
};

export default {
  compileObject,
  compileObjectBuffer,
  encodeObject,
  decodeObject,
  hydrateObject,
  runObject,
  objectToFunction,
  decompileObject,
  decompileObjectBuffer
};
