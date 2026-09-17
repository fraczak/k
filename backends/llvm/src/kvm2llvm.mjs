import fs from "node:fs";
import { isIntrinsic, unsupportedIntrinsic } from "@fraczak/k/backend-api.mjs";
import { llvmIdentifier } from "./llvm.mjs";

export const ARTIFACT_FORMAT = "k-llvm";
export const ARTIFACT_VERSION = 1;

const K_VALUE_SIZE = 40;
const K_VALUE_ALLOC_SIZE = 48;
const K_VALUE_KIND_PRODUCT = 1;
const K_VALUE_KIND_VARIANT = 2;
const K_VALUE_KIND_OFFSET = 0;
const K_VALUE_RT_OFFSET = 8;
const K_VALUE_PRODUCT_COUNT_OFFSET = 16;
const K_VALUE_PRODUCT_CAPACITY_OFFSET = 24;
const K_VALUE_PRODUCT_FIELDS_OFFSET = 32;
const K_VALUE_VARIANT_TAG_OFFSET = 16;
const K_VALUE_VARIANT_TAG_LENGTH_OFFSET = 24;
const K_VALUE_VARIANT_PAYLOAD_OFFSET = 32;
const K_PRODUCT_HEADER_SIZE = 48;
const K_FIELD_SIZE = 24;
const K_FIELD_LABEL_OFFSET = 0;
const K_FIELD_LABEL_LENGTH_OFFSET = 8;
const K_FIELD_VALUE_OFFSET = 16;

const K_RT_BLOCKS_OFFSET = 0;
const K_RT_UNIT_CACHE_OFFSET = 8;
const K_RT_BIT0_CACHE_OFFSET = 16;
const K_RT_BIT1_CACHE_OFFSET = 24;
const K_RT_HAS_REUSABLE_BLOCKS_OFFSET = 32;
const K_ARENA_BLOCK_USED_OFFSET = 8;

function alignArenaSize(size) {
  return (size + 15) & ~15;
}

function cStringBytes(text) {
  return [...Buffer.from(text, "utf8"), 0]
    .map((byte) => {
      if (byte === 10) return "\\0A";
      if (byte === 34) return "\\22";
      if (byte === 92) return "\\5C";
      if (byte >= 32 && byte <= 126) return String.fromCharCode(byte);
      return `\\${byte.toString(16).padStart(2, "0").toUpperCase()}`;
    })
    .join("");
}

export function runtimeDeclarations() {
  return [
    "%k_rt_mark = type { ptr, i64 }",
    "%k_result = type { i32, ptr }",
    "",
    "declare %k_rt_mark @k_rt_mark(ptr)",
    "declare void @k_rt_rewind(ptr, %k_rt_mark)",
    "declare ptr @k_rt_alloc(ptr, i64)",
    "declare ptr @k_unit(ptr)",
    "declare ptr @k_bit0(ptr)",
    "declare ptr @k_bit1(ptr)",
    "declare ptr @k_product(ptr, i64)",
    "declare void @k_product_set(ptr, ptr, ptr)",
    "declare void @k_product_set_n(ptr, ptr, i64, ptr)",
    "declare void @k_product_set_borrowed_n(ptr, ptr, i64, ptr)",
    "declare void @k_product_set_at(ptr, i64, ptr, i64, ptr)",
    "declare ptr @k_product_get(ptr, ptr)",
    "declare ptr @k_product_get_n(ptr, ptr, i64)",
    "declare ptr @k_product_get_at(ptr, i64)",
    "declare ptr @k_variant(ptr, ptr, ptr)",
    "declare ptr @k_variant_n(ptr, ptr, i64, ptr)",
    "declare ptr @k_variant_borrowed_n(ptr, ptr, i64, ptr)",
    "declare ptr @k_variant_borrowed_direct_n(ptr, ptr, i64, ptr)",
    "declare ptr @k_variant_unit_borrowed_n(ptr, ptr, i64)",
    "declare ptr @k_variant_tag(ptr)",
    "declare ptr @k_variant_payload(ptr)",
    "declare i32 @k_equal(ptr, ptr)",
    "declare i32 @k_variant_tag_matches(ptr, ptr, i64)"
  ];
}

function cleanReg(r) {
  if (!r) return "";
  return String(r).replace(/^[%$]/, "");
}

function bytePtr(ctx, base, offset, prefix = "slot") {
  const slot = ctx.tempName(prefix);
  ctx.lines.push(`  ${slot} = getelementptr inbounds i8, ptr ${base}, i64 ${offset}`);
  return slot;
}

function storeI32At(ctx, base, offset, value) {
  const slot = bytePtr(ctx, base, offset, "i32_slot");
  ctx.lines.push(`  store i32 ${value}, ptr ${slot}`);
}

function storeI64At(ctx, base, offset, value) {
  const slot = bytePtr(ctx, base, offset, "i64_slot");
  ctx.lines.push(`  store i64 ${value}, ptr ${slot}`);
}

function storePtrAt(ctx, base, offset, value) {
  const slot = bytePtr(ctx, base, offset, "ptr_slot");
  ctx.lines.push(`  store ptr ${value}, ptr ${slot}`);
}

function loadI32At(ctx, base, offset, prefix = "i32_val") {
  const slot = bytePtr(ctx, base, offset, `${prefix}_slot`);
  const value = ctx.tempName(prefix);
  ctx.lines.push(`  ${value} = load i32, ptr ${slot}`);
  return value;
}

function loadI64At(ctx, base, offset, prefix = "i64_val") {
  const slot = bytePtr(ctx, base, offset, `${prefix}_slot`);
  const value = ctx.tempName(prefix);
  ctx.lines.push(`  ${value} = load i64, ptr ${slot}`);
  return value;
}

