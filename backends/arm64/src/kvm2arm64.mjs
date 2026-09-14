import {
  exportPatternGraph,
  lowerToKVM,
  patternToPropertyList
} from "../../../backend-api.mjs";

const tagMap = new Map();
let nextTagId = 1;

export function getTagId(tag) {
  if (!tagMap.has(tag)) {
    tagMap.set(tag, nextTagId++);
  }
  return tagMap.get(tag);
}

export function getTagFromId(tagId) {
  for (const [tag, id] of tagMap.entries()) {
    if (id === tagId) return tag;
  }
  return null;
}

export function getTagEntries() {
  return [...tagMap.entries()]
    .map(([tag, id]) => ({ tag, id }))
    .sort((a, b) => a.id - b.id);
}

export function resetTagIds() {
  tagMap.clear();
  nextTagId = 1;
}

export function registerPatternTags(pattern) {
  if (!Array.isArray(pattern)) return;
  for (const node of pattern) {
    if (!Array.isArray(node)) continue;
    const [kind, edges] = node;
    if (kind === "open-union" || kind === "closed-union") {
      if (Array.isArray(edges)) {
        for (const edge of edges) {
          if (Array.isArray(edge) && edge[0] != null) {
            getTagId(String(edge[0]));
          }
        }
      }
    }
  }
}

export function collectAllTags(kvmProgram = {}, inputPattern = null, outputPattern = null) {
  if (inputPattern) registerPatternTags(inputPattern);
  if (outputPattern) registerPatternTags(outputPattern);

  function scanInsts(insts) {
    if (!Array.isArray(insts)) return;
    for (const inst of insts) {
      if (inst.tag) getTagId(String(inst.tag));
      if (inst.pattern) registerPatternTags(inst.pattern);
      if (inst.branches) {
        for (const br of inst.branches) {
          scanInsts(br.body);
        }
      }
    }
  }

  for (const func of Object.values(kvmProgram)) {
    if (func.body) scanInsts(func.body);
    if (func.inputPattern) registerPatternTags(func.inputPattern);
    if (func.outputPattern) registerPatternTags(func.outputPattern);
  }
}

function cloneInstructions(insts) {
  return insts.map(inst => {
    const cloned = { ...inst };
    if (inst.branches) {
      cloned.branches = inst.branches.map(br => ({
        label: br.label,
        body: cloneInstructions(br.body)
      }));
    }
    return cloned;
  });
}

function renameRegisters(insts, prefix) {
  const rename = (r) => {
    if (!r) return r;
    if (r === "%in" || r === "in") return r;
    if (r.startsWith("%")) return "%" + prefix + r.slice(1);
    if (r.startsWith("$")) return "$" + prefix + r.slice(1);
    return r;
  };

  for (const inst of insts) {
    if (inst.dest) inst.dest = rename(inst.dest);
    if (inst.src) inst.src = rename(inst.src);
    if (inst.branches) {
      inst.branches.forEach((branch, i) => {
        const nextPrefix = `${prefix}b${i}_`;
        renameRegisters(branch.body, nextPrefix);
      });
    }
  }
}

