// pkir.mjs: Polymorphic K Intermediate Representation (PKIR)
// State-indexed, slot-addressed intermediate representation for
// polymorphic relations in K. Enables direct execution with AccessTable
// and fast specialization to monomorphic machine code.

import { buildAccessTable } from "./access-table.mjs";
import { Value, isProduct, isVariant } from "./Value.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";

export const PKIR_FORMAT = "pk-ir";
export const PKIR_VERSION = 1;

/**
 * Instruction builder for PKIR compilation.
 */
class PKIRBuilder {
  constructor(patternGraph, relName) {
    this.patternGraph = patternGraph;
    this.relName = relName;
    this.regCount = 0;
    this.instructions = [];
    // Access profile per pattern state:
    // state -> { fields: string[], variants: string[] }
    this.accessProfile = new Map();
  }

  nextReg() {
    return `%v${this.regCount++}`;
  }

  emit(inst) {
    this.instructions.push(inst);
  }

  getProfile(state) {
    if (!this.accessProfile.has(state)) {
      this.accessProfile.set(state, { fields: [], variants: [] });
    }
    return this.accessProfile.get(state);
  }

  registerFieldAccess(state, label) {
    const prof = this.getProfile(state);
    let slot = prof.fields.indexOf(label);
    if (slot === -1) {
      slot = prof.fields.length;
      prof.fields.push(label);
    }
    return slot;
  }

  registerVariantMatch(state, tag) {
    const prof = this.getProfile(state);
    let branch = prof.variants.indexOf(tag);
    if (branch === -1) {
      branch = prof.variants.length;
      prof.variants.push(tag);
    }
    return branch;
  }
}

/**
 * Lowers a relational expression AST into PKIR instructions.
 */
function compileExpToPKIR(exp, inputReg, builder) {
  if (!exp) return inputReg;

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

    case "dot": {
      const dest = builder.nextReg();
      const state = exp.patterns?.[0] ?? 0;
      const slot = builder.registerFieldAccess(state, exp.dot || exp.label);
      builder.emit({
        op: "project_slot",
        dest,
        src: inputReg,
        state,
        slot,
        label: exp.dot || exp.label
      });
      return dest;
    }

    case "div": {
      const dest = builder.nextReg();
      const state = exp.patterns?.[0] ?? 0;
      const tag = exp.div || exp.tag;
      const branchId = builder.registerVariantMatch(state, tag);
      builder.emit({
        op: "match_variant",
        dest,
        src: inputReg,
        state,
        tag,
        branchId
      });
      return dest;
    }

    case "vid": {
      const dest = builder.nextReg();
      const tag = exp.vid || exp.tag;
      builder.emit({
        op: "make_variant",
        dest,
        src: inputReg,
        tag
      });
      return dest;
    }

    case "comp": {
      let currentReg = inputReg;
      for (const child of exp.comp || exp.items || []) {
        currentReg = compileExpToPKIR(child, currentReg, builder);
      }
      return currentReg;
    }

    case "union": {
      const dest = builder.nextReg();
      const branches = [];
      for (const child of exp.union || exp.items || []) {
        const branchBuilder = new PKIRBuilder(
          builder.patternGraph,
          builder.relName
        );
        branchBuilder.regCount = builder.regCount;
        const outReg = compileExpToPKIR(child, inputReg, branchBuilder);
        builder.regCount = branchBuilder.regCount;
        // Merge child profiles into parent
        for (const [st, p] of branchBuilder.accessProfile.entries()) {
          p.fields.forEach((f) => builder.registerFieldAccess(st, f));
          p.variants.forEach((v) => builder.registerVariantMatch(st, v));
        }
        branches.push({
          instructions: branchBuilder.instructions,
          outReg
        });
      }
      builder.emit({
        op: "union",
        dest,
        src: inputReg,
        branches
      });
      return dest;
    }

    case "product": {
      const dest = builder.nextReg();
      const fieldEntries = [];
      const fieldsList = exp.product || exp.fields || [];

      for (const field of fieldsList) {
        const label = field.label;
        const childExp = field.exp || field.expr;
        const branchBuilder = new PKIRBuilder(
          builder.patternGraph,
          builder.relName
        );
        branchBuilder.regCount = builder.regCount;
        const outReg = compileExpToPKIR(childExp, inputReg, branchBuilder);
        builder.regCount = branchBuilder.regCount;

        for (const [st, p] of branchBuilder.accessProfile.entries()) {
          p.fields.forEach((f) => builder.registerFieldAccess(st, f));
          p.variants.forEach((v) => builder.registerVariantMatch(st, v));
        }

        fieldEntries.push({
          label,
          instructions: branchBuilder.instructions,
          outReg
        });
      }

      builder.emit({
        op: "product",
        dest,
        src: inputReg,
        fields: fieldEntries
      });
      return dest;
    }

    case "ref": {
      const dest = builder.nextReg();
      builder.emit({
        op: "call_rel",
        dest,
        ref: exp.ref,
        src: inputReg
      });
      return dest;
    }

    case "filter": {
      const dest = builder.nextReg();
      builder.emit({
        op: "filter",
        dest,
        src: inputReg,
        filter: exp.filter
      });
      return dest;
    }

    default:
      throw new Error(`Unsupported expression op in PKIR compiler: ${exp.op}`);
  }
}

