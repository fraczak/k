#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { argv, exit, stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { compileObject, decodeObject, hydrateObject } from "./object.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { propertyListToFilter } from "./codecs/runtime/show-value.mjs";
import { TypePatternGraph } from "./TypePatternGraph.mjs";

const KIR_FORMAT = "k-ir";
const KIR_VERSION = 1;

const PATTERN_KIND = {
  "(...)": "any",
  "{...}": "open-product",
  "{}": "closed-product",
  "<...>": "open-union",
  "<>": "closed-union",
  "type": "type"
};

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableObject(child)])
  );
}

function clone(value) {
  return value == null ? value : stableObject(value);
}

function sourcePatternGraph(graph) {
  if (!graph?.patterns?.nodes || !Array.isArray(graph.patterns.nodes)) {
    throw new Error("KIR-P relation is missing a type-pattern graph");
  }
  return graph;
}

function findPattern(graph, id) {
  if (typeof graph.find === "function") return graph.find(id);
  const parents = graph.patterns?.parent || [];
  let current = id;
  const seen = new Set();
  while (parents[current] != null) {
    if (seen.has(current)) {
      throw new Error(`KIR-P pattern graph has a parent cycle at node ${id}`);
    }
    seen.add(current);
    current = parents[current];
  }
  return current;
}

function relationPatternIds(rel) {
  const ids = new Set();

  function addPatternIds(exp) {
    for (const id of exp?.patterns || []) ids.add(id);
    switch (exp?.op) {
      case "comp":
        exp.comp.forEach(addPatternIds);
        break;
      case "union":
        exp.union.forEach(addPatternIds);
        break;
      case "product":
        exp.product.forEach(({ exp: child }) => addPatternIds(child));
        break;
    }
  }

  addPatternIds(rel.def);
  return ids;
}

function normalizedPatternGraph(typePatternGraph, rootIds = []) {
  const graph = sourcePatternGraph(typePatternGraph);
  const representatives = new Set();
  const queue = [];

  const add = (id) => {
    if (id == null) return;
    const rep = findPattern(graph, id);
    if (representatives.has(rep)) return;
    representatives.add(rep);
    queue.push(rep);
  };

  for (const id of rootIds) add(id);
  for (let id = 0; id < graph.patterns.nodes.length; id++) {
    if (findPattern(graph, id) === id) add(id);
  }

  for (let index = 0; index < queue.length; index++) {
    const sourceId = queue[index];
    for (const dests of Object.values(graph.edges?.[sourceId] || {})) {
      for (const dest of dests || []) add(dest);
    }
  }

  const orderedSourceIds = [...representatives].sort((a, b) => a - b);
  const sourceToKirId = new Map(orderedSourceIds.map((id, index) => [id, index]));
  const mapPatternId = (id) => sourceToKirId.get(findPattern(graph, id));

  const nodes = orderedSourceIds.map((sourceId) => {
    const pattern = graph.patterns.nodes[sourceId];
    const kind = PATTERN_KIND[pattern?.pattern];
    if (!kind) throw new Error(`Unsupported KIR-P pattern kind: ${pattern?.pattern}`);

    const node = {
      id: sourceToKirId.get(sourceId),
      kind
    };
    if (kind === "type") node.code = pattern.type;

    const edges = Object.entries(graph.edges?.[sourceId] || {})
      .flatMap(([label, dests]) => [...new Set((dests || []).map((dest) => mapPatternId(dest)))]
        .sort((a, b) => a - b)
        .map((target) => ({ label, target })))
      .sort((a, b) => a.label.localeCompare(b.label) || a.target - b.target);
    if (edges.length > 0) node.edges = edges;

    return node;
  });

  return {
    graph: {
      nodes,
      sourceNodeMap: Object.fromEntries(orderedSourceIds.map((sourceId) => [sourceId, sourceToKirId.get(sourceId)]))
    },
    mapPatternId
  };
}

function normalizePatterns(exp, mapPatternId) {
  return exp?.patterns ? { patterns: exp.patterns.map((id) => mapPatternId(id)) } : {};
}

function normalizeFilter(filter) {
  return clone(filter);
}

