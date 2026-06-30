import {
  exportPatternGraph,
  lowerToKVM,
  patternToPropertyList
} from "@fraczak/k/backend-api.mjs";

const tagMap = new Map();
let nextTagId = 1;
function getTagId(tag) {
  if (!tagMap.has(tag)) {
    tagMap.set(tag, nextTagId++);
  }
  return tagMap.get(tag);
}
function getTagFromId(tagId) {
  for (const [tag, id] of tagMap.entries()) {
    if (id === tagId) return tag;
  }
  return null;
}
function getTagEntries() {
  return [...tagMap.entries()]
    .map(([tag, id]) => ({ tag, id }))
    .sort((a, b) => a.id - b.id);
}
function resetTagIds() {
  tagMap.clear();
  nextTagId = 1;
}

const funcMap = new Map();
let nextFuncId = 1;
function getFuncId(name) {
  if (!funcMap.has(name)) {
    funcMap.set(name, nextFuncId++);
  }
  return funcMap.get(name);
}
function getFuncNameFromId(id) {
  for (const [name, fId] of funcMap.entries()) {
    if (fId === id) return name;
  }
  return null;
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

export function lowerToWasm(relDef, name, options = {}) {
  const kvmFuncOriginal = relDef.body ? relDef : lowerToKVM(relDef, name, options);
  // Clone to avoid modifying the original definition in the REPL state
  const kvmFunc = {
    ...kvmFuncOriginal,
    body: cloneInstructions(kvmFuncOriginal.body)
  };
  renameRegisters(kvmFunc.body, "");
  const typePatternGraph = relDef.typePatternGraph || kvmFunc.typePatternGraph;
  const kvmProgram = options.kvmProgram || {};

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
    if (typePatternGraph) {
      const inputPatternId = inst.exp.patterns[0];
      const inputPatternNodeId = typePatternGraph.find(inputPatternId);
      const inputPropertyList = patternToPropertyList(exportPatternGraph(typePatternGraph, inputPatternNodeId));
      return inputPropertyList[0][1];
    }

    const inputPropertyList = getPattern(inst.src, inputMap);
    const inputRoot = inputPropertyList?.[0];
    if (!Array.isArray(inputRoot) || !Array.isArray(inputRoot[1])) {
      throw new Error(`Wasm compiler: cannot infer input pattern for field '${inst.label}'`);
    }
    if (inputRoot[0] !== "open-product" && inputRoot[0] !== "closed-product") {
      throw new Error(`Wasm compiler: field '${inst.label}' requires a product input pattern`);
    }
    return inputRoot[1];
  };

  const registers = new Set();
  registers.add("call_val");
  registers.add("call_ok");
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
      if (inst.branches) {
        for (const branch of inst.branches) {
          collectAllRegisters(branch.body);
        }
      }
    }
  }
  collectAllRegisters(kvmFunc.body);
  for (const field of inputProductFields) {
    registers.add(field.local);
  }

  let nextUnionId = 0;
  const tailLoopLabel = "$tail_loop";

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

  function initInputProductLocals() {
    const lines = [];
    for (const field of inputProductFields) {
      const fieldIndex = inputProductEdges.findIndex(([label]) => label === field.label);
      lines.push(`    ;; cache input field ${field.label} in $${field.local}`);
      lines.push(`    local.get $in`);
      lines.push(`    local.get $in`);
      lines.push(`    i32.const ${8 + 4 * fieldIndex}`);
      lines.push(`    i32.add`);
      lines.push(`    i32.load`);
      lines.push(`    i32.add`);
      lines.push(`    i32.load`);
      lines.push(`    local.set $${field.local}`);
    }
    return lines.join("\n");
  }

  function materializeInputProduct(lines, dest) {
    const totalSize = 8 + 8 * inputProductFields.length;
    lines.push(`    ;; materialize cached input product into $${dest}`);
    lines.push(`    i32.const ${totalSize}`);
    lines.push(`    call $alloc`);
    lines.push(`    local.set $${dest}`);
    lines.push(`    local.get $${dest}`);
    lines.push(`    i32.const ${totalSize}`);
    lines.push(`    i32.store offset=0`);
    lines.push(`    local.get $${dest}`);
    lines.push(`    i32.const ${inputProductFields.length}`);
    lines.push(`    i32.store offset=4`);
    for (const field of inputProductFields) {
      const offsetVal = 8 + 4 * inputProductFields.length + 4 * field.index;
      lines.push(`    local.get $${dest}`);
      lines.push(`    i32.const ${offsetVal}`);
      lines.push(`    i32.store offset=${8 + 4 * field.index}`);
      lines.push(`    local.get $${dest}`);
      lines.push(`    local.get $${field.local}`);
      lines.push(`    i32.store offset=${offsetVal}`);
    }
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
          lines.push(`    local.get $${src}`);
          lines.push(`    local.set $${dest}`);
          setPattern(dest, inst.pattern || getPattern(inst.src, inputMap));
          if (inputAliases.has(src)) {
            inputAliases.add(dest);
          } else {
            inputAliases.delete(dest);
          }
          break;
        }
        case "fail": {
          if (failTarget) {
            lines.push(`    br ${failTarget}`);
          } else {
            lines.push(`    i32.const 0`);
            lines.push(`    i32.const 0`);
            lines.push(`    return`);
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
            registers.add(valueSrc);
            materializeInputProduct(lines, valueSrc);
          }
          if (returnTarget) {
            lines.push(`    local.get $${valueSrc}`);
            lines.push(`    local.set $${returnTarget}`);
            setPattern(returnTarget, getPattern(inst.src, inputMap));
          } else {
            lines.push(`    local.get $${valueSrc}`);
            lines.push(`    i32.const 1`);
            lines.push(`    return`);
          }
          break;
        }
        case "project_field": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const inputField = inputAliases.has(src) ? inputProductFieldByLabel.get(inst.label) : null;

          if (inputField) {
            lines.push(`    ;; project cached input field ${inst.label} from $${inputField.local} to $${dest}`);
            lines.push(`    local.get $${inputField.local}`);
            lines.push(`    local.set $${dest}`);
            setPattern(dest, inst.pattern);
            break;
          }

          const edges = getProductEdges(inst, inputMap);
          const fieldIndex = edges.findIndex(([label]) => label === inst.label);
          if (fieldIndex === -1) {
            throw new Error(`Wasm compiler: field '${inst.label}' not found in input pattern`);
          }

          lines.push(`    ;; project_field ${inst.label} (index ${fieldIndex}) from $${src} to $${dest}`);
          lines.push(`    local.get $${src}`);
          lines.push(`    i32.eqz`);
          lines.push(`    if`);
          if (failTarget) {
            lines.push(`      br ${failTarget}`);
          } else {
            lines.push(`      i32.const 0`);
            lines.push(`      i32.const 0`);
            lines.push(`      return`);
          }
          lines.push(`    end`);
          lines.push(`    local.get $${src}`);
          lines.push(`    local.get $${src}`);
          lines.push(`    i32.const ${8 + 4 * fieldIndex}`);
          lines.push(`    i32.add`);
          lines.push(`    i32.load`);
          lines.push(`    i32.add`);
          lines.push(`    i32.load`);
          lines.push(`    local.set $${dest}`);
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

          lines.push(`    ;; product creation for $${dest}`);

          if (tailCall) {
            if (N !== inputProductFields.length) {
              throw new Error(`Wasm compiler: tail-call ${name} input product field count mismatch`);
            }
            for (let i = 0; i < N; i++) {
              const branch = sortedBranches[i];
              if (!inputProductFieldByLabel.has(branch.label)) {
                throw new Error(`Wasm compiler: tail-call ${name} input product is missing field '${branch.label}'`);
              }
              const fieldTmp = `${dest}_f${i}`;
              registers.add(fieldTmp);

              lines.push(`    ;; tail-call field ${branch.label}`);
              const branchWat = compileInstructions(
                branch.body,
                { ...inputMap, "in": src },
                fieldTmp,
                failTarget,
                tailReturnTargets,
                new Set(inputAliases)
              );
              lines.push(branchWat);
            }
            for (let i = 0; i < N; i++) {
              const branch = sortedBranches[i];
              const fieldTmp = `${dest}_f${i}`;
              const inputField = inputProductFieldByLabel.get(branch.label);
              lines.push(`    local.get $${fieldTmp}`);
              lines.push(`    local.set $${inputField.local}`);
            }
            lines.push(`    br ${tailLoopLabel}`);
            index = insts.length;
            break;
          }

          for (let i = 0; i < N; i++) {
            const branch = sortedBranches[i];
            const fieldTmp = `${dest}_f${i}`;
            registers.add(fieldTmp);

            lines.push(`    ;; branch ${i} for field ${branch.label || i}`);
            const branchWat = compileInstructions(
              branch.body,
              { ...inputMap, "in": src },
              fieldTmp,
              failTarget,
              tailReturnTargets,
              new Set(inputAliases)
            );
            lines.push(branchWat);
          }

          const totalSize = 8 + 8 * N;
          lines.push(`    i32.const ${totalSize}`);
          lines.push(`    call $alloc`);
          lines.push(`    local.set $${dest}`);

          lines.push(`    local.get $${dest}`);
          lines.push(`    i32.const ${totalSize}`);
          lines.push(`    i32.store offset=0`);

          lines.push(`    local.get $${dest}`);
          lines.push(`    i32.const ${N}`);
          lines.push(`    i32.store offset=4`);

          for (let i = 0; i < N; i++) {
            const offsetVal = 8 + 4 * N + 4 * i;
            const fieldTmp = `${dest}_f${i}`;

            lines.push(`    local.get $${dest}`);
            lines.push(`    i32.const ${offsetVal}`);
            lines.push(`    i32.store offset=${8 + 4 * i}`);

            lines.push(`    local.get $${dest}`);
            lines.push(`    local.get $${fieldTmp}`);
            lines.push(`    i32.store offset=${offsetVal}`);
          }
          setPattern(dest, inst.pattern);
          break;
        }
        case "make_variant": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const tagId = getTagId(inst.tag);

          lines.push(`    ;; make_variant ${inst.tag} (tagId ${tagId})`);
          lines.push(`    i32.const 12`);
          lines.push(`    call $alloc`);
          lines.push(`    local.set $${dest}`);

          lines.push(`    local.get $${dest}`);
          lines.push(`    i32.const 12`);
          lines.push(`    i32.store offset=0`);

          lines.push(`    local.get $${dest}`);
          lines.push(`    i32.const ${tagId}`);
          lines.push(`    i32.store offset=4`);

          lines.push(`    local.get $${dest}`);
          lines.push(`    local.get $${src}`);
          lines.push(`    i32.store offset=8`);
          setPattern(dest, inst.pattern);
          break;
        }
        case "project_variant": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const tagId = getTagId(inst.tag);

          lines.push(`    ;; project_variant ${inst.tag} (tagId ${tagId}) from $${src} to $${dest}`);
          lines.push(`    local.get $${src}`);
          lines.push(`    i32.eqz`);
          lines.push(`    if`);
          if (failTarget) {
            lines.push(`      br ${failTarget}`);
          } else {
            lines.push(`      i32.const 0`);
            lines.push(`      i32.const 0`);
            lines.push(`      return`);
          }
          lines.push(`    end`);

          lines.push(`    local.get $${src}`);
          lines.push(`    i32.load offset=4`);
          lines.push(`    i32.const ${tagId}`);
          lines.push(`    i32.ne`);
          lines.push(`    if`);
          if (failTarget) {
            lines.push(`      br ${failTarget}`);
          } else {
            lines.push(`      i32.const 0`);
            lines.push(`      i32.const 0`);
            lines.push(`      return`);
          }
          lines.push(`    end`);

          lines.push(`    local.get $${src}`);
          lines.push(`    i32.load offset=8`);
          lines.push(`    local.set $${dest}`);
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
          registers.add(arenaMark);

          lines.push(`    ;; union choice for $${dest}`);
          lines.push(`    (block $union_done_${unionId}`);

          for (let i = N - 1; i >= 0; i--) {
            lines.push(`      (block $b${i}_try_${unionId}`);
          }

          for (let i = 0; i < N; i++) {
            const branch = inst.branches[i];
            lines.push(`      global.get $arena_free`);
            lines.push(`      local.set $${arenaMark}`);
            const branchWat = compileInstructions(
              branch.body,
              { ...inputMap, "in": src },
              dest,
              `$b${i}_try_${unionId}`,
              branchTailReturnTargets,
              new Set(inputAliases)
            );
            lines.push(branchWat);
            lines.push(`      br $union_done_${unionId}`);
            lines.push(`      ) ;; end $b${i}_try_${unionId}`);
            lines.push(`      local.get $${arenaMark}`);
            lines.push(`      global.set $arena_free`);
          }

          // If we reach here, all branches failed
          if (failTarget) {
            lines.push(`      br ${failTarget}`);
          } else {
            lines.push(`      i32.const 0`);
            lines.push(`      i32.const 0`);
            lines.push(`      return`);
          }
          lines.push(`    ) ;; end $union_done_${unionId}`);
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
            lines.push(`    ;; tail-call ${inst.func}`);
            if (callSrc !== src) {
              registers.add(callSrc);
              materializeInputProduct(lines, callSrc);
            }
            lines.push(`    local.get $${callSrc}`);
            lines.push(`    local.set $in`);
            lines.push(initInputProductLocals());
            lines.push(`    br ${tailLoopLabel}`);
            setPattern("in", kvmFunc.inputPattern);
            setPattern(dest, kvmFunc.outputPattern || inst.pattern);
            break;
          }

          lines.push(`    ;; call ${inst.func}`);
          if (options.trace) {
            const funcId = getFuncId(inst.func);
            lines.push(`    i32.const ${funcId}`);
            if (callSrc !== src) {
              registers.add(callSrc);
              materializeInputProduct(lines, callSrc);
            }
            lines.push(`    local.get $${callSrc}`);
            lines.push(`    call $log_call`);
          }
          if (callSrc !== src && !options.trace) {
            registers.add(callSrc);
            materializeInputProduct(lines, callSrc);
          }
          lines.push(`    local.get $${callSrc}`);
          lines.push(`    call $${inst.func}`);
          lines.push(`    local.set $call_ok`);
          lines.push(`    local.set $call_val`);
          if (options.trace) {
            const funcId = getFuncId(inst.func);
            lines.push(`    i32.const ${funcId}`);
            lines.push(`    local.get $call_val`);
            lines.push(`    local.get $call_ok`);
            lines.push(`    call $log_ret`);
          }
          lines.push(`    local.get $call_ok`);
          lines.push(`    i32.eqz`);
          lines.push(`    if`);
          if (failTarget) {
            lines.push(`      br ${failTarget}`);
          } else {
            lines.push(`      i32.const 0`);
            lines.push(`      i32.const 0`);
            lines.push(`      return`);
          }
          lines.push(`    end`);
          lines.push(`    local.get $call_val`);
          lines.push(`    local.set $${dest}`);
          setPattern(dest, kvmProgram[inst.func]?.outputPattern || inst.pattern);
          break;
        }
        case "call_intrinsic": {
          throw new Error(`Wasm compiler: unsupported intrinsic '${inst.symbol}'`);
        }
        default:
          throw new Error(`Wasm compiler: unsupported instruction op '${inst.op}'`);
      }
    }
    return lines.join("\n");
  }

  const bodyWat = compileInstructions(kvmFunc.body);
  const inputProductLocalInit = initInputProductLocals();

  const localDecls = Array.from(registers)
    .filter(r => r !== "in")
    .map(r => `    (local $${r} i32)`)
    .join("\n");

  const wat = `(func $${name} (export "${name}") (param $in i32) (result i32 i32)
${localDecls}
${inputProductLocalInit}
    (loop ${tailLoopLabel}
${bodyWat}
    )
    unreachable
  )`;

  return wat;
}

export { getTagId, getTagFromId, getTagEntries, resetTagIds, getFuncNameFromId };
export default {
  lowerToWasm,
  getTagId,
  getTagFromId,
  getTagEntries,
  resetTagIds,
  getFuncNameFromId
};