/**
 * Compiles a relation definition into a PKIR relation artifact.
 */
export function compileRelationToPKIR(relDef, relName = "rel") {
  const patternGraph = relDef.patternGraph || relDef.typePatternGraph;
  const builder = new PKIRBuilder(patternGraph, relName);
  const inputReg = "%v0";
  builder.regCount = 1;

  const bodyAst = relDef.def || relDef.body;
  const outputReg = compileExpToPKIR(bodyAst, inputReg, builder);

  const [inPat, outPat] = bodyAst?.patterns || [0, 0];

  return {
    format: PKIR_FORMAT,
    version: PKIR_VERSION,
    name: relName,
    inputReg,
    outputReg,
    inputPattern: inPat,
    outputPattern: outPat,
    patternGraph,
    accessProfile: Object.fromEntries(builder.accessProfile),
    instructions: builder.instructions
  };
}

/**
 * Creates a mock/arena KVal word representation for runtime execution.
 */
export function createMaterializedKVal(tag, words, state = 0) {
  return {
    repr: "materialized",
    state,
    tag, // numeric discriminator or null for product
    words // array of child KVal references
  };
}

/**
 * Converts a JS Value (from Value.mjs) into a KVal reference.
 */
export function valueToKVal(value, state = 0) {
  if (value == null) return null;
  if (isVariant(value)) {
    return {
      repr: "materialized",
      state,
      tag: value.tag,
      words: [valueToKVal(value.value, state)]
    };
  }
  if (isProduct(value)) {
    // Sort field entries alphabetically for canonical physical layout
    const entries = Object.entries(value.product || {}).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return {
      repr: "materialized",
      state,
      tag: null,
      fieldNames: entries.map(([k]) => k),
      words: entries.map(([_, v]) => valueToKVal(v, state))
    };
  }
  // Primitive or unit
  return {
    repr: "materialized",
    state,
    tag: null,
    words: []
  };
}

/**
 * Converts a KVal reference back into a Value or JS object.
 */
export function kvalToValue(kval) {
  if (!kval) return null;
  if (kval.tag != null) {
    const childVal = kval.words[0] ? kvalToValue(kval.words[0]) : {};
    return Value.variant(kval.tag, childVal);
  }
  if (kval.fieldNames && Array.isArray(kval.words)) {
    const obj = {};
    kval.fieldNames.forEach((name, i) => {
      obj[name] = kvalToValue(kval.words[i]);
    });
    return Value.product(obj);
  }
  return Value.product({});
}

/**
 * Executes a list of PKIR instructions on a KVal reference using
 * an AccessTable. Implements pure partial function semantics.
 */
