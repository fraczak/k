import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotate,
  decodeWire,
  encodeToWire,
  exportPatternGraph,
  isProduct,
  isVariant,
  lowerToKVM,
  NODE_KIND,
  patternToPropertyList,
  propertyListToPattern,
  Value
} from "@fraczak/k/backend-api.mjs";
import { intersectPropertyListPatterns } from "@fraczak/k/codecs/runtime/codec.mjs";
import { propertyListToFilter } from "@fraczak/k/codecs/runtime/show-value.mjs";
import { parse } from "@fraczak/k/index.mjs";
import { compileTypes } from "@fraczak/k/compiler.mjs";
import codes from "@fraczak/k/codes.mjs";
import { cloneSubpattern, withPattern } from "@fraczak/k/Value.mjs";
import { lowerToWasm, getTagEntries, resetTagIds } from "./kvm2wasm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWat = fs.readFileSync(path.join(__dirname, "../runtime.wat"), "utf8");
let wabtPromise;

const METADATA_SECTION = "k.metadata";
const ARTIFACT_FORMAT = "k-wasm";
const ARTIFACT_VERSION = 1;

const cleanName = (name) => "rel_" + name.replace(/[^a-zA-Z0-9_]/g, "_");

async function getWabt() {
  if (!wabtPromise) {
    wabtPromise = import("wabt").then(({ default: wabtFactory }) => wabtFactory());
  }
  return wabtPromise;
}

async function compileWat(watText) {
  const wabtInstance = await getWabt();
  const watModule = wabtInstance.parseWat("k_wasm.wat", watText, {
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    multi_value: true,
    bulk_memory: true,
    reference_types: true
  });
  watModule.resolveNames();
  watModule.validate();
  return Buffer.from(watModule.toBinary({
    log: false,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: true
  }).buffer);
}

function scanCalls(insts, compiled, queue) {
  for (const inst of insts) {
    if (inst.op === "call" && !compiled.has(inst.func) && !queue.includes(inst.func)) {
      queue.push(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        scanCalls(branch.body, compiled, queue);
      }
    }
  }
}

function injectLibraries(rels, libraries = []) {
  for (const lib of libraries) {
    const libRels = lib.rels || lib.defs?.rels || {};
    for (const [name, rel] of Object.entries(libRels)) {
      if (!(name in rels)) {
        rels[name] = { ...rel, _library: true };
      }
    }
  }
}

function cloneForRetyping(value) {
  if (Array.isArray(value)) return value.map(cloneForRetyping);
  if (!value || typeof value !== "object") return value;

  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "patterns" || key.startsWith("_")) continue;
    clone[key] = cloneForRetyping(child);
  }
  return clone;
}

function composeInputFilter(filterExp, exp) {
  return {
    op: "comp",
    comp: [filterExp, exp],
    ...(filterExp.start ? { start: filterExp.start } : exp.start ? { start: exp.start } : {}),
    ...(exp.end ? { end: exp.end } : filterExp.end ? { end: filterExp.end } : {})
  };
}

function compileParsedDefs(parsed, mainExp, options = {}) {
  const representatives = codes.register(parsed.defs.codes || {});
  const rels = Object.fromEntries(
    Object.entries(parsed.defs.rels || {}).map(([name, rel]) => [
      name,
      { ...cloneForRetyping(rel), def: cloneForRetyping(rel.def) }
    ])
  );
  rels.__main__ = { def: mainExp };
  injectLibraries(rels, options.libraries);

  const { relAlias, compileStats } = compileTypes(representatives, rels, options);
  return {
    rels,
    representatives,
    relAlias,
    compileStats,
    sourceDefs: parsed.defs
  };
}

function compileObjectDefs(object, mainRelName, mainExp = null, options = {}) {
  const representatives = codes.register(object.codes || {});
  const rels = Object.fromEntries(
    Object.entries(object.rels || {}).map(([name, rel]) => [
      name,
      { def: cloneForRetyping(name === mainRelName && mainExp ? mainExp : rel.def) }
    ])
  );
  injectLibraries(rels, options.libraries);

  const { relAlias, compileStats } = compileTypes(representatives, rels, options);
  return {
    rels,
    representatives,
    relAlias,
    compileStats
  };
}