export function lowerToARM64(relDef, name, options = {}) {
  const kvmFuncOriginal = relDef.body ? relDef : lowerToKVM(relDef, name, options);
  const kvmFunc = {
    ...kvmFuncOriginal,
    body: cloneInstructions(kvmFuncOriginal.body)
  };
  renameRegisters(kvmFunc.body, "");
  const typePatternGraph = relDef.typePatternGraph || kvmFunc.typePatternGraph;

  const cleanReg = (rName) => rName.replace("%", "").replace("$", "");
  const registerPatterns = new Map();
  if (Array.isArray(kvmFunc.inputPattern)) {
    registerPatterns.set("in", kvmFunc.inputPattern);
  }

  const mappedReg = (rName, inputMap = {}) => {
    const raw = cleanReg(rName);
    return inputMap[raw] || raw;
  };

  const setPattern = (rName, pattern) => {
    if (rName && Array.isArray(pattern)) {
      registerPatterns.set(cleanReg(rName), pattern);
    }
  };

  const getPattern = (rName, inputMap = {}) => registerPatterns.get(mappedReg(rName, inputMap));

  const getProductEdges = (inst, inputMap) => {
    if (typePatternGraph && inst.exp?.patterns?.[0] != null) {
      const inputPatternId = inst.exp.patterns[0];
      const inputPatternNodeId = typePatternGraph.find(inputPatternId);
      const inputPropertyList = patternToPropertyList(exportPatternGraph(typePatternGraph, inputPatternNodeId));
      return inputPropertyList[0][1];
    }

    const inputPropertyList = getPattern(inst.src, inputMap);
    const inputRoot = inputPropertyList?.[0];
    if (Array.isArray(inputRoot) && Array.isArray(inputRoot[1])) {
      if (inputRoot[0] === "open-product" || inputRoot[0] === "closed-product") {
        return inputRoot[1];
      }
    }
    // Fallback: check function's inputPattern
    if (Array.isArray(kvmFunc.inputPattern?.[0]?.[1])) {
      return kvmFunc.inputPattern[0][1];
    }
    throw new Error(`ARM64 compiler: cannot infer product edges for field '${inst.label}'`);
  };

  const registers = new Set(["in", "call_val", "call_ok"]);
  const inputProductEdges = Array.isArray(kvmFunc.inputPattern?.[0]?.[1])
    && (kvmFunc.inputPattern[0][0] === "open-product" || kvmFunc.inputPattern[0][0] === "closed-product")
    ? kvmFunc.inputPattern[0][1]
    : null;
  const inputProductFields = inputProductEdges
    ? inputProductEdges.map(([label], index) => ({ label, index, local: `tail_in_${index}` }))
    : [];
  const inputProductFieldByLabel = new Map(inputProductFields.map((field) => [field.label, field]));

  const collectReg = (reg) => {
    if (reg && reg.startsWith("%")) {
      registers.add(cleanReg(reg));
    }
  };

  function collectAllRegisters(insts) {
    for (const inst of insts) {
      collectReg(inst.dest);
      collectReg(inst.src);
      if (inst.src) {
        registers.add(`${cleanReg(inst.src)}_materialized`);
      }
      if (inst.branches) {
        for (const branch of inst.branches) {
          collectAllRegisters(branch.body);
        }
      }
    }
  }
  collectAllRegisters(kvmFunc.body);
  registers.add("in_materialized");
  for (const field of inputProductFields) {
    registers.add(field.local);
  }

  let nextUnionId = 0;
  const tailLoopLabel = `.Ltail_loop_${name}`;
  const funcEpilogueLabel = `.Lepilogue_${name}`;
  const funcFailLabel = `.Lfunc_fail_${name}`;

  const mapsToReg = (reg, inputMap) => inputMap[cleanReg(reg)] || cleanReg(reg);

  function tailValueAfter(insts, startIndex, valueReg, inputMap, returnTarget, tailReturnTargets) {
    let current = valueReg;
    for (let i = startIndex; i < insts.length; i++) {
      const inst = insts[i];
      if (inst.op === "guard_pattern" || inst.op === "guard_code" || inst.op === "id") {
        if (mapsToReg(inst.src, inputMap) !== current) return false;
        current = cleanReg(inst.dest);
        continue;
      }
      if (inst.op === "return" && mapsToReg(inst.src, inputMap) === current) {
        return returnTarget ? tailReturnTargets.has(returnTarget) : true;
      }
      return false;
    }
    return false;
  }

  function isSelfTailCall(insts, index, inputMap, returnTarget, tailReturnTargets) {
    if (options.trace) return false;
    const inst = insts[index];
    if (inst.op !== "call" || inst.func !== name) return false;
    const dest = cleanReg(inst.dest);
    return tailValueAfter(insts, index + 1, dest, inputMap, returnTarget, tailReturnTargets);
  }

  function selfTailCallAfterProduct(insts, index, productDest, inputMap, returnTarget, tailReturnTargets) {
    if (options.trace || inputProductFields.length === 0) return null;
    const callInst = insts[index + 1];
    if (!callInst || callInst.op !== "call" || callInst.func !== name) return null;
    if (mapsToReg(callInst.src, inputMap) !== productDest) return null;
    const callDest = cleanReg(callInst.dest);
    if (!tailValueAfter(insts, index + 2, callDest, inputMap, returnTarget, tailReturnTargets)) return null;
    return callInst;
  }

  // Pre-scan all union branches to allocate union_mark slots in registers
  let scanUnionId = 0;
  function preScanUnions(insts) {
    for (const inst of insts) {
      if (inst.op === "union") {
        registers.add(`union_mark_${scanUnionId++}`);
      }
      if (inst.branches) {
        for (const branch of inst.branches) {
          preScanUnions(branch.body);
        }
      }
    }
  }
  preScanUnions(kvmFunc.body);

  // Pre-scan all product branches to allocate fieldTmp slots in registers
  function preScanProducts(insts) {
    for (const inst of insts) {
      if (inst.op === "product") {
        const dest = cleanReg(inst.dest);
        for (let i = 0; i < inst.branches.length; i++) {
          registers.add(`${dest}_f${i}`);
        }
      }
      if (inst.branches) {
        for (const branch of inst.branches) {
          preScanProducts(branch.body);
        }
      }
    }
  }
  preScanProducts(kvmFunc.body);

  // Assign stack offsets to all registers
  // Stack frame layout:
  // [sp, #0]: saved FP (x29)
  // [sp, #8]: saved LR (x30)
  // [sp, #16]: first virtual register...
  const regList = [...registers];
  const regOffsets = new Map();
  regList.forEach((reg, index) => {
    regOffsets.set(reg, 16 + 8 * index);
  });

  const rawFrameSize = 16 + 8 * regList.length;
  const frameSize = (rawFrameSize + 15) & ~15; // 16-byte aligned

  const regOffset = (rName) => {
    const clean = cleanReg(rName);
    if (!regOffsets.has(clean)) {
      throw new Error(`ARM64 compiler: unknown register '${clean}'`);
    }
    return regOffsets.get(clean);
  };

  function initInputProductLocals() {
    const lines = [];
    for (const field of inputProductFields) {
      const fieldIndex = inputProductEdges.findIndex(([label]) => label === field.label);
      lines.push(`    // cache input field ${field.label} in ${field.local}`);
      lines.push(`    ldr   x9, [sp, #${regOffset("in")}]`);
      lines.push(`    cbz   x9, ${funcFailLabel}`);
      lines.push(`    ldr   x10, [x9, #${8 + 8 * fieldIndex}]`);
      lines.push(`    str   x10, [sp, #${regOffset(field.local)}]`);
    }
    return lines.join("\n");
  }

  function materializeInputProduct(lines, dest) {
    const N = inputProductFields.length;
    const totalSize = (8 + 8 * N + 15) & ~15;
    lines.push(`    // materialize cached input product into ${dest}`);
    lines.push(`    mov   x9, x19`);
    lines.push(`    add   x19, x19, #${totalSize}`);
    lines.push(`    movz  w10, #${totalSize}`);
    lines.push(`    movk  w10, #0x0001, lsl #16`);
    lines.push(`    str   w10, [x9, #0]`);
    lines.push(`    mov   w10, #${N}`);
    lines.push(`    str   w10, [x9, #4]`);
    for (const field of inputProductFields) {
      const offsetVal = 8 + 8 * field.index;
      lines.push(`    ldr   x11, [sp, #${regOffset(field.local)}]`);
      lines.push(`    str   x11, [x9, #${offsetVal}]`);
    }
    lines.push(`    str   x9, [sp, #${regOffset(dest)}]`);
  }

  function compileInstructions(
    insts,
    inputMap = { "in": "in" },
    returnTarget = null,
    failTarget = null,
    tailReturnTargets = new Set(),
    inputAliases = new Set(["in"])
  ) {
    const lines = [];
    for (let index = 0; index < insts.length; index++) {
      const inst = insts[index];
      switch (inst.op) {
        case "guard_pattern":
        case "guard_code":
        case "id": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          lines.push(`    // id/guard: ${dest} = ${src}`);
          lines.push(`    ldr   x9, [sp, #${regOffset(src)}]`);
          lines.push(`    str   x9, [sp, #${regOffset(dest)}]`);
          setPattern(dest, inst.pattern || getPattern(inst.src, inputMap));
          if (inputAliases.has(src)) {
            inputAliases.add(dest);
          } else {
            inputAliases.delete(dest);
          }
          break;
        }
        case "fail": {
          lines.push(`    // fail`);
          if (failTarget) {
            lines.push(`    b     ${failTarget}`);
          } else {
            lines.push(`    b     ${funcFailLabel}`);
          }
          break;
        }
        case "return": {
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const valueSrc = inputAliases.has(src) && inputProductFields.length > 0
            ? `${src}_materialized`
            : src;
          if (valueSrc !== src) {
            materializeInputProduct(lines, valueSrc);
          }
          lines.push(`    // return: ${valueSrc}`);
          if (returnTarget) {
            lines.push(`    ldr   x9, [sp, #${regOffset(valueSrc)}]`);
            lines.push(`    str   x9, [sp, #${regOffset(returnTarget)}]`);
            setPattern(returnTarget, getPattern(inst.src, inputMap));
          } else {
            lines.push(`    mov   x0, #0`);
            lines.push(`    ldr   x1, [sp, #${regOffset(valueSrc)}]`);
            lines.push(`    b     ${funcEpilogueLabel}`);
          }
          break;
        }
        case "project_field": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const inputField = inputAliases.has(src) ? inputProductFieldByLabel.get(inst.label) : null;

          if (inputField) {
            lines.push(`    // project cached input field ${inst.label} from ${inputField.local} to ${dest}`);
            lines.push(`    ldr   x9, [sp, #${regOffset(inputField.local)}]`);
            lines.push(`    str   x9, [sp, #${regOffset(dest)}]`);
            setPattern(dest, inst.pattern);
            break;
          }

          const edges = getProductEdges(inst, inputMap);
          const fieldIndex = edges.findIndex(([label]) => label === inst.label);
          if (fieldIndex === -1) {
            throw new Error(`ARM64 compiler: field '${inst.label}' not found in input pattern`);
          }

          const currentFail = failTarget || funcFailLabel;
          lines.push(`    // project_field ${inst.label} (index ${fieldIndex}) from ${src} to ${dest}`);
          lines.push(`    ldr   x9, [sp, #${regOffset(src)}]`);
          lines.push(`    cbz   x9, ${currentFail}`);
          lines.push(`    ldr   x10, [x9, #${8 + 8 * fieldIndex}]`);
          lines.push(`    str   x10, [sp, #${regOffset(dest)}]`);
          setPattern(dest, inst.pattern);
          break;
        }
        case "product": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const tailCall = selfTailCallAfterProduct(insts, index, dest, inputMap, returnTarget, tailReturnTargets);
          const sortedBranches = [...inst.branches].sort((a, b) => {
            if (a.label < b.label) return -1;
            if (a.label > b.label) return 1;
            return 0;
          });
          const N = sortedBranches.length;

          lines.push(`    // product creation for ${dest} (${N} fields)`);

          if (tailCall) {
            if (N !== inputProductFields.length) {
              throw new Error(`ARM64 compiler: tail-call ${name} input product field count mismatch`);
            }
            for (let i = 0; i < N; i++) {
              const branch = sortedBranches[i];
              if (!inputProductFieldByLabel.has(branch.label)) {
                throw new Error(`ARM64 compiler: tail-call ${name} input product is missing field '${branch.label}'`);
              }
              const fieldTmp = `${dest}_f${i}`;

              lines.push(`    // tail-call field ${branch.label}`);
              const branchAsm = compileInstructions(
                branch.body,
                { ...inputMap, "in": src },
                fieldTmp,
                failTarget,
                tailReturnTargets,
                new Set(inputAliases)
              );
              lines.push(branchAsm);
            }
            for (let i = 0; i < N; i++) {
              const branch = sortedBranches[i];
              const fieldTmp = `${dest}_f${i}`;
              const inputField = inputProductFieldByLabel.get(branch.label);
              lines.push(`    ldr   x9, [sp, #${regOffset(fieldTmp)}]`);
              lines.push(`    str   x9, [sp, #${regOffset(inputField.local)}]`);
            }
            lines.push(`    b     ${tailLoopLabel}`);
            index = insts.length;
            break;
          }

          for (let i = 0; i < N; i++) {
            const branch = sortedBranches[i];
            const fieldTmp = `${dest}_f${i}`;

            lines.push(`    // branch ${i} for field ${branch.label || i}`);
            const branchAsm = compileInstructions(
              branch.body,
              { ...inputMap, "in": src },
              fieldTmp,
              failTarget,
              tailReturnTargets,
              new Set(inputAliases)
            );
            lines.push(branchAsm);
          }

          const totalSize = (8 + 8 * N + 15) & ~15;
          lines.push(`    // allocate product ${dest} (size ${totalSize} bytes)`);
          lines.push(`    mov   x9, x19`);
          lines.push(`    add   x19, x19, #${totalSize}`);
          lines.push(`    movz  w10, #${totalSize}`);
          lines.push(`    movk  w10, #0x0001, lsl #16`);
          lines.push(`    str   w10, [x9, #0]`);
          lines.push(`    mov   w10, #${N}`);
          lines.push(`    str   w10, [x9, #4]`);

          for (let i = 0; i < N; i++) {
            const offsetVal = 8 + 8 * i;
            const fieldTmp = `${dest}_f${i}`;
            lines.push(`    ldr   x11, [sp, #${regOffset(fieldTmp)}]`);
            lines.push(`    str   x11, [x9, #${offsetVal}]`);
          }
          lines.push(`    str   x9, [sp, #${regOffset(dest)}]`);
          setPattern(dest, inst.pattern);
          break;
        }
        case "make_variant": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const tagId = getTagId(inst.tag);

          lines.push(`    // make_variant ${inst.tag} (tagId ${tagId}) into ${dest}`);
          lines.push(`    mov   x9, x19`);
          lines.push(`    add   x19, x19, #16`);
          lines.push(`    movz  w10, #16`);
          lines.push(`    movk  w10, #0x0002, lsl #16`);
          lines.push(`    str   w10, [x9, #0]`);
          lines.push(`    mov   w10, #${tagId}`);
          lines.push(`    str   w10, [x9, #4]`);
          lines.push(`    ldr   x11, [sp, #${regOffset(src)}]`);
          lines.push(`    str   x11, [x9, #8]`);
          lines.push(`    str   x9, [sp, #${regOffset(dest)}]`);
          setPattern(dest, inst.pattern);
          break;
        }
        case "project_variant": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const tagId = getTagId(inst.tag);
          const currentFail = failTarget || funcFailLabel;

          lines.push(`    // project_variant ${inst.tag} (tagId ${tagId}) from ${src} to ${dest}`);
          lines.push(`    ldr   x9, [sp, #${regOffset(src)}]`);
          lines.push(`    cbz   x9, ${currentFail}`);
          lines.push(`    ldr   w10, [x9, #4]`);
          lines.push(`    cmp   w10, #${tagId}`);
          lines.push(`    b.ne  ${currentFail}`);
          lines.push(`    ldr   x11, [x9, #8]`);
          lines.push(`    str   x11, [sp, #${regOffset(dest)}]`);
          setPattern(dest, inst.pattern);
          break;
        }
        case "union": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const N = inst.branches.length;
          const branchTailReturnTargets = tailValueAfter(insts, index + 1, dest, inputMap, returnTarget, tailReturnTargets)
            ? new Set([...tailReturnTargets, dest])
            : tailReturnTargets;

          const unionId = nextUnionId++;
          const arenaMark = `union_mark_${unionId}`;

          lines.push(`    // union choice for ${dest} (${N} branches)`);
          lines.push(`    // save arena bump mark`);
          lines.push(`    str   x19, [sp, #${regOffset(arenaMark)}]`);

          for (let i = 0; i < N; i++) {
            const branch = inst.branches[i];
            const isLast = (i === N - 1);
            const branchFail = isLast ? (failTarget || funcFailLabel) : `.Lb${i}_fail_${name}_union_${unionId}`;

            lines.push(`    // union branch ${i}`);
            const branchAsm = compileInstructions(
              branch.body,
              { ...inputMap, "in": src },
              dest,
              branchFail,
              branchTailReturnTargets,
              new Set(inputAliases)
            );
            lines.push(branchAsm);
            lines.push(`    b     .Lunion_done_${name}_${unionId}`);

            if (!isLast) {
              lines.push(`${branchFail}:`);
              lines.push(`    // branch ${i} failed: rewind arena`);
              lines.push(`    ldr   x19, [sp, #${regOffset(arenaMark)}]`);
            }
          }

          lines.push(`.Lunion_done_${name}_${unionId}:`);
          setPattern(dest, inst.pattern);
          break;
        }
        case "call": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const callSrc = inputAliases.has(src) && inputProductFields.length > 0
            ? `${src}_materialized`
            : src;

          if (isSelfTailCall(insts, index, inputMap, returnTarget, tailReturnTargets)) {
            lines.push(`    // tail-call ${inst.func}`);
            if (callSrc !== src) {
              materializeInputProduct(lines, callSrc);
            }
            lines.push(`    ldr   x9, [sp, #${regOffset(callSrc)}]`);
            lines.push(`    str   x9, [sp, #${regOffset("in")}]`);
            if (inputProductFields.length > 0) {
              lines.push(initInputProductLocals());
            }
            lines.push(`    b     ${tailLoopLabel}`);
            setPattern("in", kvmFunc.inputPattern);
            setPattern(dest, kvmFunc.outputPattern || inst.pattern);
            break;
          }

          const currentFail = failTarget || funcFailLabel;
          lines.push(`    // call ${inst.func}`);
          lines.push(`    ldr   x0, [sp, #${regOffset(callSrc)}]`);
          lines.push(`    bl    ${inst.func}`);
          lines.push(`    cbnz  x0, ${currentFail}`);
          lines.push(`    str   x1, [sp, #${regOffset(dest)}]`);
          setPattern(dest, inst.pattern);
          break;
        }
        default:
          throw new Error(`ARM64 compiler: unsupported instruction op '${inst.op}'`);
      }
    }
    return lines.join("\n");
  }

  const asm = [
    `    .global ${name}`,
    `    .type ${name}, %function`,
    `    .p2align 3`,
    `${name}:`,
    `    // Function Prologue`,
    `    sub   sp, sp, #${frameSize}`,
    `    stp   x29, x30, [sp, #0]`,
    `    mov   x29, sp`,
    `    str   x0, [sp, #${regOffset("in")}]`,
    inputProductFields.length > 0 ? initInputProductLocals() : "",
    `${tailLoopLabel}:`,
    compileInstructions(kvmFunc.body),
    `${funcFailLabel}:`,
    `    mov   x0, #1`,
    `    mov   x1, #0`,
    `    b     ${funcEpilogueLabel}`,
    `${funcEpilogueLabel}:`,
    `    ldp   x29, x30, [sp, #0]`,
    `    add   sp, sp, #${frameSize}`,
    `    ret`,
    `    .size ${name}, .-${name}`
  ].filter(line => line !== "").join("\n");

  return asm;
}