function loadPtrAt(ctx, base, offset, prefix = "ptr_val") {
  const slot = bytePtr(ctx, base, offset, `${prefix}_slot`);
  const value = ctx.tempName(prefix);
  ctx.lines.push(`  ${value} = load ptr, ptr ${slot}`);
  return value;
}

function lowerRawAlloc(ctx, requestedSize, alignedSize) {
  const pointer = ctx.tempName("alloc");
  ctx.lines.push(`  ${pointer} = call ptr @k_rt_alloc(ptr %rt, i64 ${requestedSize})`);
  return pointer;
}

function lowerRawVariant(ctx, tag, payload) {
  const label = ctx.labelRef(tag);
  if (ctx.runtimeMode === "compact") {
    const variant = ctx.tempName("variant");
    ctx.lines.push(`  ${variant} = call ptr @k_variant_borrowed_direct_n(ptr %rt, ptr ${label.pointer}, i64 ${label.length}, ptr ${payload})`);
    return variant;
  }
  const variant = lowerRawAlloc(ctx, K_VALUE_SIZE, K_VALUE_ALLOC_SIZE);
  storeI32At(ctx, variant, K_VALUE_KIND_OFFSET, K_VALUE_KIND_VARIANT);
  storePtrAt(ctx, variant, K_VALUE_RT_OFFSET, "%rt");
  storePtrAt(ctx, variant, K_VALUE_VARIANT_TAG_OFFSET, label.pointer);
  storeI64At(ctx, variant, K_VALUE_VARIANT_TAG_LENGTH_OFFSET, label.length);
  storePtrAt(ctx, variant, K_VALUE_VARIANT_PAYLOAD_OFFSET, payload);
  return variant;
}

function lowerProductGetAt(ctx, input, edgeIndex) {
  const nonNullBlock = ctx.blockName("product_non_null");
  const productBlock = ctx.blockName("product_kind");
  const fieldBlock = ctx.blockName("product_field");
  const missingBlock = ctx.blockName("product_missing");
  const doneBlock = ctx.blockName("product_done");
  const isMissing = ctx.tempName("product_is_missing");
  ctx.lines.push(`  ${isMissing} = icmp eq ptr ${input}, null`);
  ctx.lines.push(`  br i1 ${isMissing}, label %${missingBlock}, label %${nonNullBlock}`);

  ctx.lines.push(`${nonNullBlock}:`);
  const kind = loadI32At(ctx, input, K_VALUE_KIND_OFFSET, "product_kind");
  const isProduct = ctx.tempName("product_kind_ok");
  ctx.lines.push(`  ${isProduct} = icmp eq i32 ${kind}, ${K_VALUE_KIND_PRODUCT}`);
  ctx.lines.push(`  br i1 ${isProduct}, label %${productBlock}, label %${missingBlock}`);

  ctx.lines.push(`${productBlock}:`);
  const count = loadI64At(ctx, input, K_VALUE_PRODUCT_COUNT_OFFSET, "product_count");
  const inRange = ctx.tempName("product_index_ok");
  ctx.lines.push(`  ${inRange} = icmp ugt i64 ${count}, ${edgeIndex}`);
  ctx.lines.push(`  br i1 ${inRange}, label %${fieldBlock}, label %${missingBlock}`);

  ctx.lines.push(`${fieldBlock}:`);
  const fields = loadPtrAt(ctx, input, K_VALUE_PRODUCT_FIELDS_OFFSET, "product_fields_ptr");
  const slot = bytePtr(ctx, fields, edgeIndex * K_FIELD_SIZE, "field_slot");
  const value = loadPtrAt(ctx, slot, K_FIELD_VALUE_OFFSET, "field");
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${missingBlock}:`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  const resultValue = ctx.tempName("field_value");
  ctx.lines.push(`  ${resultValue} = phi ptr [${value}, %${fieldBlock}], [null, %${missingBlock}]`);
  ctx.currentBlock = doneBlock;
  return resultValue;
}

function lowerVariantMatchBranch(ctx, input, label, matchBlock, mismatchBlock) {
  const nonNullBlock = ctx.blockName("tag_non_null");
  const variantBlock = ctx.blockName("tag_variant");
  const lengthBlock = ctx.blockName("tag_length");
  const isMissing = ctx.tempName("tag_is_missing");
  ctx.lines.push(`  ${isMissing} = icmp eq ptr ${input}, null`);
  ctx.lines.push(`  br i1 ${isMissing}, label %${mismatchBlock}, label %${nonNullBlock}`);

  ctx.lines.push(`${nonNullBlock}:`);
  const kind = loadI32At(ctx, input, K_VALUE_KIND_OFFSET, "tag_kind");
  const isVariant = ctx.tempName("tag_kind_ok");
  ctx.lines.push(`  ${isVariant} = icmp eq i32 ${kind}, ${K_VALUE_KIND_VARIANT}`);
  ctx.lines.push(`  br i1 ${isVariant}, label %${variantBlock}, label %${mismatchBlock}`);

  ctx.lines.push(`${variantBlock}:`);
  const tagLength = loadI64At(ctx, input, K_VALUE_VARIANT_TAG_LENGTH_OFFSET, "tag_length");
  const lengthMatches = ctx.tempName("tag_length_ok");
  ctx.lines.push(`  ${lengthMatches} = icmp eq i64 ${tagLength}, ${label.length}`);

  const bytes = [...Buffer.from(label.text, "utf8")];
  if (bytes.length === 0) {
    ctx.lines.push(`  br i1 ${lengthMatches}, label %${matchBlock}, label %${mismatchBlock}`);
    return;
  }

  ctx.lines.push(`  br i1 ${lengthMatches}, label %${lengthBlock}, label %${mismatchBlock}`);
  ctx.lines.push(`${lengthBlock}:`);
  const tagPointer = loadPtrAt(ctx, input, K_VALUE_VARIANT_TAG_OFFSET, "tag_ptr");

  for (let index = 0; index < bytes.length; index++) {
    const tagBytePointer = bytePtr(ctx, tagPointer, index, "tag_byte_ptr");
    const tagByte = ctx.tempName("tag_byte");
    const byteMatches = ctx.tempName("tag_byte_ok");
    const nextBlock = index === bytes.length - 1 ? matchBlock : ctx.blockName("tag_byte");
    ctx.lines.push(`  ${tagByte} = load i8, ptr ${tagBytePointer}`);
    ctx.lines.push(`  ${byteMatches} = icmp eq i8 ${tagByte}, ${bytes[index]}`);
    ctx.lines.push(`  br i1 ${byteMatches}, label %${nextBlock}, label %${mismatchBlock}`);
    if (index !== bytes.length - 1) {
      ctx.lines.push(`${nextBlock}:`);
    }
  }
}

function lowerVariantPayload(ctx, input) {
  return loadPtrAt(ctx, input, K_VALUE_VARIANT_PAYLOAD_OFFSET, "payload");
}

function lowerRtMark(ctx) {
  const block = loadPtrAt(ctx, "%rt", K_RT_BLOCKS_OFFSET, "mark_block");
  const hasBlock = ctx.tempName("mark_has_block");
  const loadBlock = ctx.blockName("mark_load");
  const emptyBlock = ctx.blockName("mark_empty");
  const doneBlock = ctx.blockName("mark_done");
  ctx.lines.push(`  ${hasBlock} = icmp ne ptr ${block}, null`);
  ctx.lines.push(`  br i1 ${hasBlock}, label %${loadBlock}, label %${emptyBlock}`);

  ctx.lines.push(`${loadBlock}:`);
  const usedValue = loadI64At(ctx, block, K_ARENA_BLOCK_USED_OFFSET, "mark_used_value");
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${emptyBlock}:`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  const used = ctx.tempName("mark_used");
  const partial = ctx.tempName("mark");
  const aggregate = ctx.tempName("mark");
  ctx.lines.push(`  ${used} = phi i64 [${usedValue}, %${loadBlock}], [0, %${emptyBlock}]`);
  ctx.lines.push(`  ${partial} = insertvalue %k_rt_mark undef, ptr ${block}, 0`);
  ctx.lines.push(`  ${aggregate} = insertvalue %k_rt_mark ${partial}, i64 ${used}, 1`);
  ctx.currentBlock = doneBlock;
  return { aggregate, block, used };
}