function annotateSourceWithInputFilter(source, inputPattern, valuePattern, options = {}) {
  const intersection = intersectInputEnvelope(inputPattern, valuePattern);
  const filter = propertyListToFilter(intersection);
  const parsed = parse(source);
  const filterExp = parse(`?${filter}`).exp;
  return compileParsedDefs(
    parsed,
    composeInputFilter(filterExp, cloneForRetyping(parsed.exp)),
    options
  );
}

function annotateObjectWithInputFilter(object, mainRelName, inputPattern, valuePattern, options = {}) {
  const intersection = intersectInputEnvelope(inputPattern, valuePattern);
  const filter = propertyListToFilter(intersection);
  const filterExp = parse(`?${filter}`).exp;
  const mainRel = object.rels?.[mainRelName];
  if (!mainRel) throw new Error(`No main relation (${mainRelName}) defined in object`);
  const mainExp = composeInputFilter(filterExp, cloneForRetyping(mainRel.def));
  return compileObjectDefs(object, mainRelName, mainExp, options);
}

function cleanFunctionNameMap(names) {
  const used = new Set();
  const nameMap = new Map();
  for (const name of names) {
    const base = cleanName(name);
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    used.add(candidate);
    nameMap.set(name, candidate);
  }
  return nameMap;
}

function cleanCallNames(insts, nameMap = null) {
  for (const inst of insts) {
    if (inst.op === "call") {
      inst.func = nameMap?.get(inst.func) || cleanName(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        cleanCallNames(branch.body, nameMap);
      }
    }
  }
}

function cloneKVMInstructions(insts) {
  return insts.map((inst) => ({
    ...inst,
    ...(inst.branches
      ? {
          branches: inst.branches.map((branch) => ({
            label: branch.label,
            body: cloneKVMInstructions(branch.body)
          }))
        }
      : {})
  }));
}

function cloneKVMFunction(kvmFunc) {
  return {
    ...kvmFunc,
    body: cloneKVMInstructions(kvmFunc.body)
  };
}

function compileModule(mainRelName, defs) {
  const compiled = new Set();
  const queue = [mainRelName];
  const wats = [];

  while (queue.length > 0) {
    const name = queue.shift();
    if (compiled.has(name)) continue;
    compiled.add(name);

    const relDef = defs.rels[name];
    if (!relDef) {
      throw new Error(`Relation ${name} not found`);
    }

    const kvmFunc = lowerToKVM(relDef, name);
    kvmFunc.typePatternGraph = relDef.typePatternGraph;
    scanCalls(kvmFunc.body, compiled, queue);

    kvmFunc.name = cleanName(name);
    cleanCallNames(kvmFunc.body);
    wats.push(lowerToWasm(kvmFunc, kvmFunc.name));
  }

  return {
    wat: wats.join("\n\n"),
    relationNames: [...compiled]
  };
}

function compileKVMModule(mainRelName, kvmProgram) {
  const compiled = new Set();
  const queue = [mainRelName];
  const wats = [];
  const nameMap = cleanFunctionNameMap(Object.keys(kvmProgram));
  const cleanKVMProgram = Object.fromEntries(
    Object.entries(kvmProgram).map(([name, kvmFunc]) => [nameMap.get(name), kvmFunc])
  );

  while (queue.length > 0) {
    const name = queue.shift();
    if (compiled.has(name)) continue;
    compiled.add(name);

    const originalFunc = kvmProgram[name];
    if (!originalFunc || !Array.isArray(originalFunc.body)) {
      throw new Error(`kVM function ${name} not found`);
    }

    scanCalls(originalFunc.body, compiled, queue);

    const kvmFunc = cloneKVMFunction(originalFunc);
    kvmFunc.name = nameMap.get(name);
    cleanCallNames(kvmFunc.body, nameMap);
    wats.push(lowerToWasm(kvmFunc, kvmFunc.name, { kvmProgram: cleanKVMProgram }));
  }

  return {
    wat: wats.join("\n\n"),
    entryName: nameMap.get(mainRelName)
  };
}

function getPatternPropertyList(graph, patternId) {
  const nodeId = graph.find(patternId);
  return patternToPropertyList(exportPatternGraph(graph, nodeId));
}

