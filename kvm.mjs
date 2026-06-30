#!/usr/bin/env node
import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import { Value, composePattern, withPattern, isProduct, isVariant } from "./Value.mjs";
import {
  constrainWithPattern,
  projectionPattern,
  verify
} from "./run.mjs";
import { decodeWire, encodeToWire } from "./codecs/runtime/prefix-codec.mjs";
import { compileObjectBuffer, decodeObject, loadLibrary } from "./object.mjs";
import codes from "./codes.mjs";
import { isMainEntrypoint } from "./codecs/runtime/cli-entry.mjs";
import { isIntrinsic, unsupportedIntrinsic } from "./intrinsics.mjs";
import { objectToKIRP, retypeObjectRelationForBackend } from "./kir.mjs";

export const KVM_FORMAT = "k-vm";
export const KVM_VERSION = 1;

const KVM_SINGLETON_INPUT_KINDS = new Set(["closed-product", "closed-union", "type"]);
const KIR_PATTERN_KIND_TO_PROPERTY_LIST_KIND = Object.freeze({
  any: "any",
  "open-product": "open-product",
  "closed-product": "closed-product",
  "open-union": "open-union",
  "closed-union": "closed-union"
});

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function buildExportPreamble(exports, libraries) {
  if (exports.length === 0) return "";
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
  for (const spec of exports) {
    const [libName, localName] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
    const hash = aliasMap[libName];
    if (!hash) throw new Error(`--export: '${libName}' not found in loaded libraries`);
    const body = hash.startsWith("@") ? hash.slice(1) : hash;
    lines.push(`${localName} = @${body};`);
  }
  return lines.join("\n") + "\n";
}

function kirFindCode(kir) {
  return (hash) => kir.codes?.[hash] || codes.find(hash);
}

function kirTypePatternKind(node, codesTable = {}) {
  const code = codesTable[node.code];
  if (code?.code === "product") return "closed-product";
  if (code?.code === "union") return "closed-union";
  throw new Error(`KIR type pattern ${node.code || "<missing>"} is missing a product/union code definition`);
}

function kirPatternToPropertyList(patternGraph, codesTable, rootId) {
  if (rootId == null) return null;
  const nodes = patternGraph?.nodes || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [];
  const idToIndex = new Map();

  function visit(nodeId) {
    if (idToIndex.has(nodeId)) return;
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`KIR pattern graph references missing node ${nodeId}`);

    idToIndex.set(nodeId, ordered.length);
    ordered.push(node);
    for (const edge of [...(node.edges || [])].sort((a, b) => a.label.localeCompare(b.label) || a.target - b.target)) {
      visit(edge.target);
    }
  }

  visit(rootId);

  return ordered.map((node) => {
    const kind = node.kind === "type"
      ? kirTypePatternKind(node, codesTable)
      : KIR_PATTERN_KIND_TO_PROPERTY_LIST_KIND[node.kind];
    if (!kind) throw new Error(`Unsupported KIR pattern kind: ${node.kind}`);
    const edges = [...(node.edges || [])]
      .sort((a, b) => a.label.localeCompare(b.label) || a.target - b.target)
      .map((edge) => [edge.label, idToIndex.get(edge.target)]);
    return [kind, edges];
  });
}

function isKIRRelation(relDef) {
  return relDef?.patternGraph && relDef?.body;
}

function objectRelationToKIRRelation(relDef, name, options = {}) {
  const kir = objectToKIRP({
    format: "k-object",
    codes: options.codes || {},
    rels: { [name]: relDef },
    relAlias: {},
    compileStats: {},
    meta: {},
    main: name
  });
  const relation = kir.rels[name];
  const codesTable = { ...codesFromTypePatternGraph(relDef.typePatternGraph, relation), ...(options.codes || {}) };
  return { relation, codesTable };
}

function codesFromTypePatternGraph(typePatternGraph, kirRelation) {
  if (!typePatternGraph || typeof typePatternGraph.findCode !== "function") return {};
  const result = {};
  for (const node of kirRelation.patternGraph?.nodes || []) {
    if (node.kind !== "type" || !node.code || result[node.code]) continue;
    const code = typePatternGraph.findCode(node.code);
    if (code) result[node.code] = code;
  }
  return result;
}