function normalizeExp(exp, mapPatternId) {
  if (!exp) return exp;

  switch (exp.op) {
    case "identity":
      return { op: "identity", ...normalizePatterns(exp, mapPatternId) };
    case "empty":
      return { op: "empty", ...normalizePatterns(exp, mapPatternId) };
    case "dot":
      return { op: "dot", label: exp.dot, ...normalizePatterns(exp, mapPatternId) };
    case "div":
      return { op: "div", tag: exp.div, ...normalizePatterns(exp, mapPatternId) };
    case "vid":
      return { op: "vid", tag: exp.vid, ...normalizePatterns(exp, mapPatternId) };
    case "code":
      return { op: "code", code: exp.code, ...normalizePatterns(exp, mapPatternId) };
    case "filter":
      return { op: "filter", filter: normalizeFilter(exp.filter), ...normalizePatterns(exp, mapPatternId) };
    case "ref":
      return { op: "ref", ref: exp.ref, ...normalizePatterns(exp, mapPatternId) };
    case "comp":
      return {
        op: "comp",
        items: exp.comp.map((child) => normalizeExp(child, mapPatternId)),
        ...normalizePatterns(exp, mapPatternId)
      };
    case "union":
      return {
        op: "union",
        items: exp.union.map((child) => normalizeExp(child, mapPatternId)),
        ...normalizePatterns(exp, mapPatternId)
      };
    case "product":
      return {
        op: "product",
        fields: exp.product.map(({ label, exp: child }) => ({
          label,
          expr: normalizeExp(child, mapPatternId)
        })),
        ...normalizePatterns(exp, mapPatternId)
      };
    default:
      throw new Error(`Unsupported KIR-P expression op: ${exp.op}`);
  }
}

function normalizeRelation(rel) {
  const { graph, mapPatternId } = normalizedPatternGraph(rel.typePatternGraph, relationPatternIds(rel));
  const [inputPattern, outputPattern] = rel.def?.patterns || [];
  return {
    inputPattern: inputPattern == null ? null : mapPatternId(inputPattern),
    outputPattern: outputPattern == null ? null : mapPatternId(outputPattern),
    typeDerivation: { status: rel.typeDerivation?.status || "unknown" },
    patternGraph: graph,
    body: normalizeExp(rel.def, mapPatternId)
  };
}

function sortedEntries(object = {}) {
  return Object.entries(object).sort(([a], [b]) => a.localeCompare(b));
}

function normalizeRelations(rels = {}) {
  return Object.fromEntries(sortedEntries(rels).map(([name, rel]) => [name, normalizeRelation(rel)]));
}

export function objectToKIRP(object) {
  if (object?.format !== "k-object") {
    throw new Error("KIR-P export requires a k object");
  }

  return {
    format: KIR_FORMAT,
    version: KIR_VERSION,
    layer: "KIR-P",
    sourceFormat: object.format,
    kind: object.main == null ? "library" : "executable",
    main: object.main ?? null,
    codes: clone(object.codes || {}),
    rels: normalizeRelations(object.rels || {}),
    relAlias: clone(object.relAlias || {}),
    compileStats: clone(object.compileStats || {}),
    meta: clone(object.meta || {})
  };
}

function resolveRelation(object, relationName = null) {
  const name = relationName || object.main;
  if (!name) throw new Error("KIR retyping requires a relation name");
  if (object.rels?.[name]) return { name, rel: object.rels[name] };

  const alias = object.relAlias?.[name];
  if (alias && object.rels?.[alias]) return { name: alias, rel: object.rels[alias] };
  if (alias && object.rels?.[name]) return { name, rel: object.rels[name] };
  if (alias) {
    for (const [k, rel] of Object.entries(object.rels || {})) {
      if (object.relAlias?.[k] === alias) return { name: k, rel };
    }
  }

  throw new Error(`Relation '${name}' not found`);
}

function relationLibraryWithTarget(object, targetRel) {
  const rels = { ...(object.rels || {}) };
  for (const [alias, hash] of Object.entries(object.relAlias || {})) {
    if (!(hash in rels) && alias in rels) rels[hash] = rels[alias];
  }
  rels.__kir_target__ = targetRel;
  return {
    format: "k-object",
    codes: object.codes || {},
    rels,
    relAlias: {
      ...(object.relAlias || {}),
      __kir_target__: "__kir_target__"
    },
    compileStats: object.compileStats || {},
    meta: object.meta || {},
    main: null
  };
}

function addPropertyListToPatternGraph(graph, propertyList) {
  const kindToPattern = {
    any: "(...)",
    "open-product": "{...}",
    "open-union": "<...>",
    "closed-product": "{}",
    "closed-union": "<>"
  };
  const nodes = propertyList.map(([kind]) =>
    graph.addNewNode({ pattern: kindToPattern[kind] })
  );

  propertyList.forEach(([, edges], nodeIndex) => {
    for (const [label, target] of edges) {
      graph.edges[nodes[nodeIndex]][label] = [nodes[target]];
    }
  });

  return nodes[0];
}