function encodeU32(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function appendCustomSection(wasmBuffer, name, data) {
  const nameBuffer = Buffer.from(name, "utf8");
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const payload = Buffer.concat([
    encodeU32(nameBuffer.length),
    nameBuffer,
    dataBuffer
  ]);
  return Buffer.concat([
    Buffer.from(wasmBuffer),
    Buffer.from([0]),
    encodeU32(payload.length),
    payload
  ]);
}

function validateMetadata(metadata) {
  if (!metadata || metadata.format !== ARTIFACT_FORMAT || metadata.version !== ARTIFACT_VERSION) {
    throw new Error("Unsupported k WebAssembly artifact metadata");
  }
  if (typeof metadata.entry !== "string") {
    throw new Error("WebAssembly artifact metadata is missing its entry point");
  }
  if (!Array.isArray(metadata.inputPattern) || !Array.isArray(metadata.outputPattern)) {
    throw new Error("WebAssembly artifact metadata is missing its input/output patterns");
  }
  if (!Array.isArray(metadata.tags)) {
    throw new Error("WebAssembly artifact metadata is missing its tag table");
  }
  propertyListToPattern(metadata.inputPattern);
  propertyListToPattern(metadata.outputPattern);
  return metadata;
}

function metadataFromModule(module) {
  const sections = WebAssembly.Module.customSections(module, METADATA_SECTION);
  if (sections.length !== 1) {
    throw new Error(`Expected one '${METADATA_SECTION}' custom section, found ${sections.length}`);
  }
  return validateMetadata(JSON.parse(Buffer.from(sections[0]).toString("utf8")));
}

function isMonomorphicPattern(pattern) {
  return Array.isArray(pattern) &&
    pattern.length > 0 &&
    pattern.every(([kind]) => kind === "closed-product" || kind === "closed-union");
}

function classifyTyping(inputPattern, outputPattern, status = "unknown", mode = "generic") {
  const input = isMonomorphicPattern(inputPattern) ? "monomorphic" : "polymorphic";
  const output = isMonomorphicPattern(outputPattern) ? "monomorphic" : "polymorphic";
  return {
    status,
    mode,
    input,
    output,
    program: input === "monomorphic" && output === "monomorphic" ? "monomorphic" : "polymorphic"
  };
}

function compileStatsByRelName(compileStats = {}) {
  const byName = new Map();
  for (const scc of compileStats.sccs || []) {
    for (const member of scc.members || []) {
      byName.set(member, scc);
    }
  }
  return byName;
}

function relTypeStatus(defs, name) {
  const rel = defs.rels?.[name];
  const explicit = rel?.typeDerivation?.status;
  if (explicit) return explicit;
  const scc = compileStatsByRelName(defs.compileStats).get(name);
  if (scc) return scc.converged ? "converged" : "not-converged";
  return "unknown";
}

function assertRelationsConverged(defs, relationNames) {
  for (const name of relationNames) {
    const status = relTypeStatus(defs, name);
    if (status !== "converged") {
      throw new Error(`Cannot compile '${name}' to WebAssembly: type derivation is ${status}`);
    }
  }
}

function intersectInputEnvelope(inputPattern, valuePattern) {
  try {
    return intersectPropertyListPatterns(inputPattern, valuePattern);
  } catch (error) {
    throw new TypeError(
      "Input value envelope does not intersect WebAssembly artifact input pattern.\n" +
      ` - input pattern: ${JSON.stringify(inputPattern)}\n` +
      ` - value envelope: ${JSON.stringify(valuePattern)}`
    );
  }
}

function validateInputEnvelope(inputPattern, valuePattern) {
  intersectInputEnvelope(inputPattern, valuePattern);
}

function buildExportPreamble(exportSpecs, libraries) {
  if (exportSpecs.length === 0) return "";

  const aliasMap = {};
  for (const lib of libraries) {
    for (const [name, hash] of Object.entries(lib.relAlias || {})) {
      if (name !== "__main__") aliasMap[name] = hash;
    }
    for (const [hash, entry] of Object.entries(lib.meta || {})) {
      if (entry?.type !== "rel") continue;
      for (const origin of entry?.origins || []) {
        if (origin?.name && origin.name !== "__main__") {
          aliasMap[origin.name] = hash;
        }
      }
    }
  }

  const lines = [];
  for (const spec of exportSpecs) {
    const [libName, localName] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
    const hash = aliasMap[libName];
    if (!hash) throw new Error(`--export: '${libName}' not found in loaded libraries`);
    const body = hash.startsWith("@") ? hash.slice(1) : hash;
    lines.push(`${localName} = @${body};`);
  }
  return lines.join("\n") + "\n";
}

async function compileWasmArtifactFromDefs(
  defs,
  mainRelName = "__main__",
  { typingMode = "generic" } = {}
) {
  resetTagIds();
  const mainRel = defs.rels[mainRelName];
  if (!mainRel) {
    throw new Error(`No main relation (${mainRelName}) defined in script`);
  }

  const { wat: moduleWatBody, relationNames } = compileModule(mainRelName, defs);
  assertRelationsConverged(defs, relationNames);
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + moduleWatBody + "\n)";
  const graph = mainRel.typePatternGraph;
  const inputPattern = getPatternPropertyList(graph, mainRel.def.patterns[0]);
  const outputPattern = getPatternPropertyList(graph, mainRel.def.patterns[1]);
  const metadata = {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    abi: "arena-v1",
    entry: cleanName(mainRelName),
    inputPattern,
    outputPattern,
    typing: classifyTyping(inputPattern, outputPattern, relTypeStatus(defs, mainRelName), typingMode),
    tags: getTagEntries()
  };
  return appendCustomSection(await compileWat(fullWat), METADATA_SECTION, JSON.stringify(metadata));
}

function normalizeKVMInput(kvmInput, { entry = "__main__", typingMode = "generic" } = {}) {
  if (kvmInput?.format === "k-vm") {
    const program = kvmInput.functions;
    if (!program || typeof program !== "object" || Array.isArray(program)) {
      throw new Error("Expected .kvm artifact to contain a functions object");
    }
    if (kvmInput.layer != null && kvmInput.layer !== "KVM") {
      throw new Error(`Unsupported .kvm artifact layer '${kvmInput.layer}'`);
    }
    return {
      program,
      entry: kvmInput.entry || entry,
      typingMode: kvmInput.layer === "KVM" ? "specialized" : typingMode,
      relation: kvmInput.relation || null
    };
  }

  return {
    program: kvmInput,
    entry,
    typingMode,
    relation: null
  };
}

async function compileWasmArtifactFromKVM(kvmInput, options = {}) {
  resetTagIds();
  const normalized = normalizeKVMInput(kvmInput, options);
  const { program: kvmProgram, relation } = normalized;
  const entry = normalized.entry;
  const typingMode = normalized.typingMode;

  if (!kvmProgram || typeof kvmProgram !== "object" || Array.isArray(kvmProgram)) {
    throw new Error("Expected .kvm input to contain a JSON object of kVM functions");
  }

  const mainFunc = kvmProgram[entry];
  if (!mainFunc) {
    throw new Error(`No kVM entry function (${entry}) defined in program`);
  }
  if (!Array.isArray(mainFunc.inputPattern) || !Array.isArray(mainFunc.outputPattern)) {
    throw new Error(`kVM entry function (${entry}) is missing input/output patterns`);
  }

  const moduleWat = compileKVMModule(entry, kvmProgram);
  const moduleWatBody = moduleWat.wat;
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + moduleWatBody + "\n)";
  const metadata = {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    abi: "arena-v1",
    entry: moduleWat.entryName,
    relation,
    inputPattern: mainFunc.inputPattern,
    outputPattern: mainFunc.outputPattern,
    typing: classifyTyping(
      mainFunc.inputPattern,
      mainFunc.outputPattern,
      mainFunc.isConverged ? "converged" : "unknown",
      typingMode
    ),
    tags: getTagEntries()
  };
  return appendCustomSection(await compileWat(fullWat), METADATA_SECTION, JSON.stringify(metadata));
}

async function compileWasmArtifactFromObject(object, { entry = null, inputEnvelopePattern = null } = {}) {
  if (!object?.rels) {
    throw new Error("Expected .ko input to contain k object relations");
  }
  if (object.main == null) {
    throw new Error("Cannot compile a .klib library to WebAssembly without a main relation");
  }
  const mainRelName = entry || object.main || "__main__";
  let defs = { rels: object.rels, compileStats: object.compileStats };
  let typingMode = "generic";

  if (inputEnvelopePattern) {
    const mainRel = object.rels[mainRelName];
    if (!mainRel) throw new Error(`No main relation (${mainRelName}) defined in object`);
    const inputPattern = getPatternPropertyList(mainRel.typePatternGraph, mainRel.def.patterns[0]);
    const outputPattern = getPatternPropertyList(mainRel.typePatternGraph, mainRel.def.patterns[1]);
    if (classifyTyping(inputPattern, outputPattern).program === "polymorphic") {
      defs = annotateObjectWithInputFilter(object, mainRelName, inputPattern, inputEnvelopePattern);
      typingMode = "specialized";
    }
  }

  return compileWasmArtifactFromDefs(defs, mainRelName, { typingMode });
}

async function compileWasmArtifact(
  source,
  { libraries = [], exports = [], source: sourceName = null, inputEnvelopePattern = null } = {}
) {
  const preamble = buildExportPreamble(exports, libraries);
  const fullSource = preamble + source;
  const options = { libraries, ...(sourceName ? { source: sourceName } : {}) };
  let defs = annotate(fullSource, options);

  let typingMode = "generic";
  if (inputEnvelopePattern) {
    const mainRel = defs.rels.__main__;
    const inputPattern = getPatternPropertyList(mainRel.typePatternGraph, mainRel.def.patterns[0]);
    const outputPattern = getPatternPropertyList(mainRel.typePatternGraph, mainRel.def.patterns[1]);
    if (classifyTyping(inputPattern, outputPattern).program === "polymorphic") {
      defs = annotateSourceWithInputFilter(fullSource, inputPattern, inputEnvelopePattern, options);
      typingMode = "specialized";
    }
  }

  return compileWasmArtifactFromDefs(defs, "__main__", { typingMode });
}

function createTagRegistry(entries) {
  const tagToId = new Map();
  const idToTag = new Map();
  let nextId = 1;

  for (const entry of entries) {
    if (!entry || typeof entry.tag !== "string" || !Number.isInteger(entry.id) || entry.id < 1) {
      throw new Error("WebAssembly artifact metadata contains an invalid tag entry");
    }
    if (tagToId.has(entry.tag) || idToTag.has(entry.id)) {
      throw new Error("WebAssembly artifact metadata contains a duplicate tag entry");
    }
    tagToId.set(entry.tag, entry.id);
    idToTag.set(entry.id, entry.tag);
    nextId = Math.max(nextId, entry.id + 1);
  }

  return {
    getId(tag) {
      if (!tagToId.has(tag)) {
        tagToId.set(tag, nextId);
        idToTag.set(nextId, tag);
        nextId++;
      }
      return tagToId.get(tag);
    },
    getTag(id) {
      return idToTag.get(id) ?? null;
    }
  };
}

function patternForNode(patternPropertyList, patternNodeId) {
  if (!patternPropertyList || patternNodeId == null) return null;
  const subpattern = cloneSubpattern(patternPropertyList, patternNodeId);
  return subpattern?.[0]?.[0] === "any" ? null : subpattern;
}

function valueWithPatternNode(value, patternPropertyList, patternNodeId) {
  const pattern = patternForNode(patternPropertyList, patternNodeId);
  return pattern ? withPattern(value, pattern) : value;
}

function constrainArenaValue(value, patternPropertyList, patternNodeId) {
  const staticPattern = patternForNode(patternPropertyList, patternNodeId);
  if (!staticPattern) return value;
  if (!value.pattern) return withPattern(value, staticPattern);
  return withPattern(value, intersectInputEnvelope(staticPattern, value.pattern));
}

function wasmPtr(ptr) {
  return ptr >>> 0;
}

function readArenaValue(exports, ptr, pattern, patternNodeId, patternPropertyList, arenaValues, tags) {
  let result;
  const stack = [{
    ptr: wasmPtr(ptr),
    patternNodeId,
    assign(value) {
      result = value;
    }
  }];

  while (stack.length > 0) {
    const frame = stack.pop();
    const patternNode = pattern.nodes[frame.patternNodeId];
    const view = new DataView(exports.memory.buffer);

    if (arenaValues.has(frame.ptr)) {
      frame.assign(constrainArenaValue(arenaValues.get(frame.ptr), patternPropertyList, frame.patternNodeId));
      continue;
    }

    if (patternNode.kind === NODE_KIND.ANY) {
      throw new Error(`Cannot decode arena pointer ${frame.ptr} through an unconstrained output pattern`);
    }

    if (patternNode.kind === NODE_KIND.OPEN_PRODUCT || patternNode.kind === NODE_KIND.CLOSED_PRODUCT) {
      const N = view.getUint32(frame.ptr + 4, true);
      if (N !== patternNode.edges.length) {
        throw new Error(`Cannot decode product pointer ${frame.ptr}: arena field count ${N} does not match output pattern`);
      }
      const product = {};
      frame.assign(Value.product(product, patternForNode(patternPropertyList, frame.patternNodeId)));
      for (let i = N - 1; i >= 0; i--) {
        const edge = patternNode.edges[i];
        const offset = view.getUint32(frame.ptr + 8 + 4 * i, true);
        const childPtr = view.getUint32(frame.ptr + offset, true);
        stack.push({
          ptr: wasmPtr(childPtr),
          patternNodeId: edge.target,
          assign(value) {
            product[edge.label] = value;
          }
        });
      }
      continue;
    }

    if (patternNode.kind === NODE_KIND.OPEN_UNION || patternNode.kind === NODE_KIND.CLOSED_UNION) {
      const tag = tags.getTag(view.getUint32(frame.ptr + 4, true));
      const edge = patternNode.edges.find((candidate) => candidate.label === tag);
      if (!edge) {
        throw new Error(`Variant tag '${tag}' not found in output pattern edges`);
      }
      const payloadPtr = view.getUint32(frame.ptr + 8, true);
      const variant = Value.variant(tag, undefined, patternForNode(patternPropertyList, frame.patternNodeId));
      frame.assign(variant);
      stack.push({
        ptr: wasmPtr(payloadPtr),
        patternNodeId: edge.target,
        assign(value) {
          variant.value = value;
        }
      });
      continue;
    }

    throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
  }

  return result;
}

function writeValueToArena(exports, value, pattern, patternNodeId, arenaValues, tags, patternPropertyList = null) {
  let result;
  const stack = [{
    value,
    patternNodeId,
    assign(ptr) {
      result = ptr;
    }
  }];

  while (stack.length > 0) {
    const frame = stack.pop();

    if (frame.finishProduct) {
      const N = frame.childPtrs.length;
      const view = new DataView(exports.memory.buffer);
      view.setUint32(frame.ptr, 8 + 8 * N, true);
      view.setUint32(frame.ptr + 4, N, true);
      for (let i = 0; i < N; i++) {
        const offset = 8 + 4 * N + 4 * i;
        view.setUint32(frame.ptr + 8 + 4 * i, offset, true);
        view.setUint32(frame.ptr + offset, frame.childPtrs[i], true);
      }
      arenaValues.set(frame.ptr, valueWithPatternNode(frame.value, patternPropertyList, frame.patternNodeId));
      frame.assign(frame.ptr);
      continue;
    }

    if (frame.finishVariant) {
      const ptr = wasmPtr(exports.alloc(12));
      const view = new DataView(exports.memory.buffer);
      view.setUint32(ptr, 12, true);
      view.setUint32(ptr + 4, tags.getId(frame.value.tag), true);
      view.setUint32(ptr + 8, frame.childPtr, true);
      arenaValues.set(ptr, valueWithPatternNode(frame.value, patternPropertyList, frame.patternNodeId));
      frame.assign(ptr);
      continue;
    }

    const patternNode = frame.patternNodeId == null ? null : pattern.nodes[frame.patternNodeId];
    if (isProduct(frame.value)) {
      const isAny = patternNode == null || patternNode.kind === NODE_KIND.ANY;
      const isOpenProduct = patternNode?.kind === NODE_KIND.OPEN_PRODUCT;
      const isClosedProduct = patternNode?.kind === NODE_KIND.CLOSED_PRODUCT;
      if (!isAny && !isOpenProduct && !isClosedProduct) {
        throw new Error(`Cannot encode product value through input pattern node ${frame.patternNodeId}`);
      }

      const fields = isAny
        ? Object.keys(frame.value.product)
            .sort()
            .map((label) => ({ label, patternNodeId: frame.patternNodeId }))
        : patternNode.edges.map((edge) => ({ label: edge.label, patternNodeId: edge.target }));
      const fieldLabels = new Set(fields.map(({ label }) => label));
      if (isClosedProduct) {
        for (const label of Object.keys(frame.value.product)) {
          if (!fieldLabels.has(label)) {
            throw new Error(`Product field '${label}' is not present in input pattern node ${frame.patternNodeId}`);
          }
        }
      }
      for (const { label } of fields) {
        if (!Object.hasOwn(frame.value.product, label)) {
          throw new Error(`Product field '${label}' is required by input pattern node ${frame.patternNodeId}`);
        }
      }

      const childPtrs = new Array(fields.length);
      const ptr = wasmPtr(exports.alloc(8 + 8 * fields.length));
      stack.push({
        finishProduct: true,
        value: frame.value,
        patternNodeId: frame.patternNodeId,
        ptr,
        childPtrs,
        assign: frame.assign
      });
      for (let i = fields.length - 1; i >= 0; i--) {
        const field = fields[i];
        stack.push({
          value: frame.value.product[field.label],
          patternNodeId: field.patternNodeId,
          assign(ptr) {
            childPtrs[i] = ptr;
          }
        });
      }
      continue;
    }

    if (isVariant(frame.value)) {
      const isAny = patternNode == null || patternNode.kind === NODE_KIND.ANY;
      const isOpenUnion = patternNode?.kind === NODE_KIND.OPEN_UNION;
      const isClosedUnion = patternNode?.kind === NODE_KIND.CLOSED_UNION;
      if (!isAny && !isOpenUnion && !isClosedUnion) {
        throw new Error(`Cannot encode variant value through input pattern node ${frame.patternNodeId}`);
      }

      const edge = isAny ? null : patternNode.edges.find((candidate) => candidate.label === frame.value.tag);
      if (isClosedUnion && !edge) {
        throw new Error(`Variant tag '${frame.value.tag}' is not present in input pattern node ${frame.patternNodeId}`);
      }
      const variantFrame = {
        finishVariant: true,
        value: frame.value,
        patternNodeId: frame.patternNodeId,
        childPtr: null,
        assign: frame.assign
      };
      stack.push(variantFrame);
      stack.push({
        value: frame.value.value,
        patternNodeId: edge ? edge.target : null,
        assign(ptr) {
          variantFrame.childPtr = ptr;
        }
      });
      continue;
    }

    throw new Error(`Unsupported value type: ${frame.value}`);
  }

  return result;
}

async function runWasmArtifact(wasmBuffer, inputBuffer) {
  const module = await WebAssembly.compile(wasmBuffer);
  const metadata = metadataFromModule(module);
  const instance = await WebAssembly.instantiate(module);
  const exports = instance.exports;
  const tags = createTagRegistry(metadata.tags);
  const inputPattern = propertyListToPattern(metadata.inputPattern);
  const outputPattern = propertyListToPattern(metadata.outputPattern);
  const { pattern: valuePattern, value } = decodeWire(inputBuffer);
  if (!isMonomorphicPattern(metadata.inputPattern)) {
    validateInputEnvelope(metadata.inputPattern, valuePattern);
  }
  const arenaValues = new Map();
  const ptrIn = writeValueToArena(exports, value, inputPattern, 0, arenaValues, tags, metadata.inputPattern);
  const result = exports[metadata.entry](ptrIn);
  if (result[1] !== 1) {
    throw new Error("Wasm relation execution failed (returned false)");
  }
  const output = readArenaValue(exports, wasmPtr(result[0]), outputPattern, 0, metadata.outputPattern, arenaValues, tags);
  return encodeToWire(output, output.pattern);
}

export {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION,
  METADATA_SECTION,
  appendCustomSection,
  compileWasmArtifactFromKVM,
  compileWasmArtifactFromObject,
  compileWasmArtifact,
  metadataFromModule,
  readArenaValue,
  runWasmArtifact,
  wasmPtr,
  writeValueToArena
};

export default {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION,
  METADATA_SECTION,
  appendCustomSection,
  compileWasmArtifactFromKVM,
  compileWasmArtifactFromObject,
  compileWasmArtifact,
  metadataFromModule,
  readArenaValue,
  runWasmArtifact,
  wasmPtr,
  writeValueToArena
};