class KVMBuilder {
  constructor(patternGraph, codesTable = {}) {
    this.patternGraph = patternGraph;
    this.codes = codesTable;
    this.patternCache = new Map();
    this.regCount = 0;
    this.instructions = [];
  }

  nextReg() {
    return `%v${this.regCount++}`;
  }

  emit(inst) {
    this.instructions.push(inst);
  }

  getStaticPattern(exp, index) {
    if (!this.patternGraph || !exp.patterns) return null;
    return this.getPattern(exp.patterns[index]);
  }

  getPattern(patternId) {
    if (patternId == null) return null;
    if (!this.patternCache.has(patternId)) {
      this.patternCache.set(patternId, kirPatternToPropertyList(this.patternGraph, this.codes, patternId));
    }
    return this.patternCache.get(patternId);
  }
}

function compileKIRExp(exp, inputReg, builder) {
  switch (exp.op) {
    case "identity": {
      const dest = builder.nextReg();
      builder.emit({ op: "id", dest, src: inputReg });
      return dest;
    }
    case "empty": {
      builder.emit({ op: "fail" });
      return builder.nextReg();
    }
    case "filter": {
      const dest = builder.nextReg();
      builder.emit({
        op: "guard_pattern",
        dest,
        src: inputReg,
        pattern: builder.getStaticPattern(exp, 0),
        exp
      });
      return dest;
    }
    case "code": {
      const dest = builder.nextReg();
      builder.emit({
        op: "guard_code",
        dest,
        src: inputReg,
        code: exp.code,
        exp
      });
      return dest;
    }
    case "dot": {
      const dest = builder.nextReg();
      builder.emit({
        op: "project_field",
        dest,
        src: inputReg,
        label: exp.label,
        pattern: builder.getStaticPattern(exp, 1),
        exp
      });
      return dest;
    }
    case "div": {
      const dest = builder.nextReg();
      builder.emit({
        op: "project_variant",
        dest,
        src: inputReg,
        tag: exp.tag,
        pattern: builder.getStaticPattern(exp, 1),
        exp
      });
      return dest;
    }
    case "vid": {
      const dest = builder.nextReg();
      builder.emit({
        op: "make_variant",
        dest,
        tag: exp.tag,
        src: inputReg
      });
      return dest;
    }
    case "ref": {
      const dest = builder.nextReg();
      if (isIntrinsic(exp.ref)) {
        builder.emit({
          op: "call_intrinsic",
          dest,
          symbol: exp.ref,
          src: inputReg,
          pattern: builder.getStaticPattern(exp, 0),
          exp
        });
      } else {
        builder.emit({
          op: "call",
          dest,
          func: exp.ref,
          src: inputReg,
          exp
        });
      }
      return dest;
    }
    case "comp": {
      let currentReg = inputReg;
      const compInputPattern = builder.getStaticPattern(exp, 0);
      if (compInputPattern) {
        const guarded = builder.nextReg();
        builder.emit({ op: "guard_pattern", dest: guarded, src: currentReg, pattern: compInputPattern, exp });
        currentReg = guarded;
      }
      for (const subExp of exp.items) {
        currentReg = compileKIRExp(subExp, currentReg, builder);
      }
      return currentReg;
    }
    case "product": {
      const dest = builder.nextReg();
      const branches = [];
      for (const { label, expr: fieldExp } of exp.fields) {
        const branchBuilder = new KVMBuilder(builder.patternGraph, builder.codes);
        const branchInput = "%in";
        const branchOutput = compileKIRExp(fieldExp, branchInput, branchBuilder);
        branchBuilder.emit({ op: "return", src: branchOutput });
        branches.push({
          label,
          body: branchBuilder.instructions
        });
      }
      builder.emit({
        op: "product",
        dest,
        src: inputReg,
        branches,
        pattern: builder.getStaticPattern(exp, 1),
        exp
      });
      return dest;
    }
    case "union": {
      const dest = builder.nextReg();
      const branches = [];
      for (const branchExp of exp.items) {
        const branchBuilder = new KVMBuilder(builder.patternGraph, builder.codes);
        const branchInput = "%in";
        const branchOutput = compileKIRExp(branchExp, branchInput, branchBuilder);
        branchBuilder.emit({ op: "return", src: branchOutput });
        branches.push({
          body: branchBuilder.instructions
        });
      }
      builder.emit({
        op: "union",
        dest,
        src: inputReg,
        branches,
        exp
      });
      return dest;
    }
    default:
      throw new Error(`Unsupported KIR operation: ${exp.op}`);
  }
}