export function cleanName(name) {
  return "rel_" + name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function cleanFunctionNameMap(names) {
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

export function cleanCallNames(insts, nameMap = null) {
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

function scanCalls(insts, compiled, queue) {
  for (const inst of insts) {
    if (inst.op === "call" && !compiled.has(inst.func)) {
      queue.push(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        scanCalls(branch.body, compiled, queue);
      }
    }
  }
}

export function compileKVMModuleToARM64(mainRelName, kvmProgram, options = {}) {
  collectAllTags(kvmProgram, options.inputPattern, options.outputPattern);

  const compiled = new Set();
  const queue = [mainRelName];
  const asms = [];
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
    asms.push(lowerToARM64(kvmFunc, kvmFunc.name, { ...options, kvmProgram: cleanKVMProgram }));
  }

  const entrySymbol = nameMap.get(mainRelName);

  return {
    assembly: [
      "    .arch armv8-a",
      "    .text",
      asms.join("\n\n"),
      ""
    ].join("\n"),
    entryName: entrySymbol
  };
}

const patternKindConstants = {
  "any": "KP_ANY",
  "open-product": "KP_OPEN_PRODUCT",
  "open-union": "KP_OPEN_UNION",
  "closed-product": "KP_CLOSED_PRODUCT",
  "closed-union": "KP_CLOSED_UNION"
};

function cByteArray(text) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  return bytes.length === 0 ? "{0}" : `{${bytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}}`;
}

export function emitPatternC(name, pattern) {
  if (!Array.isArray(pattern)) throw new Error(`${name} pattern must be a property-list array`);
  const lines = [];
  for (let nodeIndex = 0; nodeIndex < pattern.length; nodeIndex++) {
    const node = pattern[nodeIndex];
    const [, edges] = node;
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const [label] = edge;
      lines.push(`static const unsigned char ${name}_label_${nodeIndex}_${edgeIndex}[] = ${cByteArray(label)};`);
    }
    if (edges.length === 0) continue;
    lines.push(`static k_pattern_edge ${name}_edges_${nodeIndex}[] = {`);
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const [label, target] = edge;
      const labelLength = Buffer.byteLength(String(label), "utf8");
      const labelRef = `${name}_label_${nodeIndex}_${edgeIndex}`;
      lines.push(`  {(const char *)${labelRef}, ${labelLength}, ${Number(target)}}${edgeIndex === edges.length - 1 ? "" : ","}`);
    }
    lines.push("};");
  }
  lines.push(`static k_pattern_node ${name}_nodes[] = {`);
  pattern.forEach(([kind, edges], index) => {
    const constant = patternKindConstants[kind];
    const edgeRef = edges.length === 0 ? "NULL" : `${name}_edges_${index}`;
    lines.push(`  {${constant}, ${edges.length}, ${edgeRef}}${index === pattern.length - 1 ? "" : ","}`);
  });
  lines.push("};");
  lines.push(`k_pattern ${name} = {${pattern.length}, ${name}_nodes};`);
  return lines.join("\n");
}

export function emitMetadataC(tags, inputPattern, outputPattern) {
  let metaC = `#include "krt.h"\n#include <stddef.h>\n#include <stdint.h>\n\n`;
  metaC += `typedef struct { const char *name; size_t length; uint32_t id; } k_arm64_tag_t;\n`;
  metaC += `const k_arm64_tag_t k_arm64_tags[] = {\n`;
  for (const { tag, id } of tags) {
    const escaped = JSON.stringify(tag).slice(1, -1);
    metaC += `  { "${escaped}", ${Buffer.byteLength(tag)}, ${id} },\n`;
  }
  metaC += `};\n`;
  metaC += `const size_t k_arm64_tag_count = ${tags.length};\n\n`;
  metaC += emitPatternC("compiled_input_pattern", inputPattern) + "\n\n";
  metaC += emitPatternC("compiled_output_pattern", outputPattern) + "\n\n";
  return metaC;
}