function cloneRelation(rel) {
  const clonedGraph = new TypePatternGraph(
    rel.typePatternGraph.registerCodeDef,
    rel.typePatternGraph.findCode
  );
  clonedGraph.patterns.nodes = JSON.parse(JSON.stringify(rel.typePatternGraph.patterns.nodes));
  clonedGraph.patterns.parent = [...rel.typePatternGraph.patterns.parent];
  clonedGraph.edges = JSON.parse(JSON.stringify(rel.typePatternGraph.edges));
  clonedGraph.codeId = { ...rel.typePatternGraph.codeId };

  return {
    ...rel,
    def: JSON.parse(JSON.stringify(rel.def)),
    typePatternGraph: clonedGraph,
    typeDerivation: { ...(rel.typeDerivation || {}) }
  };
}

function findCallSites(exp) {
  const calls = [];
  function visit(node) {
    if (!node) return;
    if (node.op === "ref") calls.push(node);
    if (node.comp) node.comp.forEach(visit);
    if (node.items) node.items.forEach(visit);
    if (node.union) node.union.forEach(visit);
    if (node.product) node.product.forEach((item) => visit(item.exp));
    if (node.fields) node.fields.forEach((item) => visit(item.expr));
  }
  visit(exp);
  return calls;
}

function findRelation(rels, relAlias, name) {
  if (!name) return null;
  if (rels[name]) return { name, rel: rels[name] };
  const alias = relAlias?.[name];
  if (alias && rels[alias]) return { name: alias, rel: rels[alias] };
  if (alias) {
    for (const [k, rel] of Object.entries(rels)) {
      if (relAlias?.[k] === alias) return { name: k, rel };
    }
  }
  return null;
}

export function specializeObjectRelations(object, entryRelationName = null, inputPattern = null) {
  if (object?.format !== "k-object") {
    throw new Error("specializeObjectRelations requires a k object");
  }

  const baseRels = Object.fromEntries(
    Object.entries(object.rels || {}).map(([name, rel]) => [name, cloneRelation(rel)])
  );
  for (const [aliasName, hash] of Object.entries(object.relAlias || {})) {
    if (!baseRels[aliasName]) {
      const match = Object.entries(baseRels).find(([k]) => object.relAlias?.[k] === hash);
      if (match) baseRels[aliasName] = match[1];
    }
  }

  const entry = findRelation(
    baseRels,
    object.relAlias,
    entryRelationName || object.main || "__main__"
  );
  if (!entry) return object;

  const specializedRels = new Map();
  const specializedCounts = new Map();
  const newRels = {};

  const entryRel = cloneRelation(entry.rel);
  newRels[entry.name] = entryRel;

  if (Array.isArray(inputPattern) && inputPattern.length > 0) {
    const inRoot = addPropertyListToPatternGraph(entryRel.typePatternGraph, inputPattern);
    try {
      entryRel.typePatternGraph.unify("specialize", entryRel.def.patterns[0], inRoot);
    } catch {
      // Best-effort entry unification
    }
    specializedRels.set(entry.name + "::" + JSON.stringify(inputPattern), entry.name);
  }

  const worklist = [entry.name];
  while (worklist.length > 0) {
    const currentName = worklist.shift();
    const currentRel = newRels[currentName];
    if (!currentRel) continue;

    const calls = findCallSites(currentRel.def);
    for (const call of calls) {
      const target = findRelation(baseRels, object.relAlias, call.ref);
      if (!target) continue;

      const argPatternId = call.patterns?.[0];
      if (argPatternId != null) {
        const argRoot = currentRel.typePatternGraph.find(argPatternId);
        const argPropList = patternToPropertyList(
          exportPatternGraph(currentRel.typePatternGraph, argRoot)
        );
        const argSig = JSON.stringify(argPropList);
        const specKey = target.name + "::" + argSig;

        let specName = specializedRels.get(specKey);
        if (!specName) {
          const count = (specializedCounts.get(target.name) || 0) + 1;
          specializedCounts.set(target.name, count);
          specName = count === 1 ? target.name : `${target.name}$${count}`;
          specializedRels.set(specKey, specName);

          const targetRel = cloneRelation(target.rel);
          const tInRoot = addPropertyListToPatternGraph(targetRel.typePatternGraph, argPropList);
          try {
            targetRel.typePatternGraph.unify("specialize", targetRel.def.patterns[0], tInRoot);
          } catch {
            // Unification failure: keep target unspecialized
          }
          newRels[specName] = targetRel;
          worklist.push(specName);
        }

        call.ref = specName;

        const targetRel = newRels[specName];
        const outPatternId = targetRel.def.patterns?.[1];
        const retPatternId = call.patterns?.[1];
        if (outPatternId != null && retPatternId != null) {
          const outRoot = targetRel.typePatternGraph.find(outPatternId);
          const retPropList = patternToPropertyList(
            exportPatternGraph(targetRel.typePatternGraph, outRoot)
          );
          const rRetRoot = addPropertyListToPatternGraph(currentRel.typePatternGraph, retPropList);
          try {
            currentRel.typePatternGraph.unify("specialize", retPatternId, rRetRoot);
          } catch {
            // Keep existing call return pattern on unification error
          }
        }
      }
    }
  }

  const resultRels = {
    ...baseRels,
    ...newRels
  };
  const resultRelAlias = { ...(object.relAlias || {}) };
  for (const name of Object.keys(newRels)) {
    if (!resultRelAlias[name]) resultRelAlias[name] = name;
  }

  return {
    ...object,
    rels: resultRels,
    relAlias: resultRelAlias
  };
}