export function lowerKIRRelationToKVM(kirRel, name, options = {}) {
  const builder = new KVMBuilder(kirRel.patternGraph, options.codes || {});
  const inputReg = "%in";

  let currentReg = inputReg;
  const inputPattern = builder.getPattern(kirRel.inputPattern);
  if (inputPattern) {
    const guarded = builder.nextReg();
    builder.emit({ op: "guard_pattern", dest: guarded, src: currentReg, pattern: inputPattern, exp: kirRel.body });
    currentReg = guarded;
  }

  const bodyOutput = compileKIRExp(kirRel.body, currentReg, builder);

  let finalReg = bodyOutput;
  const outputPattern = builder.getPattern(kirRel.outputPattern);
  if (outputPattern) {
    const guarded = builder.nextReg();
    builder.emit({ op: "guard_pattern", dest: guarded, src: finalReg, pattern: outputPattern, exp: kirRel.body });
    finalReg = guarded;
  }

  builder.emit({ op: "return", src: finalReg });

  return {
    name,
    inputPattern,
    outputPattern,
    isConverged: kirRel.typeDerivation?.status === "converged",
    body: builder.instructions
  };
}

export function lowerKIRToKVM(kir) {
  if (kir?.format !== "k-ir" || kir.layer !== "KIR-P") {
    throw new Error("kVM lowering requires a KIR-P object");
  }
  const kvmProgram = {};
  for (const [name, relDef] of Object.entries(kir.rels || {})) {
    kvmProgram[name] = lowerKIRRelationToKVM(relDef, name, { codes: kir.codes || {} });
  }
  return kvmProgram;
}

export function lowerToKVM(relDef, name, options = {}) {
  if (isKIRRelation(relDef)) {
    return lowerKIRRelationToKVM(relDef, name, options);
  }
  const { relation, codesTable } = objectRelationToKIRRelation(relDef, name, options);
  return lowerKIRRelationToKVM(relation, name, { ...options, codes: codesTable });
}

export function isSingletonKVMInputPattern(pattern) {
  return Array.isArray(pattern)
    && pattern.length > 0
    && pattern.every((node) => Array.isArray(node) && KVM_SINGLETON_INPUT_KINDS.has(node[0]));
}

function assertSingletonKVMInputPattern(pattern) {
  if (!isSingletonKVMInputPattern(pattern)) {
    throw new Error(
      ".kvm emission requires a singleton input pattern; use a closed product/union pattern or a type/code input pattern"
    );
  }
}

export function objectToKVMArtifact(object, relationName, inputPattern, options = {}) {
  assertSingletonKVMInputPattern(inputPattern);
  const { relation, kir, entryName } = retypeObjectRelationForBackend(
    object,
    relationName || object.main,
    inputPattern,
    options
  );
  const entry = entryName;
  const functions = lowerKIRToKVM(kir);
  const entryFunc = functions[entry];
  if (!entryFunc) throw new Error(`Retyped kVM entry relation '${entry}' was not produced`);

  return {
    format: KVM_FORMAT,
    version: KVM_VERSION,
    layer: "KVM",
    sourceFormat: object.format,
    relation,
    entry,
    inputPattern: entryFunc.inputPattern,
    outputPattern: entryFunc.outputPattern,
    isConverged: entryFunc.isConverged,
    functions,
    kir
  };
}

function executeBlock(instructions, inputVal, context) {
  const registers = new Map();
  registers.set("%in", inputVal);

  for (const inst of instructions) {
    const res = executeInstruction(inst, registers, context);
    if (res === undefined) {
      return undefined;
    }
    if (res.type === "return") {
      return res.value;
    }
  }
  return undefined;
}