export function executePKIR(pkirFunc, inputVal, accessTable, context = {}) {
  const regs = new Map();
  regs.set(pkirFunc.inputReg, inputVal);

  function evalInstructions(instructions) {
    for (const inst of instructions) {
      switch (inst.op) {
        case "id": {
          const val = regs.get(inst.src);
          regs.set(inst.dest, val);
          break;
        }

        case "fail": {
          return false;
        }

        case "project_slot": {
          const src = regs.get(inst.src);
          if (!src || !src.words) return false;

          let byteOffset, childState;
          if (accessTable) {
            const meta = accessTable.resolveField(src.state, inst.label);
            byteOffset = meta.byteOffset;
            childState = meta.childState;
          } else {
            // Direct physical index fallback
            const idx = src.fieldNames
              ? src.fieldNames.indexOf(inst.label)
              : inst.slot;
            if (idx === -1) return false;
            byteOffset = idx * 8;
            childState = src.state;
          }

          const wordIdx = Math.floor(byteOffset / 8);
          const childVal = src.words[wordIdx];
          if (!childVal) return false;

          // Propagate new state to projected child
          regs.set(inst.dest, { ...childVal, state: childState });
          break;
        }

        case "project_offset": {
          const src = regs.get(inst.src);
          if (!src || !src.words) return false;
          const wordIdx = Math.floor(inst.offset / 8);
          const childVal = src.words[wordIdx];
          if (!childVal) return false;
          regs.set(inst.dest, { ...childVal, state: inst.childState });
          break;
        }

        case "match_variant": {
          const src = regs.get(inst.src);
          if (!src || src.tag == null) return false;

          let branchId, childState;
          if (accessTable) {
            const meta = accessTable.resolveVariant(src.state, src.tag);
            branchId = meta.branchId;
            childState = meta.childState;
          } else {
            branchId = src.tag === inst.tag ? inst.branchId : -1;
            childState = src.state;
          }

          if (branchId !== inst.branchId && src.tag !== inst.tag) {
            return false;
          }

          const childVal = src.words[0] || {
            repr: "materialized",
            state: childState,
            tag: null,
            words: []
          };
          regs.set(inst.dest, { ...childVal, state: childState });
          break;
        }

        case "match_tag_imm": {
          const src = regs.get(inst.src);
          if (!src || src.tag == null) return false;
          if (src.tag !== inst.tag) return false;
          const childVal = src.words[0] || {
            repr: "materialized",
            state: inst.childState,
            tag: null,
            words: []
          };
          regs.set(inst.dest, { ...childVal, state: inst.childState });
          break;
        }

        case "make_variant": {
          const src = regs.get(inst.src);
          const varVal = {
            repr: "materialized",
            state: 0,
            tag: inst.tag,
            words: [src]
          };
          regs.set(inst.dest, varVal);
          break;
        }

        case "product": {
          const src = regs.get(inst.src);
          const words = [];
          const fieldNames = [];

          for (const field of inst.fields) {
            const savedRegs = new Map(regs);
            const ok = evalInstructions(field.instructions);
            if (!ok) {
              regs.clear();
              for (const [k, v] of savedRegs) regs.set(k, v);
              return false;
            }
            const fieldVal = regs.get(field.outReg);
            words.push(fieldVal);
            fieldNames.push(field.label);
          }

          regs.set(inst.dest, {
            repr: "materialized",
            state: 0,
            tag: null,
            fieldNames,
            words
          });
          break;
        }

        case "union": {
          let matched = false;
          const savedRegs = new Map(regs);

          for (const branch of inst.branches) {
            regs.clear();
            for (const [k, v] of savedRegs) regs.set(k, v);

            const ok = evalInstructions(branch.instructions);
            if (ok) {
              const res = regs.get(branch.outReg);
              regs.clear();
              for (const [k, v] of savedRegs) regs.set(k, v);
              regs.set(inst.dest, res);
              matched = true;
              break;
            }
          }

          if (!matched) return false;
          break;
        }

        case "call_rel": {
          const src = regs.get(inst.src);
          const targetRel = context.rels?.[inst.ref];
          if (!targetRel) {
            throw new Error(`Relation not found in context: ${inst.ref}`);
          }
          const res = executePKIR(targetRel, src, accessTable, context);
          if (res == null) return false;
          regs.set(inst.dest, res);
          break;
        }

        case "filter": {
          const src = regs.get(inst.src);
          regs.set(inst.dest, src);
          break;
        }

        default:
          throw new Error(`Unknown PKIR instruction opcode: ${inst.op}`);
      }
    }
    return true;
  }

  const ok = evalInstructions(pkirFunc.instructions);
  return ok ? regs.get(pkirFunc.outputReg) : null;
}

/**
 * Specializes a PKIR function by baking an AccessTable into monomorphic
 * machine instructions with static offsets and pruned dead branches.
 */
