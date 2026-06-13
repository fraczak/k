#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { argv, exit, stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { decodeObject } from "./object.mjs";

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

export { KIR_FORMAT, KIR_VERSION };

export default {
  KIR_FORMAT,
  KIR_VERSION,
  objectToKIRP
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
    "  -h, --help     Show this help.",
    "",
    "KIR-P is an inspection/export view; it does not change the stored object format."
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

  while (args.length > 0 && args[0].startsWith("--")) {
    throw new Error(`Unknown option: ${args[0]}`);
  }

  const inputPath = args.shift() || null;
  if (args.length > 0) {
    throw new Error(`Unexpected argument: ${args[0]}`);
  }

  const buffer = inputPath == null ? await readStdinBytes() : fs.readFileSync(inputPath);
  stdout.write(JSON.stringify(objectToKIRP(decodeObject(buffer)), null, 2) + "\n");
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error.message || String(error));
    usage();
    exit(1);
  });
}