function executeInstruction(inst, registers, context) {
  const options = context.options || {};
  switch (inst.op) {
    case "id": {
      registers.set(inst.dest, registers.get(inst.src));
      return { type: "continue" };
    }
    case "fail": {
      return undefined;
    }
    case "guard_pattern": {
      const val = registers.get(inst.src);
      if (options.envelopeFree) {
        registers.set(inst.dest, val);
        return { type: "continue" };
      }
      try {
        const constrained = constrainWithPattern(val, inst.pattern, inst.exp);
        registers.set(inst.dest, constrained);
        return { type: "continue" };
      } catch (err) {
        if (err instanceof TypeError) {
          throw err;
        }
        return undefined;
      }
    }
    case "guard_code": {
      const val = registers.get(inst.src);
      if (options.envelopeFree) {
        registers.set(inst.dest, val);
        return { type: "continue" };
      }
      if (verify(context.findCode, inst.code, val)) {
        registers.set(inst.dest, val);
        return { type: "continue" };
      }
      return undefined;
    }
    case "project_field": {
      const val = registers.get(inst.src);
      if (!isProduct(val)) return undefined;
      const fieldVal = val.product[inst.label];
      if (fieldVal === undefined) return undefined;

      if (options.envelopeFree) {
        registers.set(inst.dest, fieldVal);
      } else {
        const pattern = projectionPattern(inst.pattern, val.pattern, inst.label, inst.exp);
        registers.set(inst.dest, withPattern(fieldVal, pattern));
      }
      return { type: "continue" };
    }
    case "project_variant": {
      const val = registers.get(inst.src);
      if (!isVariant(val) || val.tag !== inst.tag) return undefined;

      if (options.envelopeFree) {
        registers.set(inst.dest, val.value);
      } else {
        const pattern = projectionPattern(inst.pattern, val.pattern, inst.tag, inst.exp);
        registers.set(inst.dest, withPattern(val.value, pattern));
      }
      return { type: "continue" };
    }
    case "make_variant": {
      const val = registers.get(inst.src);
      if (options.envelopeFree) {
        registers.set(inst.dest, Value.variant(inst.tag, val));
      } else {
        registers.set(
          inst.dest,
          Value.variant(inst.tag, val, composePattern("open-union", [[inst.tag, val.pattern]]))
        );
      }
      return { type: "continue" };
    }
    case "call": {
      const val = registers.get(inst.src);
      const relDef = context.rels[inst.func];
      if (!relDef) {
        throw new Error(`Unknown ref: '${inst.func}'`);
      }
      if (options.requireConverged && relDef.typeDerivation?.status !== "converged") {
        throw new Error(`Cannot run '${inst.func}' without envelopes: type derivation is not converged`);
      }
      if (options.trace) {
        console.log(`[Trace] Calling ${inst.func} with:`, val ? val.toString() : "null");
      }
      if (!relDef._kvmFunc) {
        relDef._kvmFunc = lowerToKVM(relDef, inst.func, { codes: context.codes || {} });
      }
      const res = executeKVM(relDef._kvmFunc, val, context);
      if (options.trace) {
        console.log(`[Trace] Returned from ${inst.func} ->:`, res ? res.toString() : "fail");
      }
      if (res === undefined) return undefined;
      registers.set(inst.dest, res);
      return { type: "continue" };
    }
    case "call_intrinsic": {
      throw unsupportedIntrinsic("kVM interpreter", inst.symbol);
    }
    case "product": {
      const val = registers.get(inst.src);
      const result = {};
      const patternEntries = [];
      for (const branch of inst.branches) {
        const branchRes = executeBlock(branch.body, val, context);
        if (branchRes === undefined) return undefined;
        result[branch.label] = branchRes;
        if (!options.envelopeFree) {
          patternEntries.push([branch.label, branchRes.pattern]);
        }
      }
      let productValue;
      if (options.envelopeFree) {
        productValue = Value.product(result);
      } else {
        const staticOutputPattern = inst.pattern;
        if (staticOutputPattern) {
          productValue = Value.product(result, staticOutputPattern);
        } else {
          productValue = Value.product(result, composePattern("closed-product", patternEntries));
        }
      }
      registers.set(inst.dest, productValue);
      return { type: "continue" };
    }
    case "union": {
      const val = registers.get(inst.src);
      for (const branch of inst.branches) {
        const branchRes = executeBlock(branch.body, val, context);
        if (branchRes !== undefined) {
          registers.set(inst.dest, branchRes);
          return { type: "continue" };
        }
      }
      return undefined;
    }
    case "return": {
      return { type: "return", value: registers.get(inst.src) };
    }
    default:
      throw new Error(`Unknown instruction op: ${inst.op}`);
  }
}