function lowerRtRewind(ctx, mark) {
  const currentBlock = loadPtrAt(ctx, "%rt", K_RT_BLOCKS_OFFSET, "rewind_block");
  const hasMark = ctx.tempName("rewind_has_mark");
  const sameBlock = ctx.tempName("rewind_same_block");
  const fast = ctx.tempName("rewind_fast_ok");
  const fastBlock = ctx.blockName("rewind_fast");
  const slowBlock = ctx.blockName("rewind_slow");
  const doneBlock = ctx.blockName("rewind_done");
  ctx.lines.push(`  ${hasMark} = icmp ne ptr ${mark.block}, null`);
  ctx.lines.push(`  ${sameBlock} = icmp eq ptr ${currentBlock}, ${mark.block}`);
  ctx.lines.push(`  ${fast} = and i1 ${hasMark}, ${sameBlock}`);
  ctx.lines.push(`  br i1 ${fast}, label %${fastBlock}, label %${slowBlock}`);

  ctx.lines.push(`${fastBlock}:`);
  storeI64At(ctx, currentBlock, K_ARENA_BLOCK_USED_OFFSET, mark.used);
  storePtrAt(ctx, "%rt", K_RT_UNIT_CACHE_OFFSET, "null");
  storePtrAt(ctx, "%rt", K_RT_BIT0_CACHE_OFFSET, "null");
  storePtrAt(ctx, "%rt", K_RT_BIT1_CACHE_OFFSET, "null");
  storeI32At(ctx, "%rt", K_RT_HAS_REUSABLE_BLOCKS_OFFSET, 0);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${slowBlock}:`);
  ctx.lines.push(`  call void @k_rt_rewind(ptr %rt, %k_rt_mark ${mark.aggregate})`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  ctx.currentBlock = doneBlock;
}

function nullCheck(ctx, val, failTarget) {
  const isMissing = ctx.tempName("missing");
  const okBlock = ctx.blockName("nonnull");
  ctx.lines.push(`  ${isMissing} = icmp eq ptr ${val}, null`);
  ctx.lines.push(`  br i1 ${isMissing}, label %${failTarget}, label %${okBlock}`);
  ctx.lines.push(`${okBlock}:`);
  ctx.currentBlock = okBlock;
}

function sameFuncName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = cleanReg(a).replace(/^@/, "");
  const cb = cleanReg(b).replace(/^@/, "");
  return ca === cb;
}

function statusCheck(ctx, callResult, failTarget = "func_fail") {
  const status = ctx.tempName("status");
  const failed = ctx.tempName("failed");
  const okBlock = ctx.blockName("ok");
  const failedBlock = ctx.blockName("failed");
  ctx.lines.push(`  ${status} = extractvalue %k_result ${callResult}, 0`);
  ctx.lines.push(`  ${failed} = icmp ne i32 ${status}, 0`);
  ctx.lines.push(`  br i1 ${failed}, label %${failedBlock}, label %${okBlock}`);
  ctx.lines.push(`${failedBlock}:`);
  const isTail = ctx.tempName("is_tail");
  const tailBlock = ctx.blockName("tail_return");
  const reallyFailedBlock = ctx.blockName("really_failed");
  ctx.lines.push(`  ${isTail} = icmp eq i32 ${status}, 2`);
  ctx.lines.push(`  br i1 ${isTail}, label %${tailBlock}, label %${reallyFailedBlock}`);
  ctx.lines.push(`${tailBlock}:`);
  if (ctx.catchTail) {
    const tailInput = ctx.tempName("tail_arg");
    ctx.lines.push(`  ${tailInput} = extractvalue %k_result ${callResult}, 1`);
    ctx.lines.push(`  store ptr ${tailInput}, ptr %tail_input_slot`);
    ctx.lines.push("  br label %tail_loop");
  } else {
    ctx.lines.push(`  ret %k_result ${callResult}`);
  }
  ctx.lines.push(`${reallyFailedBlock}:`);
  ctx.lines.push(`  br label %${failTarget}`);
  ctx.lines.push(`${okBlock}:`);
  ctx.currentBlock = okBlock;
}

function tailValueAfter(insts, startIndex, valueReg) {
  let current = cleanReg(valueReg);
  for (let i = startIndex; i < insts.length; i++) {
    const inst = insts[i];
    if (inst.op === "guard_pattern" || inst.op === "guard_code" || inst.op === "id") {
      if (cleanReg(inst.src) !== current) return false;
      current = cleanReg(inst.dest);
      continue;
    }
    if (inst.op === "return" && cleanReg(inst.src) === current) {
      return true;
    }
    return false;
  }
  return false;
}

function isSelfTailCall(insts, index, currentFuncName) {
  if (!currentFuncName) return false;
  const inst = insts[index];
  if (inst.op !== "call" || !sameFuncName(inst.func, currentFuncName)) return false;
  const dest = cleanReg(inst.dest);
  return tailValueAfter(insts, index + 1, dest);
}

function hasSelfTailCall(insts, funcName, isTail = true) {
  if (!Array.isArray(insts) || !funcName) return false;
  for (let i = 0; i < insts.length; i++) {
    const inst = insts[i];
    if (isTail && isSelfTailCall(insts, i, funcName)) return true;
    if (inst.branches) {
      const unionIsTail = isTail && tailValueAfter(insts, i + 1, inst.dest);
      for (let bIdx = 0; bIdx < inst.branches.length; bIdx++) {
        const isLast = (bIdx === inst.branches.length - 1);
        if (hasSelfTailCall(inst.branches[bIdx].body, funcName, unionIsTail && isLast)) return true;
      }
    }
  }
  return false;
}

function getFieldEdgeIndex(inst, regPatterns, kvmFunc) {
  const srcReg = cleanReg(inst.src);
  const srcPattern = regPatterns.get(srcReg) || (srcReg === "in" ? kvmFunc.inputPattern : null);
  if (Array.isArray(srcPattern) && srcPattern.length > 0) {
    const root = srcPattern[0];
    if ((root[0] === "open-product" || root[0] === "closed-product") && Array.isArray(root[1])) {
      const idx = root[1].findIndex(([l]) => l === inst.label);
      if (idx >= 0) return idx;
    }
  }
  if (Array.isArray(inst.pattern) && inst.pattern.length > 0) {
    const root = inst.pattern[0];
    if ((root[0] === "open-product" || root[0] === "closed-product") && Array.isArray(root[1])) {
      const idx = root[1].findIndex(([l]) => l === inst.label);
      if (idx >= 0) return idx;
    }
  }
  return -1;
}

function scanCalls(insts, compiled, queue) {
  if (!Array.isArray(insts)) return;
  for (const inst of insts) {
    if (inst.op === "call" && !compiled.has(inst.func) && !queue.includes(inst.func)) {
      queue.push(inst.func);
    }
    if (inst.branches) {
      for (const b of inst.branches) {
        scanCalls(b.body, compiled, queue);
      }
    }
  }
}

export function compileKVMModuleToLLVM(entryName, kvmProgram, options = {}) {
  const functions = kvmProgram.functions || (typeof kvmProgram === "object" && !Array.isArray(kvmProgram) ? kvmProgram : null);
  if (!functions) throw new Error("Expected .kvm input to contain functions");

  const entry = entryName || kvmProgram.entry || "__main__";
  const entryFunc = functions[entry];
  if (!entryFunc) throw new Error(`kVM entry function '${entry}' not found in program`);

  const compiled = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.shift();
    if (compiled.has(name)) continue;
    compiled.add(name);
    const fn = functions[name];
    if (fn?.body) scanCalls(fn.body, compiled, queue);
  }

  const functionNames = new Map();
  functionNames.set(entry, "@k_main");
  let relIndex = 0;
  for (const name of compiled) {
    if (name !== entry) {
      functionNames.set(name, `@k_rel_${llvmIdentifier(name)}_${relIndex++}`);
    }
  }

  const labels = new Map();
  const runtimeMode = options.runtimeMode || "fast";

  const moduleCtx = {
    temp: 0,
    block: 0,
    labels,
    functionNames,
    runtimeMode,
    armIndex: 0,
    unionExprIndex: 0,
    syntheticFunctions: [],
    tempName(prefix) { return `%${prefix}${this.temp++}`; },
    blockName(prefix) { return `bb_${prefix}${this.block++}`; },
    labelRef(text) {
      const sText = String(text);
      let global = this.labels.get(sText);
      if (!global) {
        const index = this.labels.size;
        global = {
          name: `@k_label_${index}`,
          length: Buffer.byteLength(sText, "utf8") + 1,
          byteLength: Buffer.byteLength(sText, "utf8"),
          text: sText
        };
        this.labels.set(sText, global);
      }
      const pointer = this.tempName("label");
      this.lines.push(`  ${pointer} = getelementptr inbounds [${global.length} x i8], ptr ${global.name}, i64 0, i64 0`);
      return { pointer, length: global.byteLength, text: sText };
    }
  };

  const functionBodies = [];

  for (const name of compiled) {
    const kvmFunc = functions[name];
    const symbol = functionNames.get(name);
    const linkage = name === entry ? "" : "internal";

    const funcBody = lowerKVMFunction(kvmFunc, symbol, name, moduleCtx, linkage, { ...options, tailRef: name });
    functionBodies.push(funcBody);
  }

  const relation = options.relation || kvmProgram.relation || entry;
  const payload = JSON.stringify({
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    relation,
    kvm: kvmProgram
  });
  const payloadBytes = Buffer.byteLength(payload, "utf8") + 1;
  const symbol = llvmIdentifier(options.symbol || relation);

  const labelGlobalLines = [...labels.values()].map((label) =>
    `${label.name} = private unnamed_addr constant [${label.length} x i8] c"${cStringBytes(label.text)}", align 1`
  );

  return [
    "; k-llvm prototype artifact (via kVM)",
    `; relation: ${relation}`,
    `source_filename = "k-llvm:${symbol}"`,
    "",
    `@k_llvm_metadata = private unnamed_addr constant [${payloadBytes} x i8] c"${cStringBytes(payload)}", align 1`,
    ...labelGlobalLines,
    "",
    ...runtimeDeclarations(),
    "",
    ...moduleCtx.syntheticFunctions,
    ...functionBodies
  ].join("\n");
}

function lowerKVMFunction(kvmFunc, symbol, funcName, moduleCtx, linkage = "", options = {}) {
  const ctx = {
    temp: moduleCtx.temp,
    block: moduleCtx.block,
    labels: moduleCtx.labels,
    functionNames: moduleCtx.functionNames,
    runtimeMode: moduleCtx.runtimeMode,
    allocas: [],
    lines: [],
    currentBlock: "entry",
    tempName(prefix) {
      const t = moduleCtx.temp++;
      return `%${prefix}${t}`;
    },
    blockName(prefix) {
      const b = moduleCtx.block++;
      return `bb_${prefix}${b}`;
    },
    labelRef(text) {
      return moduleCtx.labelRef.call(this, text);
    }
  };

  const tailRef = options.tailRef !== undefined ? options.tailRef : funcName;
  const isCatchTail = (sameFuncName(funcName, tailRef) || !options.tailRef) && hasSelfTailCall(kvmFunc.body, tailRef);
  ctx.catchTail = isCatchTail;
  const inputVar = isCatchTail ? "%tail_input" : "%input";

  if (isCatchTail) {
    ctx.allocas.push("  %tail_input_slot = alloca ptr");
    ctx.lines.push("  store ptr %input, ptr %tail_input_slot");
    ctx.lines.push("  br label %tail_loop");
    ctx.lines.push("tail_loop:");
    ctx.lines.push("  %tail_input = load ptr, ptr %tail_input_slot");
    ctx.currentBlock = "tail_loop";
  }

  const rootRegValues = new Map();
  const rootRegPatterns = new Map();
  rootRegValues.set("in", inputVar);
  if (Array.isArray(kvmFunc.inputPattern)) {
    rootRegPatterns.set("in", kvmFunc.inputPattern);
  }

  function compileInstList(insts, compOptions = {}) {
    const failTarget = compOptions.failTarget || "func_fail";
    const returnTarget = compOptions.returnTarget || null;
    const nextBlock = compOptions.nextBlock || null;
    const isTopLevel = compOptions.isTopLevel !== false;
    const regValues = compOptions.regValues || rootRegValues;
    const regPatterns = compOptions.regPatterns || rootRegPatterns;
    const getReg = (r) => regValues.get(cleanReg(r)) || regValues.get("in") || inputVar;

    for (let i = 0; i < insts.length; i++) {
      const inst = insts[i];
      switch (inst.op) {
        case "guard_pattern":
        case "guard_code":
        case "id": {
          const rawSrc = cleanReg(inst.src);
          const dest = cleanReg(inst.dest);
          const v = getReg(rawSrc);
          regValues.set(dest, v);
          const pat = inst.pattern || regPatterns.get(rawSrc);
          if (pat) regPatterns.set(dest, pat);
          break;
        }
        case "fail": {
          ctx.lines.push(`  br label %${failTarget}`);
          return;
        }
        case "return": {
          const rawSrc = cleanReg(inst.src);
          const v = getReg(rawSrc);
          if (returnTarget) {
            regValues.set(cleanReg(returnTarget), v);
            if (nextBlock) ctx.lines.push(`  br label %${nextBlock}`);
          } else {
            const status = ctx.tempName("status");
            const result = ctx.tempName("result");
            ctx.lines.push(`  ${status} = insertvalue %k_result undef, i32 0, 0`);
            ctx.lines.push(`  ${result} = insertvalue %k_result ${status}, ptr ${v}, 1`);
            ctx.lines.push(`  ret %k_result ${result}`);
          }
          return;
        }
        case "project_field": {
          const input = getReg(inst.src);
          nullCheck(ctx, input, failTarget);
          const edgeIndex = getFieldEdgeIndex(inst, regPatterns, kvmFunc);
          let val;
          if (edgeIndex >= 0 && ctx.runtimeMode !== "compact") {
            val = lowerProductGetAt(ctx, input, edgeIndex);
          } else {
            const label = ctx.labelRef(inst.label);
            val = ctx.tempName("field");
            if (edgeIndex >= 0) {
              ctx.lines.push(`  ${val} = call ptr @k_product_get_at(ptr ${input}, i64 ${edgeIndex})`);
            } else {
              ctx.lines.push(`  ${val} = call ptr @k_product_get_n(ptr ${input}, ptr ${label.pointer}, i64 ${label.length})`);
            }
          }
          nullCheck(ctx, val, failTarget);
          regValues.set(cleanReg(inst.dest), val);
          if (inst.pattern) regPatterns.set(cleanReg(inst.dest), inst.pattern);
          break;
        }
        case "project_variant": {
          const input = getReg(inst.src);
          nullCheck(ctx, input, failTarget);
          const label = ctx.labelRef(inst.tag);
          const matchBlock = ctx.blockName("tag_match");
          const mismatchBlock = ctx.blockName("tag_mismatch");
          if (ctx.runtimeMode === "compact") {
            const compare = ctx.tempName("tagcmp");
            const matches = ctx.tempName("tagmatch");
            ctx.lines.push(`  ${compare} = call i32 @k_variant_tag_matches(ptr ${input}, ptr ${label.pointer}, i64 ${label.length})`);
            ctx.lines.push(`  ${matches} = icmp ne i32 ${compare}, 0`);
            ctx.lines.push(`  br i1 ${matches}, label %${matchBlock}, label %${mismatchBlock}`);
          } else {
            lowerVariantMatchBranch(ctx, input, label, matchBlock, mismatchBlock);
          }
          ctx.lines.push(`${mismatchBlock}:`);
          ctx.lines.push(`  br label %${failTarget}`);
          ctx.lines.push(`${matchBlock}:`);
          ctx.currentBlock = matchBlock;
          let payload;
          if (ctx.runtimeMode === "compact") {
            payload = ctx.tempName("payload");
            ctx.lines.push(`  ${payload} = call ptr @k_variant_payload(ptr ${input})`);
          } else {
            payload = lowerVariantPayload(ctx, input);
          }
          nullCheck(ctx, payload, failTarget);
          regValues.set(cleanReg(inst.dest), payload);
          if (inst.pattern) regPatterns.set(cleanReg(inst.dest), inst.pattern);
          break;
        }
        case "make_variant": {
          const payload = getReg(inst.src);
          const variant = lowerRawVariant(ctx, inst.tag, payload);
          regValues.set(cleanReg(inst.dest), variant);
          break;
        }
        case "call": {
          const v = getReg(inst.src);
          if (isSelfTailCall(insts, i, tailRef)) {
            if (ctx.catchTail) {
              ctx.lines.push(`  store ptr ${v}, ptr %tail_input_slot`);
              ctx.lines.push("  br label %tail_loop");
              return;
            } else {
              const tailStatus = ctx.tempName("tail_status");
              const tailResult = ctx.tempName("tail_result");
              ctx.lines.push(`  ${tailStatus} = insertvalue %k_result undef, i32 2, 0`);
              ctx.lines.push(`  ${tailResult} = insertvalue %k_result ${tailStatus}, ptr ${v}, 1`);
              ctx.lines.push(`  ret %k_result ${tailResult}`);
              return;
            }
          }
          const targetSymbol = ctx.functionNames.get(inst.func) || `@k_rel_${llvmIdentifier(inst.func)}`;
          const callRes = ctx.tempName("call");
          ctx.lines.push(`  ${callRes} = call %k_result ${targetSymbol}(ptr %rt, ptr ${v})`);
          statusCheck(ctx, callRes, failTarget);
          const retVal = ctx.tempName("call_val");
          ctx.lines.push(`  ${retVal} = extractvalue %k_result ${callRes}, 1`);
          regValues.set(cleanReg(inst.dest), retVal);
          break;
        }
        case "call_intrinsic": {
          const v = getReg(inst.src);
          const intrinsicName = inst.intrinsic || inst.name;
          const res = lowerIntrinsicCall(ctx, intrinsicName, v, failTarget);
          regValues.set(cleanReg(inst.dest), res);
          break;
        }
        case "product": {
          const N = inst.branches.length;
          const fieldValues = [];
          const pSrc = getReg(inst.src);
          const pPattern = regPatterns.get(cleanReg(inst.src)) || (cleanReg(inst.src) === "in" ? regPatterns.get("in") : null);

          for (let bIdx = 0; bIdx < N; bIdx++) {
            const branch = inst.branches[bIdx];
            const branchRes = ctx.tempName(`f${bIdx}_val`);
            const branchBlock = ctx.blockName(`field_${bIdx}`);
            const branchDone = ctx.blockName(`field_${bIdx}_done`);

            ctx.lines.push(`  br label %${branchBlock}`);
            ctx.lines.push(`${branchBlock}:`);
            ctx.currentBlock = branchBlock;

            const branchRegValues = new Map(regValues);
            const branchRegPatterns = new Map(regPatterns);
            branchRegValues.set("in", pSrc);
            if (pPattern) branchRegPatterns.set("in", pPattern);
            else branchRegPatterns.delete("in");

            compileInstList(branch.body, {
              isTopLevel: false,
              regValues: branchRegValues,
              regPatterns: branchRegPatterns,
              returnTarget: branchRes,
              failTarget,
              nextBlock: branchDone
            });

            ctx.lines.push(`${branchDone}:`);
            ctx.currentBlock = branchDone;
            const fVal = branchRegValues.get(cleanReg(branchRes)) || branchRes;
            fieldValues.push({ label: branch.label, val: fVal });
          }

          const requestedSize = K_PRODUCT_HEADER_SIZE + (K_FIELD_SIZE * N);
          const product = lowerRawAlloc(ctx, requestedSize, alignArenaSize(requestedSize));
          nullCheck(ctx, product, failTarget);
          const fields = bytePtr(ctx, product, K_PRODUCT_HEADER_SIZE, "product_fields");
          storeI32At(ctx, product, K_VALUE_KIND_OFFSET, K_VALUE_KIND_PRODUCT);
          storePtrAt(ctx, product, K_VALUE_RT_OFFSET, "%rt");
          storeI64At(ctx, product, K_VALUE_PRODUCT_COUNT_OFFSET, N);
          storeI64At(ctx, product, K_VALUE_PRODUCT_CAPACITY_OFFSET, N);
          storePtrAt(ctx, product, K_VALUE_PRODUCT_FIELDS_OFFSET, fields);

          const sortedFields = [...fieldValues].sort((a, b) => {
            if (a.label < b.label) return -1;
            if (a.label > b.label) return 1;
            return 0;
          });

          for (let sIdx = 0; sIdx < N; sIdx++) {
            const { label: fLabel, val: fVal } = sortedFields[sIdx];
            const labelRef = ctx.labelRef(fLabel);
            const fieldByteSlot = bytePtr(ctx, fields, sIdx * K_FIELD_SIZE, "field_slot");
            storePtrAt(ctx, fieldByteSlot, K_FIELD_LABEL_OFFSET, labelRef.pointer);
            storeI64At(ctx, fieldByteSlot, K_FIELD_LABEL_LENGTH_OFFSET, labelRef.length);
            storePtrAt(ctx, fieldByteSlot, K_FIELD_VALUE_OFFSET, fVal);
          }

          regValues.set(cleanReg(inst.dest), product);
          break;
        }
        case "union": {
          const uInput = getReg(inst.src);

          if (!isTopLevel) {
            // Nested union: synthesize a helper function @k_union_expr_${index}
            const exprIndex = moduleCtx.unionExprIndex++;
            const exprName = `@k_union_expr_${exprIndex}`;
            const exprFunc = {
              name: `union_expr_${exprIndex}`,
              inputPattern: kvmFunc.inputPattern,
              outputPattern: kvmFunc.outputPattern,
              body: [
                { op: "id", dest: "%v0", src: "%in" },
                { ...inst, dest: "%v1", src: "%v0" },
                { op: "return", src: "%v1" }
              ]
            };
            const exprBody = lowerKVMFunction(exprFunc, exprName, exprFunc.name, moduleCtx, "internal", { ...options, tailRef: null });
            moduleCtx.syntheticFunctions.push(exprBody);

            const unionCall = ctx.tempName("call");
            ctx.lines.push(`  ${unionCall} = call %k_result ${exprName}(ptr %rt, ptr ${uInput})`);
            statusCheck(ctx, unionCall, failTarget);
            const unionValue = ctx.tempName("union_value");
            ctx.lines.push(`  ${unionValue} = extractvalue %k_result ${unionCall}, 1`);
            regValues.set(cleanReg(inst.dest), unionValue);
            break;
          }

          // Top-level union: synthesize arm functions @k_union_arm_${index}
          const mark = lowerRtMark(ctx);
          const unionDone = ctx.blockName("union_done");
          const N = inst.branches.length;
          const armResults = [];

          for (let bIdx = 0; bIdx < N; bIdx++) {
            const branch = inst.branches[bIdx];
            const isLast = (bIdx === N - 1);
            const armIndex = moduleCtx.armIndex++;
            const armName = `@k_union_arm_${armIndex}`;

            const armFunc = {
              name: `union_arm_${armIndex}`,
              inputPattern: kvmFunc.inputPattern,
              outputPattern: kvmFunc.outputPattern,
              body: branch.body
            };
            const armTailRef = (isLast && tailValueAfter(insts, i + 1, inst.dest)) ? tailRef : null;
            const armBody = lowerKVMFunction(armFunc, armName, armFunc.name, moduleCtx, "internal", { ...options, tailRef: armTailRef });
            moduleCtx.syntheticFunctions.push(armBody);

            const armCall = ctx.tempName("call");
            ctx.lines.push(`  ${armCall} = call %k_result ${armName}(ptr %rt, ptr ${uInput})`);
            const status = ctx.tempName("status");
            const ok = ctx.tempName("ok");
            const isTail = ctx.tempName("is_tail");
            const tailBlock = ctx.blockName("arm_tail");
            const nonTailBlock = ctx.blockName("arm_nontail");
            const okBlock = ctx.blockName("arm_ok");
            const failBlock = isLast ? failTarget : ctx.blockName("arm_fail");

            ctx.lines.push(`  ${status} = extractvalue %k_result ${armCall}, 0`);
            ctx.lines.push(`  ${isTail} = icmp eq i32 ${status}, 2`);
            ctx.lines.push(`  br i1 ${isTail}, label %${tailBlock}, label %${nonTailBlock}`);

            ctx.lines.push(`${tailBlock}:`);
            if (ctx.catchTail) {
              const tailArg = ctx.tempName("arm_tail_arg");
              ctx.lines.push(`  ${tailArg} = extractvalue %k_result ${armCall}, 1`);
              ctx.lines.push(`  store ptr ${tailArg}, ptr %tail_input_slot`);
              ctx.lines.push("  br label %tail_loop");
            } else {
              ctx.lines.push(`  ret %k_result ${armCall}`);
            }

            ctx.lines.push(`${nonTailBlock}:`);
            ctx.currentBlock = nonTailBlock;
            ctx.lines.push(`  ${ok} = icmp eq i32 ${status}, 0`);
            ctx.lines.push(`  br i1 ${ok}, label %${okBlock}, label %${failBlock}`);

            ctx.lines.push(`${okBlock}:`);
            ctx.currentBlock = okBlock;
            const armVal = ctx.tempName("arm_val");
            ctx.lines.push(`  ${armVal} = extractvalue %k_result ${armCall}, 1`);
            armResults.push({ block: okBlock, val: armVal });
            ctx.lines.push(`  br label %${unionDone}`);

            if (!isLast) {
              ctx.lines.push(`${failBlock}:`);
              ctx.currentBlock = failBlock;
              lowerRtRewind(ctx, mark);
            }
          }

          ctx.lines.push(`${unionDone}:`);
          ctx.currentBlock = unionDone;
          const unionPhi = ctx.tempName("union_res");
          const phiSources = armResults.map((r) => `[${r.val}, %${r.block}]`).join(", ");
          ctx.lines.push(`  ${unionPhi} = phi ptr ${phiSources}`);
          regValues.set(cleanReg(inst.dest), unionPhi);
          break;
        }
        default:
          throw new Error(`Unsupported kVM instruction in LLVM backend: ${inst.op}`);
      }
    }
  }

  compileInstList(kvmFunc.body, { isTopLevel: true });

  ctx.lines.push("func_fail:");
  const failStatus = ctx.tempName("fail_status");
  const failResult = ctx.tempName("fail_result");
  ctx.lines.push(`  ${failStatus} = insertvalue %k_result undef, i32 1, 0`);
  ctx.lines.push(`  ${failResult} = insertvalue %k_result ${failStatus}, ptr null, 1`);
  ctx.lines.push(`  ret %k_result ${failResult}`);

  const prefix = linkage ? `define ${linkage} %k_result` : "define %k_result";
  return [
    `${prefix} ${symbol}(ptr %rt, ptr %input) {`,
    "entry:",
    ...ctx.allocas,
    ...ctx.lines,
    "}",
    ""
  ].join("\n");
}

function lowerIntrinsicCall(ctx, name, input, failTarget) {
  if (!isIntrinsic(name)) {
    throw unsupportedIntrinsic("LLVM kVM compiler", name);
  }

  if (name.startsWith("float64_")) {
    const rawVal = loadPtrAt(ctx, input, K_VALUE_VARIANT_PAYLOAD_OFFSET, "f64_payload");
    const fVal = ctx.tempName("f64");
    ctx.lines.push(`  ${fVal} = load double, ptr ${rawVal}`);

    switch (name) {
      case "float64_neg": {
        const res = ctx.tempName("f64_neg");
        ctx.lines.push(`  ${res} = fneg double ${fVal}`);
        return lowerBoxFloat64(ctx, res);
      }
      case "float64_add":
      case "float64_sub":
      case "float64_mul":
      case "float64_div": {
        const leftPtr = lowerProductGetAt(ctx, input, 0);
        const rightPtr = lowerProductGetAt(ctx, input, 1);
        const lRaw = loadPtrAt(ctx, leftPtr, K_VALUE_VARIANT_PAYLOAD_OFFSET, "f64_lpayload");
        const rRaw = loadPtrAt(ctx, rightPtr, K_VALUE_VARIANT_PAYLOAD_OFFSET, "f64_rpayload");
        const lVal = ctx.tempName("f64_l");
        const rVal = ctx.tempName("f64_r");
        ctx.lines.push(`  ${lVal} = load double, ptr ${lRaw}`);
        ctx.lines.push(`  ${rVal} = load double, ptr ${rRaw}`);
        const op = name === "float64_add" ? "fadd" : name === "float64_sub" ? "fsub" : name === "float64_mul" ? "fmul" : "fdiv";
        const res = ctx.tempName("f64_res");
        ctx.lines.push(`  ${res} = ${op} double ${lVal}, ${rVal}`);
        return lowerBoxFloat64(ctx, res);
      }
    }
  }

  if (name.startsWith("int32_")) {
    const leftPtr = lowerProductGetAt(ctx, input, 0);
    const rightPtr = lowerProductGetAt(ctx, input, 1);
    const lVal = loadI32At(ctx, leftPtr, K_VALUE_VARIANT_PAYLOAD_OFFSET, "i32_l");
    const rVal = loadI32At(ctx, rightPtr, K_VALUE_VARIANT_PAYLOAD_OFFSET, "i32_r");

    switch (name) {
      case "int32_add":
      case "int32_sub":
      case "int32_mul":
      case "int32_div":
      case "int32_mod":
      case "int32_bit_and":
      case "int32_bit_or":
      case "int32_bit_xor":
      case "int32_bit_shl":
      case "int32_bit_shr": {
        const opMap = {
          int32_add: "add",
          int32_sub: "sub",
          int32_mul: "mul",
          int32_div: "sdiv",
          int32_mod: "srem",
          int32_bit_and: "and",
          int32_bit_or: "or",
          int32_bit_xor: "xor",
          int32_bit_shl: "shl",
          int32_bit_shr: "ashr"
        };
        const op = opMap[name];
        const res = ctx.tempName("i32_res");
        ctx.lines.push(`  ${res} = ${op} i32 ${lVal}, ${rVal}`);
        return lowerBoxInt32(ctx, res);
      }
      case "int32_eq":
      case "int32_lt":
      case "int32_gt": {
        const condMap = { int32_eq: "eq", int32_lt: "slt", int32_gt: "sgt" };
        const cond = condMap[name];
        const cmp = ctx.tempName("i32_cmp");
        ctx.lines.push(`  ${cmp} = icmp ${cond} i32 ${lVal}, ${rVal}`);
        return lowerBoxBool(ctx, cmp);
      }
    }
  }

  throw unsupportedIntrinsic("LLVM kVM compiler", name);
}

function lowerBoxFloat64(ctx, val) {
  const payloadAlloc = lowerRawAlloc(ctx, 8, 8);
  ctx.lines.push(`  store double ${val}, ptr ${payloadAlloc}`);
  return lowerRawVariant(ctx, "Float64", payloadAlloc);
}

function lowerBoxInt32(ctx, val) {
  const payloadAlloc = lowerRawAlloc(ctx, 4, 4);
  ctx.lines.push(`  store i32 ${val}, ptr ${payloadAlloc}`);
  return lowerRawVariant(ctx, "Int32", payloadAlloc);
}

function lowerBoxBool(ctx, cmpVal) {
  const trueBlock = ctx.blockName("bool_true");
  const falseBlock = ctx.blockName("bool_false");
  const doneBlock = ctx.blockName("bool_done");

  ctx.lines.push(`  br i1 ${cmpVal}, label %${trueBlock}, label %${falseBlock}`);
  ctx.lines.push(`${trueBlock}:`);
  const trueVal = ctx.tempName("true_val");
  ctx.lines.push(`  ${trueVal} = call ptr @k_bit1(ptr %rt)`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${falseBlock}:`);
  const falseVal = ctx.tempName("false_val");
  ctx.lines.push(`  ${falseVal} = call ptr @k_bit0(ptr %rt)`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  ctx.currentBlock = doneBlock;
  const phi = ctx.tempName("bool_res");
  ctx.lines.push(`  ${phi} = phi ptr [${trueVal}, %${trueBlock}], [${falseVal}, %${falseBlock}]`);
  return phi;
}