export function relationPatternPropertyList(rel, index) {
  return expPatternPropertyList(rel, rel.def, index);
}

function expPatternPropertyList(rel, exp, index) {
  const patternId = exp?.patterns?.[index];
  if (patternId == null) return null;
  const root = rel.typePatternGraph.find(patternId);
  return patternToPropertyList(exportPatternGraph(rel.typePatternGraph, root));
}

export function retypeObjectRelationForBackend(object, relationName, inputPattern, options = {}) {
  if (object?.format !== "k-object") {
    throw new Error("KIR retyping requires a k object");
  }
  if (!Array.isArray(inputPattern)) {
    throw new Error("KIR retyping requires an input pattern property list");
  }

  const target = resolveRelation(object, relationName);
  const specializedObject = specializeObjectRelations(object, target.name, inputPattern);
  const specializedRel = resolveRelation(specializedObject, target.name);
  const kir = objectToKIRP(specializedObject);

  return {
    relation: target.name,
    retypedObject: specializedObject,
    kir,
    entryName: target.name,
    inputPattern: relationPatternPropertyList(specializedRel.rel, 0),
    outputPattern: relationPatternPropertyList(specializedRel.rel, 1)
  };
}

export function retypeObjectRelation(object, relationName, inputPattern, options = {}) {
  if (object?.format !== "k-object") {
    throw new Error("KIR retyping requires a k object");
  }
  if (!Array.isArray(inputPattern)) {
    throw new Error("KIR retyping requires an input pattern property list");
  }

  const target = resolveRelation(object, relationName);
  const source = `?${propertyListToFilter(inputPattern)} __kir_target__`;
  const retypedObject = hydrateObject(compileObject(source, {
    source: options.source || "<kir-retype>",
    libraries: [relationLibraryWithTarget(object, target.rel)]
  }));
  return objectToKIRP(retypedObject);
}

export { KIR_FORMAT, KIR_VERSION };

export default {
  KIR_FORMAT,
  KIR_VERSION,
  objectToKIRP,
  relationPatternPropertyList,
  retypeObjectRelation,
  retypeObjectRelationForBackend,
  specializeObjectRelations
};

function helpText() {
  return [
    "Export the KIR-P JSON view from a k .ko or .klib object.",
    "",
    `Usage: ${argv[1]} [options] [object-file]`,
    "",
    "Arguments:",
    "  object-file    Input .ko or .klib file. Reads from stdin when omitted.",
    "",
    "Options:",
    "  --retype rel           Export retyped KIR-P for relation rel.",
    "  --input-pattern json   Input pattern property-list JSON, or a file containing it.",
    "  -h, --help     Show this help.",
    "",
    "KIR-P is an inspection/export view; retyping also emits KIR-P."
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

async function readStdinBytes() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isMainModule() {
  return argv[1] != null && path.resolve(argv[1]) === fileURLToPath(import.meta.url);
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let retypeRelation = null;
  let inputPatternArg = null;
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--retype") {
      retypeRelation = args.shift();
      if (!retypeRelation) throw new Error("--retype requires a relation name");
    } else if (option === "--input-pattern") {
      inputPatternArg = args.shift();
      if (!inputPatternArg) throw new Error("--input-pattern requires JSON or a file path");
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const inputPath = args.shift() || null;
  if (args.length > 0) {
    throw new Error(`Unexpected argument: ${args[0]}`);
  }

  const buffer = inputPath == null ? await readStdinBytes() : fs.readFileSync(inputPath);
  const object = decodeObject(buffer);
  if (retypeRelation != null) {
    if (inputPatternArg == null) throw new Error("--retype requires --input-pattern");
    const inputPatternText = fs.existsSync(inputPatternArg) ? fs.readFileSync(inputPatternArg, "utf8") : inputPatternArg;
    stdout.write(JSON.stringify(retypeObjectRelation(object, retypeRelation, JSON.parse(inputPatternText)), null, 2) + "\n");
  } else {
    stdout.write(JSON.stringify(objectToKIRP(object), null, 2) + "\n");
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error.message || String(error));
    usage();
    exit(1);
  });
}
