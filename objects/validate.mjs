#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";
import { decodeObject } from "../object.mjs";
import { KIR_FORMAT, KIR_VERSION, objectToKIRP } from "../kir.mjs";
import { isIntrinsic } from "../intrinsics.mjs";

const TYPE_DERIVATION_STATUSES = new Set(["converged", "not-converged", "unknown"]);
const KIR_PATTERN_KINDS = new Set([
  "any",
  "open-product",
  "closed-product",
  "open-union",
  "closed-union",
  "type"
]);
const KIR_OPS = new Set([
  "identity",
  "empty",
  "dot",
  "div",
  "vid",
  "code",
  "filter",
  "ref",
  "comp",
  "union",
  "product"
]);

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, path) {
  if (!isObject(value)) fail(`${path} must be an object`);
}

function assertString(value, path) {
  if (typeof value !== "string") fail(`${path} must be a string`);
}

function assertArray(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
}

function assertInteger(value, path) {
  if (!Number.isInteger(value)) fail(`${path} must be an integer`);
}

function validateStatus(status, path) {
  if (!TYPE_DERIVATION_STATUSES.has(status)) {
    fail(`${path} must be one of ${[...TYPE_DERIVATION_STATUSES].join(", ")}`);
  }
}

function validateObjectExp(exp, path, relNames, codeNames) {
  assertObject(exp, path);
  assertString(exp.op, `${path}.op`);

  if (exp.patterns != null) {
    assertArray(exp.patterns, `${path}.patterns`);
    exp.patterns.forEach((id, index) => assertInteger(id, `${path}.patterns[${index}]`));
  }

  switch (exp.op) {
    case "identity":
    case "empty":
      break;
    case "dot":
      assertString(exp.dot, `${path}.dot`);
      break;
    case "div":
      assertString(exp.div, `${path}.div`);
      break;
    case "vid":
      assertString(exp.vid, `${path}.vid`);
      break;
    case "code":
      assertString(exp.code, `${path}.code`);
      if (!codeNames.has(exp.code)) fail(`${path}.code references missing code ${exp.code}`);
      break;
    case "filter":
      validateObjectFilter(exp.filter, `${path}.filter`, codeNames);
      break;
    case "ref":
      assertString(exp.ref, `${path}.ref`);
      if (!isIntrinsic(exp.ref) && !relNames.has(exp.ref)) {
        fail(`${path}.ref references missing relation ${exp.ref}`);
      }
      break;
    case "comp":
      assertArray(exp.comp, `${path}.comp`);
      exp.comp.forEach((child, index) => validateObjectExp(child, `${path}.comp[${index}]`, relNames, codeNames));
      break;
    case "union":
      assertArray(exp.union, `${path}.union`);
      exp.union.forEach((child, index) => validateObjectExp(child, `${path}.union[${index}]`, relNames, codeNames));
      break;
    case "product":
      assertArray(exp.product, `${path}.product`);
      exp.product.forEach((field, index) => {
        assertObject(field, `${path}.product[${index}]`);
        assertString(field.label, `${path}.product[${index}].label`);
        validateObjectExp(field.exp, `${path}.product[${index}].exp`, relNames, codeNames);
      });
      break;
    default:
      fail(`${path}.op has unsupported value ${exp.op}`);
  }
}

function validateObjectFilter(filter, path, codeNames) {
  assertObject(filter, path);
  if (filter.type === "code") {
    assertString(filter.code, `${path}.code`);
    if (!codeNames.has(filter.code)) fail(`${path}.code references missing code ${filter.code}`);
  }
  if (filter.fields != null) {
    assertObject(filter.fields, `${path}.fields`);
    for (const [label, child] of Object.entries(filter.fields)) {
      validateObjectFilter(child, `${path}.fields.${label}`, codeNames);
    }
  }
}

function validateTypePatternGraph(graph, path, codeNames) {
  assertObject(graph, path);
  const nodes = graph.patterns?.nodes;
  const parent = graph.patterns?.parent;
  assertArray(nodes, `${path}.patterns.nodes`);
  assertArray(parent, `${path}.patterns.parent`);
  if (parent.length > nodes.length) {
    fail(`${path}.patterns.parent length must not exceed nodes length`);
  }

  nodes.forEach((node, index) => {
    assertObject(node, `${path}.patterns.nodes[${index}]`);
    assertString(node.pattern, `${path}.patterns.nodes[${index}].pattern`);
    if (node.pattern === "type") {
      assertString(node.type, `${path}.patterns.nodes[${index}].type`);
      if (!codeNames.has(node.type)) fail(`${path}.patterns.nodes[${index}].type references missing code ${node.type}`);
    }
  });

  parent.forEach((parentId, index) => {
    if (parentId == null) return;
    assertInteger(parentId, `${path}.patterns.parent[${index}]`);
    if (parentId < 0 || parentId >= nodes.length) fail(`${path}.patterns.parent[${index}] is out of range`);
  });

  assertArray(graph.edges, `${path}.edges`);
  if (graph.edges.length > nodes.length) {
    fail(`${path}.edges length must not exceed nodes length`);
  }
  graph.edges.forEach((edges, source) => {
    if (edges == null) return;
    assertObject(edges, `${path}.edges[${source}]`);
    for (const [label, dests] of Object.entries(edges)) {
      assertString(label, `${path}.edges[${source}] label`);
      assertArray(dests, `${path}.edges[${source}].${label}`);
      dests.forEach((target, index) => {
        assertInteger(target, `${path}.edges[${source}].${label}[${index}]`);
        if (target < 0 || target >= nodes.length) fail(`${path}.edges[${source}].${label}[${index}] is out of range`);
      });
    }
  });

  assertObject(graph.codeId || {}, `${path}.codeId`);
  for (const [code, id] of Object.entries(graph.codeId || {})) {
    if (!codeNames.has(code)) fail(`${path}.codeId references missing code ${code}`);
    assertInteger(id, `${path}.codeId.${code}`);
    if (id < 0 || id >= nodes.length) fail(`${path}.codeId.${code} is out of range`);
  }
}

