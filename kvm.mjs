#!/usr/bin/env node
import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import { Value, composePattern, withPattern, isProduct, isVariant } from "./Value.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import {
  constrainWithPattern,
  intersectPatterns,
  projectionPattern,
  verify,
  run
} from "./run.mjs";
import { annotate } from "./index.mjs";
import { decodeWire, encodeToWire } from "./codecs/runtime/prefix-codec.mjs";
import { decodeObject, loadLibrary } from "./object.mjs";
import codes from "./codes.mjs";
import { isMainEntrypoint } from "./codecs/runtime/cli-entry.mjs";

class KVMBuilder {
  constructor(typePatternGraph) {
    this.typePatternGraph = typePatternGraph;
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
    if (!this.typePatternGraph || !exp.patterns) return null;
    const patternId = this.typePatternGraph.find(exp.patterns[index]);
    return patternToPropertyList(exportPatternGraph(this.typePatternGraph, patternId));
  }
}

function compile(exp, inputReg, builder) {
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
        label: exp.dot,
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
        tag: exp.div,
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
        tag: exp.vid,
        src: inputReg
      });
      return dest;
    }
    case "ref": {
      const dest = builder.nextReg();
      if (exp.ref.startsWith("_")) {
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
      for (const subExp of exp.comp) {
        currentReg = compile(subExp, currentReg, builder);
      }
      return currentReg;
    }
    case "product": {
      const dest = builder.nextReg();
      const branches = [];
      for (const { label, exp: fieldExp } of exp.product) {
        const branchBuilder = new KVMBuilder(builder.typePatternGraph);
        const branchInput = "%in";
        const branchOutput = compile(fieldExp, branchInput, branchBuilder);
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
      for (const branchExp of exp.union) {
        const branchBuilder = new KVMBuilder(builder.typePatternGraph);
        const branchInput = "%in";
        const branchOutput = compile(branchExp, branchInput, branchBuilder);
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
      throw new Error(`Unsupported AST operation: ${exp.op}`);
  }
}

export function lowerToKVM(relDef, name, options = {}) {
  const typePatternGraph = relDef.typePatternGraph || null;
  const builder = new KVMBuilder(typePatternGraph);
  const inputReg = "%in";

  let currentReg = inputReg;
  const inputPattern = builder.getStaticPattern(relDef.def, 0);
  if (inputPattern) {
    const guarded = builder.nextReg();
    builder.emit({ op: "guard_pattern", dest: guarded, src: currentReg, pattern: inputPattern, exp: relDef.def });
    currentReg = guarded;
  }

  const bodyOutput = compile(relDef.def, currentReg, builder);

  let finalReg = bodyOutput;
  const outputPattern = builder.getStaticPattern(relDef.def, 1);
  if (outputPattern) {
    const guarded = builder.nextReg();
    builder.emit({ op: "guard_pattern", dest: guarded, src: finalReg, pattern: outputPattern, exp: relDef.def });
    finalReg = guarded;
  }

  builder.emit({ op: "return", src: finalReg });

  return {
    name,
    inputPattern,
    outputPattern,
    isConverged: relDef.typeDerivation?.status === "converged",
    body: builder.instructions
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
        relDef._kvmFunc = lowerToKVM(relDef, inst.func);
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
      const val = registers.get(inst.src);
      const builtinFunc = run.builtin[inst.symbol];
      if (!builtinFunc) {
        throw new Error(`Unknown builtin: '${inst.symbol}'`);
      }
      if (!options.envelopeFree && inst.pattern) {
        try {
          const constrained = constrainWithPattern(val, inst.pattern, inst.exp);
          const res = builtinFunc(constrained);
          registers.set(inst.dest, res);
          return { type: "continue" };
        } catch (err) {
          throw err;
        }
      } else {
        const res = builtinFunc(val);
        registers.set(inst.dest, res);
        return { type: "continue" };
      }
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
  lowerToKVM,
  executeKVM
};

function usage() {
  const prog = argv[1] || "kvm.mjs";
  console.error(`Usage: node ${prog} [ options ] ( k-expr | -k file ) [ input-file ]`);
  console.error("Options:");
  console.error("  --lib file          Load one .klib dependency before compiling.");
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
    } else {
      break;
    }
  }

  let kScriptStr = (function (arg) {
    if (arg == null) {
      throw new Error("Missing script argument");
    }
    if (arg === "-k") {
      const fileArg = args.shift();
      if (!fileArg) throw new Error("-k requires a file argument");
      return fs.readFileSync(fileArg, "utf8");
    } else {
      return arg;
    }
  })(args.shift());

  const inputStream = (function (arg) {
    if (arg == null) {
      return stdin;
    }
    return fs.createReadStream(arg);
  })(args.shift());

  const defs = annotate(kScriptStr, { libraries });
  const mainRel = defs.rels.__main__;
  if (!mainRel) {
    throw new Error("No main relation (__main__) defined in script");
  }

  const kvmFunc = lowerToKVM(mainRel, "__main__");

  const buffer = [];
  inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
  inputStream.on("end", () => {
    try {
      const inputBuffer = Buffer.concat(buffer);
      const { pattern: inputPattern, value } = decodeWire(inputBuffer);
      const context = {
        rels: defs.rels,
        findCode: codes.find,
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
