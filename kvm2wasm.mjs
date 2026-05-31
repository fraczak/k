import { lowerToKVM } from "./kvm.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

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
  
  const cleanReg = (rName) => rName.replace("%", "").replace("$", "");
  
  const registers = new Set();
  registers.add("call_val");
  registers.add("call_ok");

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

  let nextUnionId = 0;

  function compileInstructions(insts, inputMap = { "in": "in" }, returnTarget = null, failTarget = null) {
    const lines = [];
    for (const inst of insts) {
      switch (inst.op) {
        case "guard_pattern":
        case "guard_code":
        case "id": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          lines.push(`    local.get $${src}`);
          lines.push(`    local.set $${dest}`);
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
          if (returnTarget) {
            lines.push(`    local.get $${src}`);
            lines.push(`    local.set $${returnTarget}`);
          } else {
            lines.push(`    local.get $${src}`);
            lines.push(`    i32.const 1`);
            lines.push(`    return`);
          }
          break;
        }
        case "project_field": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          
          const inputPatternId = inst.exp.patterns[0];
          const inputPatternNodeId = typePatternGraph.find(inputPatternId);
          const inputPropertyList = patternToPropertyList(exportPatternGraph(typePatternGraph, inputPatternNodeId));
          const edges = inputPropertyList[0][1];
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
          break;
        }
        case "product": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const sortedBranches = [...inst.branches].sort((a, b) => {
            if (a.label < b.label) return -1;
            if (a.label > b.label) return 1;
            return 0;
          });
          const N = sortedBranches.length;
          
          lines.push(`    ;; product creation for $${dest}`);
          
          for (let i = 0; i < N; i++) {
            const branch = sortedBranches[i];
            const fieldTmp = `${dest}_f${i}`;
            registers.add(fieldTmp);
            
            lines.push(`    ;; branch ${i} for field ${branch.label || i}`);
            const branchWat = compileInstructions(branch.body, { ...inputMap, "in": src }, fieldTmp, failTarget);
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
          break;
        }
        case "union": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          const N = inst.branches.length;
          
          const unionId = nextUnionId++;
          
          lines.push(`    ;; union choice for $${dest}`);
          lines.push(`    (block $union_done_${unionId}`);
          
          for (let i = N - 1; i >= 0; i--) {
            lines.push(`      (block $b${i}_try_${unionId}`);
          }
          
          for (let i = 0; i < N; i++) {
            const branch = inst.branches[i];
            const branchWat = compileInstructions(
              branch.body, 
              { ...inputMap, "in": src }, 
              dest, 
              `$b${i}_try_${unionId}`
            );
            lines.push(branchWat);
            lines.push(`      br $union_done_${unionId}`);
            lines.push(`      ) ;; end $b${i}_try_${unionId}`);
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
          break;
        }
        case "call": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          
          lines.push(`    ;; call ${inst.func}`);
          if (options.trace) {
            const funcId = getFuncId(inst.func);
            lines.push(`    i32.const ${funcId}`);
            lines.push(`    local.get $${src}`);
            lines.push(`    call $log_call`);
          }
          lines.push(`    local.get $${src}`);
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
          break;
        }
        case "call_intrinsic": {
          const dest = cleanReg(inst.dest);
          const rawSrc = cleanReg(inst.src);
          const src = inputMap[rawSrc] || rawSrc;
          
          lines.push(`    ;; call_intrinsic ${inst.symbol}`);
          lines.push(`    local.get $${src}`);
          lines.push(`    local.set $${dest}`);
          break;
        }
        default:
          throw new Error(`Wasm compiler: unsupported instruction op '${inst.op}'`);
      }
    }
    return lines.join("\n");
  }

  const bodyWat = compileInstructions(kvmFunc.body);

  const localDecls = Array.from(registers)
    .filter(r => r !== "in")
    .map(r => `    (local $${r} i32)`)
    .join("\n");

  const wat = `(func $${name} (export "${name}") (param $in i32) (result i32 i32)
${localDecls}
${bodyWat}
  )`;

  return wat;
}

export { getTagId, getTagFromId, getFuncNameFromId };
export default {
  lowerToWasm,
  getTagId,
  getTagFromId,
  getFuncNameFromId
};