export function validateObjectPayload(object) {
  assertObject(object, "object");
  if (object.format !== "k-object") fail("object.format must be k-object");
  assertObject(object.codes || {}, "object.codes");
  assertObject(object.rels || {}, "object.rels");
  assertObject(object.relAlias || {}, "object.relAlias");
  assertObject(object.meta || {}, "object.meta");
  assertObject(object.compileStats || {}, "object.compileStats");

  if (object.main != null) {
    assertString(object.main, "object.main");
    if (!(object.main in object.rels)) fail(`object.main references missing relation ${object.main}`);
  }

  const codeNames = new Set(Object.keys(object.codes || {}));
  const relNames = new Set(Object.keys(object.rels || {}));

  for (const [name, hash] of Object.entries(object.relAlias || {})) {
    assertString(name, `object.relAlias key ${name}`);
    assertString(hash, `object.relAlias.${name}`);
    if (!relNames.has(hash) && !relNames.has(name) && !hash.startsWith("@")) {
      fail(`object.relAlias.${name} references missing relation ${hash}`);
    }
  }

  for (const [name, rel] of Object.entries(object.rels || {})) {
    assertObject(rel, `object.rels.${name}`);
    validateObjectExp(rel.def, `object.rels.${name}.def`, relNames, codeNames);
    assertObject(rel.typeDerivation || {}, `object.rels.${name}.typeDerivation`);
    validateStatus(rel.typeDerivation?.status || "unknown", `object.rels.${name}.typeDerivation.status`);
    validateTypePatternGraph(rel.typePatternGraph, `object.rels.${name}.typePatternGraph`, codeNames);
  }

  for (const [hash, entry] of Object.entries(object.meta || {})) {
    assertObject(entry, `object.meta.${hash}`);
    if (entry.type !== "code" && entry.type !== "rel") fail(`object.meta.${hash}.type must be code or rel`);
    assertArray(entry.origins || [], `object.meta.${hash}.origins`);
  }

  return object;
}

function validateKirPatterns(patterns, path, nodeCount) {
  if (patterns == null) return;
  assertArray(patterns, path);
  patterns.forEach((id, index) => {
    assertInteger(id, `${path}[${index}]`);
    if (id < 0 || id >= nodeCount) fail(`${path}[${index}] is out of range`);
  });
}

function validateKIRExp(exp, path, nodeCount, relNames, codeNames) {
  assertObject(exp, path);
  assertString(exp.op, `${path}.op`);
  if (!KIR_OPS.has(exp.op)) fail(`${path}.op has unsupported value ${exp.op}`);
  validateKirPatterns(exp.patterns, `${path}.patterns`, nodeCount);

  switch (exp.op) {
    case "identity":
    case "empty":
      break;
    case "dot":
      assertString(exp.label, `${path}.label`);
      break;
    case "div":
    case "vid":
      assertString(exp.tag, `${path}.tag`);
      break;
    case "code":
      assertString(exp.code, `${path}.code`);
      if (!codeNames.has(exp.code)) fail(`${path}.code references missing code ${exp.code}`);
      break;
    case "filter":
      assertObject(exp.filter, `${path}.filter`);
      break;
    case "ref":
      assertString(exp.ref, `${path}.ref`);
      if (!isIntrinsic(exp.ref) && !relNames.has(exp.ref)) fail(`${path}.ref references missing relation ${exp.ref}`);
      break;
    case "comp":
    case "union":
      assertArray(exp.items, `${path}.items`);
      exp.items.forEach((child, index) => validateKIRExp(child, `${path}.items[${index}]`, nodeCount, relNames, codeNames));
      break;
    case "product":
      assertArray(exp.fields, `${path}.fields`);
      exp.fields.forEach((field, index) => {
        assertObject(field, `${path}.fields[${index}]`);
        assertString(field.label, `${path}.fields[${index}].label`);
        validateKIRExp(field.expr, `${path}.fields[${index}].expr`, nodeCount, relNames, codeNames);
      });
      break;
  }
}