export function specializePKIR(pkirFunc, accessTable) {
  function specializeList(instructions, initialRegStates) {
    const regStates = new Map(initialRegStates);
    const result = [];

    for (const inst of instructions) {
      switch (inst.op) {
        case "id": {
          const st = regStates.get(inst.src);
          if (st != null) regStates.set(inst.dest, st);
          result.push({ ...inst });
          break;
        }

        case "project_slot": {
          const srcState = regStates.get(inst.src) ?? 0;
          let meta = null;
          try {
            meta = accessTable.resolveField(srcState, inst.label);
          } catch {
            meta = null;
          }

          if (meta) {
            regStates.set(inst.dest, meta.childState);
            result.push({
              op: "project_offset",
              dest: inst.dest,
              src: inst.src,
              offset: meta.byteOffset,
              skipCount: meta.skipCount,
              childState: meta.childState,
              label: inst.label
            });
          } else {
            result.push({ op: "fail" });
          }
          break;
        }

        case "match_variant": {
          const srcState = regStates.get(inst.src) ?? 0;
          let meta = null;
          try {
            meta = accessTable.resolveVariant(srcState, inst.tag);
          } catch {
            meta = null;
          }

          if (meta && meta.branchId !== -1) {
            regStates.set(inst.dest, meta.childState);
            result.push({
              op: "match_tag_imm",
              dest: inst.dest,
              src: inst.src,
              tagId: meta.tagId,
              branchId: meta.branchId,
              childState: meta.childState,
              tag: inst.tag
            });
          } else {
            // Disjoint variant: cannot match under schema S; prune
            result.push({ op: "fail" });
          }
          break;
        }

        case "make_variant": {
          regStates.set(inst.dest, 0);
          result.push({ ...inst });
          break;
        }

        case "union": {
          const specializedBranches = [];
          for (const b of inst.branches) {
            const branchInsts = specializeList(b.instructions, regStates);
            if (branchInsts.length > 0 && branchInsts[0].op === "fail") {
              // Dead branch eliminated under schema S
              continue;
            }
            specializedBranches.push({
              instructions: branchInsts,
              outReg: b.outReg
            });
          }
          result.push({
            ...inst,
            branches: specializedBranches
          });
          break;
        }

        case "product": {
          const specializedFields = inst.fields.map((f) => ({
            ...f,
            instructions: specializeList(f.instructions, regStates)
          }));
          result.push({
            ...inst,
            fields: specializedFields
          });
          break;
        }

        default:
          result.push({ ...inst });
          break;
      }
    }
    return result;
  }

  const initialStates = new Map();
  initialStates.set(pkirFunc.inputReg, accessTable.rootState);

  return {
    ...pkirFunc,
    isSpecialized: true,
    instructions: specializeList(pkirFunc.instructions, initialStates)
  };
}

/**
 * Lowers a PKIR function into a KVM function representation compatible
 * with WebAssembly and machine code generators.
 */
export function lowerPKIRToKVM(pkir) {
  function convert(insts, branchInReg = null) {
    function mapReg(r) {
      if (branchInReg != null && r === branchInReg) return "%in";
      if (r === pkir.inputReg) return "%in";
      return r;
    }

    const res = [];
    for (const inst of insts) {
      switch (inst.op) {
        case "id":
        case "filter":
          res.push({
            op: "id",
            dest: mapReg(inst.dest),
            src: mapReg(inst.src)
          });
          break;
        case "fail":
          res.push({ op: "fail" });
          break;
        case "project_slot":
        case "project_offset":
          res.push({
            op: "project_field",
            dest: mapReg(inst.dest),
            src: mapReg(inst.src),
            label: inst.label,
            slot: inst.slot ?? inst.skipCount
          });
          break;
        case "match_variant":
        case "match_tag_imm":
          res.push({
            op: "project_variant",
            dest: mapReg(inst.dest),
            src: mapReg(inst.src),
            tag: inst.tag
          });
          break;
        case "make_variant":
          res.push({
            op: "make_variant",
            dest: mapReg(inst.dest),
            src: mapReg(inst.src),
            tag: inst.tag
          });
          break;
        case "product":
          res.push({
            op: "product",
            dest: mapReg(inst.dest),
            src: mapReg(inst.src),
            branches: inst.fields.map((f) => {
              const body = convert(f.instructions, inst.src);
              const branchOut = f.outReg === inst.src
                ? "%in"
                : mapReg(f.outReg);
              body.push({ op: "return", src: branchOut });
              return { label: f.label, body };
            })
          });
          break;
        case "union":
          res.push({
            op: "union",
            dest: mapReg(inst.dest),
            src: mapReg(inst.src),
            branches: inst.branches.map((b) => {
              const body = convert(b.instructions, inst.src);
              const branchOut = b.outReg === inst.src
                ? "%in"
                : mapReg(b.outReg);
              body.push({ op: "return", src: branchOut });
              return { body };
            })
          });
          break;
        case "call_rel":
          res.push({
            op: "call",
            dest: mapReg(inst.dest),
            func: inst.ref,
            src: mapReg(inst.src)
          });
          break;
      }
    }
    return res;
  }

  const body = convert(pkir.instructions);
  body.push({
    op: "return",
    src: pkir.outputReg === pkir.inputReg ? "%in" : pkir.outputReg
  });

  let inputPattern = [["any", []]];
  let outputPattern = [["any", []]];
  const graph = pkir.patternGraph;
  if (graph) {
    if (pkir.inputPattern != null) {
      try {
        const inId = graph.find(pkir.inputPattern);
        inputPattern = patternToPropertyList(
          exportPatternGraph(graph, inId)
        );
      } catch {}
    }
    if (pkir.outputPattern != null) {
      try {
        const outId = graph.find(pkir.outputPattern);
        outputPattern = patternToPropertyList(
          exportPatternGraph(graph, outId)
        );
      } catch {}
    }
  }

  return {
    name: pkir.name,
    body,
    inputPattern,
    outputPattern,
    typePatternGraph: graph
  };
}