export function executeKVM(kvmFunc, inputVal, context) {
  const options = context.options || {};
  if (options.requireConverged && !kvmFunc.isConverged) {
    throw new Error(`Cannot run '${kvmFunc.name}' without envelopes: type derivation is not converged`);
  }

  const result = executeBlock(kvmFunc.body, inputVal, context);
  if (result === undefined) return undefined;

  if (options.envelopeFree && kvmFunc.isConverged) {
    return withPattern(result, kvmFunc.outputPattern);
  }
  return result;
}

export default {
  KVM_FORMAT,
  KVM_VERSION,
  lowerToKVM,
  lowerKIRRelationToKVM,
  lowerKIRToKVM,
  executeKVM,
  isSingletonKVMInputPattern,
  objectToKVMArtifact
};

function usage() {
  const prog = argv[1] || "kvm.mjs";
  console.error(`Usage: node ${prog} [ options ] ( k-expr | input-file ) [ input-file ]`);
  console.error("Options:");
  console.error("  --lib file          Load one .klib dependency before compiling.");
  console.error("  --export spec       Export a library alias into scope. 'name' or 'libname:localname'. May be repeated.");
  console.error("  --envelope-free     Run the interpreter in envelope-free mode.");
  console.error("  -h, --help          Show this help.");
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return exit(0);
  }

  let envelopeFree = false;
  const libraries = [];
  const exports = [];

  // Parse options
  while (args.length > 0) {
    if (args[0] === "--envelope-free") {
      envelopeFree = true;
      args.shift();
    } else if (args[0] === "--lib") {
      args.shift();
      const libPath = args.shift();
      if (!libPath) throw new Error("--lib requires a file argument");
      if (libraries.length > 0) throw new Error("--lib may be specified at most once");
      const libBuffer = fs.readFileSync(libPath);
      libraries.push(loadLibrary(decodeObject(libBuffer)));
    } else if (args[0] === "--export") {
      args.shift();
      const spec = args.shift();
      if (!spec) throw new Error("--export requires a spec argument");
      exports.push(spec);
    } else if (args[0].startsWith("--")) {
      throw new Error(`Unknown option: ${args[0]}`);
    } else {
      break;
    }
  }

  const programInput = (function (arg) {
    if (arg == null) {
      throw new Error("Missing script argument");
    }
    if (arg === "-k") {
      throw new Error("-k is no longer supported; pass the source/object file path directly");
    }
    if (isFile(arg)) {
      const buffer = fs.readFileSync(arg);
      try {
        const object = decodeObject(buffer);
        if (object.main == null) {
          throw new Error("Cannot run a .klib library without a main relation; load it with --lib.");
        }
        return { kind: "object", object };
      } catch (error) {
        if (error.message === "Cannot run a .klib library without a main relation; load it with --lib.") {
          throw error;
        }
        return {
          kind: "source",
          source: buildExportPreamble(exports, libraries) + buffer.toString("utf8")
        };
      }
    }
    return { kind: "source", source: buildExportPreamble(exports, libraries) + arg };
  })(args.shift());

  const inputStream = (function (arg) {
    if (arg == null) {
      return stdin;
    }
    return fs.createReadStream(arg);
  })(args.shift());

  if (args.length > 0) {
    throw new Error(`Unexpected argument: ${args[0]}`);
  }

  const object = programInput.kind === "object"
    ? programInput.object
    : decodeObject(compileObjectBuffer(programInput.source, { libraries }));
  const kir = objectToKIRP(object);
  const mainRelName = kir.main;
  const mainRel = kir.rels[mainRelName];
  if (!mainRel) {
    throw new Error(`No main relation (${mainRelName}) defined in script`);
  }

  const kvmFunc = lowerKIRRelationToKVM(mainRel, mainRelName, { codes: kir.codes });

  const buffer = [];
  inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
  inputStream.on("end", () => {
    try {
      const inputBuffer = Buffer.concat(buffer);
      const { pattern: inputPattern, value } = decodeWire(inputBuffer);
      const context = {
        rels: kir.rels,
        codes: kir.codes,
        findCode: kirFindCode(kir),
        options: {
          envelopeFree
        }
      };
      const result = executeKVM(kvmFunc, value, context);
      if (result === undefined) {
        throw new Error("kVM expression evaluated to undefined");
      }
      stdout.write(encodeToWire(result, result.pattern));
    } catch (error) {
      console.error(error.stack || error.message || String(error));
      exit(1);
    }
  });
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    usage();
    exit(1);
  });
}