function validateKIRPatternGraph(patternGraph, path, codeNames) {
  assertObject(patternGraph, path);
  assertArray(patternGraph.nodes, `${path}.nodes`);
  const nodeCount = patternGraph.nodes.length;
  patternGraph.nodes.forEach((node, index) => {
    assertObject(node, `${path}.nodes[${index}]`);
    if (node.id !== index) fail(`${path}.nodes[${index}].id must be ${index}`);
    if (!KIR_PATTERN_KINDS.has(node.kind)) fail(`${path}.nodes[${index}].kind is unsupported`);
    if (node.kind === "type") {
      assertString(node.code, `${path}.nodes[${index}].code`);
      if (!codeNames.has(node.code)) fail(`${path}.nodes[${index}].code references missing code ${node.code}`);
    }
    if (node.edges != null) {
      assertArray(node.edges, `${path}.nodes[${index}].edges`);
      node.edges.forEach((edge, edgeIndex) => {
        assertObject(edge, `${path}.nodes[${index}].edges[${edgeIndex}]`);
        assertString(edge.label, `${path}.nodes[${index}].edges[${edgeIndex}].label`);
        assertInteger(edge.target, `${path}.nodes[${index}].edges[${edgeIndex}].target`);
        if (edge.target < 0 || edge.target >= nodeCount) {
          fail(`${path}.nodes[${index}].edges[${edgeIndex}].target is out of range`);
        }
      });
    }
  });

  assertObject(patternGraph.sourceNodeMap || {}, `${path}.sourceNodeMap`);
  for (const [sourceId, kirId] of Object.entries(patternGraph.sourceNodeMap || {})) {
    if (!/^\d+$/.test(sourceId)) fail(`${path}.sourceNodeMap key ${sourceId} must be an integer string`);
    assertInteger(kirId, `${path}.sourceNodeMap.${sourceId}`);
    if (kirId < 0 || kirId >= nodeCount) fail(`${path}.sourceNodeMap.${sourceId} is out of range`);
  }
}

export function validateKIRP(kir) {
  assertObject(kir, "kir");
  if (kir.format !== KIR_FORMAT) fail(`kir.format must be ${KIR_FORMAT}`);
  if (kir.version !== KIR_VERSION) fail(`kir.version must be ${KIR_VERSION}`);
  if (kir.layer !== "KIR-P") fail("kir.layer must be KIR-P");
  if (kir.kind !== "executable" && kir.kind !== "library") fail("kir.kind must be executable or library");
  assertObject(kir.codes || {}, "kir.codes");
  assertObject(kir.rels || {}, "kir.rels");
  assertObject(kir.relAlias || {}, "kir.relAlias");
  assertObject(kir.compileStats || {}, "kir.compileStats");
  assertObject(kir.meta || {}, "kir.meta");

  if (kir.kind === "executable") {
    assertString(kir.main, "kir.main");
    if (!(kir.main in kir.rels)) fail(`kir.main references missing relation ${kir.main}`);
  } else if (kir.main !== null) {
    fail("library KIR must have main: null");
  }

  const codeNames = new Set(Object.keys(kir.codes || {}));
  const relNames = new Set(Object.keys(kir.rels || {}));

  for (const [name, rel] of Object.entries(kir.rels || {})) {
    assertObject(rel, `kir.rels.${name}`);
    validateStatus(rel.typeDerivation?.status || "unknown", `kir.rels.${name}.typeDerivation.status`);
    validateKIRPatternGraph(rel.patternGraph, `kir.rels.${name}.patternGraph`, codeNames);
    const nodeCount = rel.patternGraph.nodes.length;
    for (const field of ["inputPattern", "outputPattern"]) {
      if (rel[field] == null) continue;
      assertInteger(rel[field], `kir.rels.${name}.${field}`);
      if (rel[field] < 0 || rel[field] >= nodeCount) fail(`kir.rels.${name}.${field} is out of range`);
    }
    validateKIRExp(rel.body, `kir.rels.${name}.body`, nodeCount, relNames, codeNames);
  }

  return kir;
}

function helpText() {
  return [
    "Validate a k .ko/.klib object or KIR-P JSON file.",
    "",
    `Usage: ${argv[1]} [options] [input-file]`,
    "",
    "Arguments:",
    "  input-file     Input .ko/.klib file, or KIR JSON with --kir. Reads stdin when omitted.",
    "",
    "Options:",
    "  --kir          Validate input as KIR-P JSON instead of a k object.",
    "  -h, --help     Show this help.",
    "",
    "Object validation also validates the derived KIR-P export view."
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

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  let mode = "object";
  while (args.length > 0 && args[0].startsWith("--")) {
    const option = args.shift();
    if (option === "--kir") {
      mode = "kir";
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const inputPath = args.shift() || null;
  if (args.length > 0) throw new Error(`Unexpected argument: ${args[0]}`);

  const input = inputPath == null ? await readStdinBytes() : fs.readFileSync(inputPath);
  if (mode === "kir") {
    validateKIRP(JSON.parse(input.toString("utf8")));
    stdout.write("OK KIR-P\n");
    return;
  }

  const object = validateObjectPayload(decodeObject(input));
  validateKIRP(objectToKIRP(object));
  stdout.write(`OK ${object.main == null ? "library" : "object"}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || String(error));
    usage();
    exit(1);
  });
}
