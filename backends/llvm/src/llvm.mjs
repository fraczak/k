import fs from "node:fs";
import {
  decodeObject,
  isIntrinsic,
  unsupportedIntrinsic,
  retypeObjectRelationForBackend
} from "@fraczak/k/backend-api.mjs";

const ARTIFACT_FORMAT = "k-llvm";
const ARTIFACT_VERSION = 1;

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
const K_ARENA_BLOCK_CAPACITY_OFFSET = 16;
const K_ARENA_BLOCK_DATA_OFFSET = 24;

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

function readPattern(inputPattern) {
  if (Array.isArray(inputPattern)) return inputPattern;
  if (typeof inputPattern !== "string" || inputPattern.length === 0) {
    throw new Error("compileToLLVM requires an input pattern property list");
  }
  const text = fs.existsSync(inputPattern) ? fs.readFileSync(inputPattern, "utf8") : inputPattern;
  return JSON.parse(text);
}

export function llvmIdentifier(name) {
  return String(name || "main").replace(/[^A-Za-z0-9_$.-]/g, "_");
}

function llvmStringGlobalName(index) {
  return `@k_label_${index}`;
}

function llvmRelationFunctionName(name, index) {
  return `@k_rel_${llvmIdentifier(name)}_${index}`;
}

function runtimeDeclarations() {
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

function createLoweringContext(functionNames = new Map(), labels = new Map(), syntheticFunctions = [], patternGraph = null, tail = {}) {
  return {
    temp: 0,
    block: 0,
    functionNames,
    labels,
    syntheticFunctions,
    patternGraph,
    runtimeMode: tail.runtimeMode || "fast",
    tailRef: tail.refName || null,
    catchTail: tail.catchTail || false,
    tailInputSlot: tail.inputSlot || null,
    tailLoopBlock: tail.loopBlock || null,
    currentBlock: "entry",
    lines: [],
    addSyntheticFunction(body, tailPosition = false) {
      const name = `@k_union_arm_${this.syntheticFunctions.length}`;
      const index = this.syntheticFunctions.length;
      this.syntheticFunctions.push(null);
      const ctx = createLoweringContext(this.functionNames, this.labels, this.syntheticFunctions, this.patternGraph, {
        refName: this.tailRef,
        runtimeMode: this.runtimeMode
      });
      this.syntheticFunctions[index] = emitFunctionBody(name, body, ctx, "internal", { tail: tailPosition });
      return name;
    },
    addUnionFunction(items, tailPosition = false) {
      const name = `@k_union_expr_${this.syntheticFunctions.length}`;
      const ctx = createLoweringContext(this.functionNames, this.labels, this.syntheticFunctions, this.patternGraph, {
        refName: this.tailRef,
        runtimeMode: this.runtimeMode
      });
      const body = emitUnionFunctionBody(name, items, ctx, "internal", { tail: tailPosition });
      this.syntheticFunctions.push(body);
      return name;
    },
    tempName(prefix) {
      return `%${prefix}${this.temp++}`;
    },
    blockName(prefix) {
      return `bb_${prefix}${this.block++}`;
    },
    labelRef(label) {
      const text = String(label);
      let global = this.labels.get(text);
      if (!global) {
        const index = this.labels.size;
        global = {
          name: llvmStringGlobalName(index),
          length: Buffer.byteLength(text, "utf8") + 1,
          byteLength: Buffer.byteLength(text, "utf8"),
          text
        };
        this.labels.set(text, global);
      }
      const pointer = this.tempName("label");
      this.lines.push(`  ${pointer} = getelementptr inbounds [${global.length} x i8], ptr ${global.name}, i64 0, i64 0`);
      return { pointer, length: global.byteLength, text };
    }
  };
}

function patternNode(ctx, patternId) {
  if (patternId == null || ctx.patternGraph?.nodes == null) return null;
  return ctx.patternGraph.nodes.find((node) => node.id === patternId) || null;
}

function patternEdgeIndex(ctx, patternId, label) {
  const node = patternNode(ctx, patternId);
  const edges = node?.edges;
  if (!Array.isArray(edges)) return -1;
  return edges.findIndex((edge) => edge.label === label);
}

function result(ctx, status, value = "null") {
  const statusValue = ctx.tempName("status");
  const resultValue = ctx.tempName("result");
  return [
    `  ${statusValue} = insertvalue %k_result undef, i32 ${status}, 0`,
    `  ${resultValue} = insertvalue %k_result ${statusValue}, ptr ${value}, 1`,
    `  ret %k_result ${resultValue}`
  ];
}

function unsupported(ctx) {
  ctx.lines.push(...result(ctx, 1));
}

function nullCheck(ctx, value) {
  const missing = ctx.tempName("missing");
  const okBlock = ctx.blockName("ok");
  const missingBlock = ctx.blockName("missing");
  ctx.lines.push(`  ${missing} = icmp eq ptr ${value}, null`);
  ctx.lines.push(`  br i1 ${missing}, label %${missingBlock}, label %${okBlock}`);
  ctx.lines.push(`${missingBlock}:`);
  ctx.lines.push(...result(ctx, 1));
  ctx.lines.push(`${okBlock}:`);
  ctx.currentBlock = okBlock;
}

function bytePtr(ctx, base, offset, prefix = "slot") {
  const slot = ctx.tempName(prefix);
  ctx.lines.push(`  ${slot} = getelementptr inbounds i8, ptr ${base}, i64 ${offset}`);
  return slot;
}

function storeI32At(ctx, base, offset, value) {
  ctx.lines.push(`  store i32 ${value}, ptr ${bytePtr(ctx, base, offset, "i32_slot")}`);
}

function storeI64At(ctx, base, offset, value) {
  ctx.lines.push(`  store i64 ${value}, ptr ${bytePtr(ctx, base, offset, "i64_slot")}`);
}

function storePtrAt(ctx, base, offset, value) {
  ctx.lines.push(`  store ptr ${value}, ptr ${bytePtr(ctx, base, offset, "ptr_slot")}`);
}

function loadI32At(ctx, base, offset, prefix = "i32") {
  const value = ctx.tempName(prefix);
  ctx.lines.push(`  ${value} = load i32, ptr ${bytePtr(ctx, base, offset, `${prefix}_slot`)}`);
  return value;
}

function loadI64At(ctx, base, offset, prefix = "i64") {
  const value = ctx.tempName(prefix);
  ctx.lines.push(`  ${value} = load i64, ptr ${bytePtr(ctx, base, offset, `${prefix}_slot`)}`);
  return value;
}

function loadPtrAt(ctx, base, offset, prefix = "ptr") {
  const value = ctx.tempName(prefix);
  ctx.lines.push(`  ${value} = load ptr, ptr ${bytePtr(ctx, base, offset, `${prefix}_slot`)}`);
  return value;
}

function lowerRawAlloc(ctx, requestedSize, allocatedSize = requestedSize) {
  const blockSlot = bytePtr(ctx, "%rt", K_RT_BLOCKS_OFFSET, "rt_blocks_slot");
  const block = ctx.tempName("arena_block");
  const hasBlock = ctx.tempName("has_block");
  const checkBlock = ctx.blockName("alloc_check");
  const fastBlock = ctx.blockName("alloc_fast");
  const slowBlock = ctx.blockName("alloc_slow");
  const doneBlock = ctx.blockName("alloc_done");

  ctx.lines.push(`  ${block} = load ptr, ptr ${blockSlot}`);
  ctx.lines.push(`  ${hasBlock} = icmp ne ptr ${block}, null`);
  ctx.lines.push(`  br i1 ${hasBlock}, label %${checkBlock}, label %${slowBlock}`);

  ctx.lines.push(`${checkBlock}:`);
  const usedSlot = bytePtr(ctx, block, K_ARENA_BLOCK_USED_OFFSET, "arena_used_slot");
  const capacitySlot = bytePtr(ctx, block, K_ARENA_BLOCK_CAPACITY_OFFSET, "arena_capacity_slot");
  const used = ctx.tempName("arena_used");
  const capacity = ctx.tempName("arena_capacity");
  const remaining = ctx.tempName("arena_remaining");
  const fits = ctx.tempName("arena_fits");
  ctx.lines.push(`  ${used} = load i64, ptr ${usedSlot}`);
  ctx.lines.push(`  ${capacity} = load i64, ptr ${capacitySlot}`);
  ctx.lines.push(`  ${remaining} = sub i64 ${capacity}, ${used}`);
  ctx.lines.push(`  ${fits} = icmp uge i64 ${remaining}, ${allocatedSize}`);
  ctx.lines.push(`  br i1 ${fits}, label %${fastBlock}, label %${slowBlock}`);

  ctx.lines.push(`${fastBlock}:`);
  const data = bytePtr(ctx, block, K_ARENA_BLOCK_DATA_OFFSET, "arena_data");
  const value = ctx.tempName("raw_value");
  const newUsed = ctx.tempName("arena_new_used");
  ctx.lines.push(`  ${value} = getelementptr inbounds i8, ptr ${data}, i64 ${used}`);
  ctx.lines.push(`  ${newUsed} = add i64 ${used}, ${allocatedSize}`);
  ctx.lines.push(`  store i64 ${newUsed}, ptr ${usedSlot}`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${slowBlock}:`);
  const slowValue = ctx.tempName("raw_slow_value");
  ctx.lines.push(`  ${slowValue} = call ptr @k_rt_alloc(ptr %rt, i64 ${requestedSize})`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  const resultValue = ctx.tempName("raw_alloc");
  ctx.lines.push(`  ${resultValue} = phi ptr [${value}, %${fastBlock}], [${slowValue}, %${slowBlock}]`);
  ctx.currentBlock = doneBlock;
  return resultValue;
}

function lowerUnit(ctx) {
  if (ctx.runtimeMode === "compact") {
    const unit = ctx.tempName("unit");
    ctx.lines.push(`  ${unit} = call ptr @k_unit(ptr %rt)`);
    return unit;
  }

  const slot = bytePtr(ctx, "%rt", K_RT_UNIT_CACHE_OFFSET, "rt_unit_slot");
  const cached = ctx.tempName("unit_cached");
  const hasCached = ctx.tempName("unit_cached_ok");
  const hitBlock = ctx.blockName("unit_cached");
  const allocBlock = ctx.blockName("unit_alloc");
  const doneBlock = ctx.blockName("unit_done");

  ctx.lines.push(`  ${cached} = load ptr, ptr ${slot}`);
  ctx.lines.push(`  ${hasCached} = icmp ne ptr ${cached}, null`);
  ctx.lines.push(`  br i1 ${hasCached}, label %${hitBlock}, label %${allocBlock}`);

  ctx.lines.push(`${hitBlock}:`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${allocBlock}:`);
  const allocated = lowerRawAlloc(ctx, K_PRODUCT_HEADER_SIZE, K_PRODUCT_HEADER_SIZE);
  storeI32At(ctx, allocated, K_VALUE_KIND_OFFSET, K_VALUE_KIND_PRODUCT);
  storePtrAt(ctx, allocated, K_VALUE_RT_OFFSET, "%rt");
  storeI64At(ctx, allocated, K_VALUE_PRODUCT_COUNT_OFFSET, 0);
  storeI64At(ctx, allocated, K_VALUE_PRODUCT_CAPACITY_OFFSET, 0);
  storePtrAt(ctx, allocated, K_VALUE_PRODUCT_FIELDS_OFFSET, "null");
  ctx.lines.push(`  store ptr ${allocated}, ptr ${slot}`);
  const allocatedBlock = ctx.currentBlock;
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  const unit = ctx.tempName("unit");
  ctx.lines.push(`  ${unit} = phi ptr [${cached}, %${hitBlock}], [${allocated}, %${allocatedBlock}]`);
  ctx.currentBlock = doneBlock;
  return unit;
}

function lowerBit(ctx, tag) {
  if (ctx.runtimeMode === "compact") {
    const bit = ctx.tempName("bit");
    ctx.lines.push(`  ${bit} = call ptr @k_bit${tag}(ptr %rt)`);
    return bit;
  }

  const cacheOffset = tag === "0" ? K_RT_BIT0_CACHE_OFFSET : K_RT_BIT1_CACHE_OFFSET;
  const slot = bytePtr(ctx, "%rt", cacheOffset, `rt_bit${tag}_slot`);
  const cached = ctx.tempName("bit_cached");
  const hasCached = ctx.tempName("bit_cached_ok");
  const hitBlock = ctx.blockName("bit_cached");
  const allocBlock = ctx.blockName("bit_alloc");
  const doneBlock = ctx.blockName("bit_done");

  ctx.lines.push(`  ${cached} = load ptr, ptr ${slot}`);
  ctx.lines.push(`  ${hasCached} = icmp ne ptr ${cached}, null`);
  ctx.lines.push(`  br i1 ${hasCached}, label %${hitBlock}, label %${allocBlock}`);

  ctx.lines.push(`${hitBlock}:`);
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${allocBlock}:`);
  const unit = lowerUnit(ctx);
  nullCheck(ctx, unit);
  const allocated = lowerRawVariant(ctx, tag, unit);
  ctx.lines.push(`  store ptr ${allocated}, ptr ${slot}`);
  const allocatedBlock = ctx.currentBlock;
  ctx.lines.push(`  br label %${doneBlock}`);

  ctx.lines.push(`${doneBlock}:`);
  const bit = ctx.tempName("bit");
  ctx.lines.push(`  ${bit} = phi ptr [${cached}, %${hitBlock}], [${allocated}, %${allocatedBlock}]`);
  ctx.currentBlock = doneBlock;
  return bit;
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

function statusCheck(ctx, callResult) {
  const status = ctx.tempName("status");
  const failed = ctx.tempName("failed");
  const okBlock = ctx.blockName("ok");
  const failedBlock = ctx.blockName("failed");
  ctx.lines.push(`  ${status} = extractvalue %k_result ${callResult}, 0`);
  ctx.lines.push(`  ${failed} = icmp ne i32 ${status}, 0`);
  ctx.lines.push(`  br i1 ${failed}, label %${failedBlock}, label %${okBlock}`);
  ctx.lines.push(`${failedBlock}:`);
  if (ctx.catchTail) {
    const isTail = ctx.tempName("tail_status");
    const tailBlock = ctx.blockName("tail");
    const returnBlock = ctx.blockName("return_failed");
    ctx.lines.push(`  ${isTail} = icmp eq i32 ${status}, 2`);
    ctx.lines.push(`  br i1 ${isTail}, label %${tailBlock}, label %${returnBlock}`);
    ctx.lines.push(`${tailBlock}:`);
    const tailInput = ctx.tempName("tail_input");
    ctx.lines.push(`  ${tailInput} = extractvalue %k_result ${callResult}, 1`);
    ctx.lines.push(`  store ptr ${tailInput}, ptr ${ctx.tailInputSlot}`);
    ctx.lines.push(`  br label %${ctx.tailLoopBlock}`);
    ctx.lines.push(`${returnBlock}:`);
  }
  ctx.lines.push(`  ret %k_result ${callResult}`);
  ctx.lines.push(`${okBlock}:`);
}

function unionBranch(ctx, functionName, input, isLast) {
  const mark = ctx.runtimeMode === "compact" ? ctx.tempName("mark") : lowerRtMark(ctx);
  const callResult = ctx.tempName("union");
  const status = ctx.tempName("status");
  const failed = ctx.tempName("failed");
  const successBlock = ctx.blockName("union_success");
  const failedDispatchBlock = ctx.blockName("union_failed");
  const tailBlock = ctx.blockName("union_tail");
  const nextBlock = isLast ? null : ctx.blockName("union_next");
  const failureBlock = isLast ? ctx.blockName("union_failure") : nextBlock;
  if (ctx.runtimeMode === "compact") {
    ctx.lines.push(`  ${mark} = call %k_rt_mark @k_rt_mark(ptr %rt)`);
  }
  ctx.lines.push(`  ${callResult} = call %k_result ${functionName}(ptr %rt, ptr ${input})`);
  ctx.lines.push(`  ${status} = extractvalue %k_result ${callResult}, 0`);
  ctx.lines.push(`  ${failed} = icmp ne i32 ${status}, 0`);
  ctx.lines.push(`  br i1 ${failed}, label %${failedDispatchBlock}, label %${successBlock}`);
  ctx.lines.push(`${failedDispatchBlock}:`);
  const isTail = ctx.tempName("tail_status");
  ctx.lines.push(`  ${isTail} = icmp eq i32 ${status}, 2`);
  ctx.lines.push(`  br i1 ${isTail}, label %${tailBlock}, label %${failureBlock}`);
  ctx.lines.push(`${tailBlock}:`);
  ctx.lines.push(`  ret %k_result ${callResult}`);
  ctx.lines.push(`${successBlock}:`);
  const value = ctx.tempName("union_value");
  ctx.lines.push(`  ${value} = extractvalue %k_result ${callResult}, 1`);
  ctx.lines.push(...result(ctx, 0, value));
  if (isLast) {
    ctx.lines.push(`${failureBlock}:`);
    if (ctx.runtimeMode === "compact") {
      ctx.lines.push(`  call void @k_rt_rewind(ptr %rt, %k_rt_mark ${mark})`);
    } else {
      lowerRtRewind(ctx, mark);
    }
    ctx.lines.push(...result(ctx, 1));
  } else {
    ctx.lines.push(`${nextBlock}:`);
    if (ctx.runtimeMode === "compact") {
      ctx.lines.push(`  call void @k_rt_rewind(ptr %rt, %k_rt_mark ${mark})`);
    } else {
      lowerRtRewind(ctx, mark);
    }
  }
}

function emitUnionFunctionBody(symbol, items, ctx, linkage = "", options = {}) {
  if (!items?.length) {
    unsupported(ctx);
  } else {
    items.forEach((item, index) => {
      unionBranch(ctx, ctx.addSyntheticFunction(item, options.tail === true), "%input", index === items.length - 1);
    });
  }
  const prefix = linkage ? `define ${linkage} %k_result` : "define %k_result";
  return [
    `${prefix} ${symbol}(ptr %rt, ptr %input) {`,
    "entry:",
    ...ctx.lines,
    "}",
    ""
  ];
}

function isTailNeutral(exp) {
  if (exp == null) return false;
  if (exp.op === "identity" || exp.op === "code" || exp.op === "filter") return true;
  return exp.op === "comp" && exp.items.every(isTailNeutral);
}

function isTailSelfRef(exp, ctx) {
  return exp?.op === "ref" && exp.ref === ctx.tailRef;
}

function hasTailSelfRefSuffix(items, index, ctx) {
  let seenSelfRef = false;
  for (let i = index; i < items.length; i++) {
    const item = items[i];
    if (!seenSelfRef && isTailSelfRef(item, ctx)) {
      seenSelfRef = true;
      continue;
    }
    if (!isTailNeutral(item)) return false;
  }
  return seenSelfRef;
}

function lowerTailSelfRef(ctx, input) {
  if (ctx.catchTail) {
    ctx.lines.push(`  store ptr ${input}, ptr ${ctx.tailInputSlot}`);
    ctx.lines.push(`  br label %${ctx.tailLoopBlock}`);
  } else {
    ctx.lines.push(...result(ctx, 2, input));
  }
  return false;
}

function lowerProductSetAt(ctx, product, edgeIndex, label, value) {
  const fields = loadPtrAt(ctx, product, K_VALUE_PRODUCT_FIELDS_OFFSET, "product_fields_ptr");
  const slot = bytePtr(ctx, fields, edgeIndex * K_FIELD_SIZE, "field_slot");
  storePtrAt(ctx, slot, K_FIELD_LABEL_OFFSET, label.pointer);
  storeI64At(ctx, slot, K_FIELD_LABEL_LENGTH_OFFSET, label.length);
  storePtrAt(ctx, slot, K_FIELD_VALUE_OFFSET, value);

  const countSlot = bytePtr(ctx, product, K_VALUE_PRODUCT_COUNT_OFFSET, "product_count_slot");
  const count = ctx.tempName("product_count");
  const needsCountUpdate = ctx.tempName("product_count_update");
  const updateBlock = ctx.blockName("product_count_update");
  const doneBlock = ctx.blockName("product_count_done");
  ctx.lines.push(`  ${count} = load i64, ptr ${countSlot}`);
  ctx.lines.push(`  ${needsCountUpdate} = icmp ule i64 ${count}, ${edgeIndex}`);
  ctx.lines.push(`  br i1 ${needsCountUpdate}, label %${updateBlock}, label %${doneBlock}`);
  ctx.lines.push(`${updateBlock}:`);
  ctx.lines.push(`  store i64 ${edgeIndex + 1}, ptr ${countSlot}`);
  ctx.lines.push(`  br label %${doneBlock}`);
  ctx.lines.push(`${doneBlock}:`);
  ctx.currentBlock = doneBlock;
}

function lowerTailSelfProduct(ctx, exp, input) {
  const outputNode = patternNode(ctx, exp.patterns?.[1]);
  const edges = outputNode?.edges;
  if (!Array.isArray(edges) || edges.length !== exp.fields.length) return null;

  const seen = new Set();
  const fields = [];
  for (const field of exp.fields) {
    const edgeIndex = patternEdgeIndex(ctx, exp.patterns?.[1], field.label);
    if (edgeIndex < 0 || seen.has(edgeIndex)) return null;
    seen.add(edgeIndex);
    const child = lowerExpr(ctx, field.expr, input);
    if (child === false || child == null) return child;
    fields.push({ field, edgeIndex, child });
  }
  if (seen.size !== edges.length) return null;

  for (const { field, edgeIndex, child } of fields) {
    const label = ctx.labelRef(field.label);
    if (ctx.runtimeMode === "compact") {
      ctx.lines.push(`  call void @k_product_set_at(ptr ${input}, i64 ${edgeIndex}, ptr ${label.pointer}, i64 ${label.length}, ptr ${child})`);
    } else {
      lowerProductSetAt(ctx, input, edgeIndex, label, child);
    }
  }
  return lowerTailSelfRef(ctx, input);
}

function lowerUnitVariantConstant(ctx, tag) {
  if (tag === "0" || tag === "1") {
    const bit = lowerBit(ctx, tag);
    nullCheck(ctx, bit);
    return bit;
  }
  if (ctx.runtimeMode === "compact") {
    const label = ctx.labelRef(tag);
    const variant = ctx.tempName("variant");
    ctx.lines.push(`  ${variant} = call ptr @k_variant_unit_borrowed_n(ptr %rt, ptr ${label.pointer}, i64 ${label.length})`);
    nullCheck(ctx, variant);
    return variant;
  }
  const unit = lowerUnit(ctx);
  nullCheck(ctx, unit);
  return lowerRawVariant(ctx, tag, unit);
}

function lowerRawVariant(ctx, tag, payload) {
  const label = ctx.labelRef(tag);
  if (ctx.runtimeMode === "compact") {
    const variant = ctx.tempName("variant");
    ctx.lines.push(`  ${variant} = call ptr @k_variant_borrowed_direct_n(ptr %rt, ptr ${label.pointer}, i64 ${label.length}, ptr ${payload})`);
    nullCheck(ctx, variant);
    return variant;
  }
  const variant = lowerRawAlloc(ctx, K_VALUE_SIZE, K_VALUE_ALLOC_SIZE);
  nullCheck(ctx, variant);
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

function rawProductPlan(ctx, exp) {
  const capacity = exp.fields.length;
  const slots = new Array(capacity);
  const seen = new Set();
  for (let fieldIndex = 0; fieldIndex < exp.fields.length; fieldIndex++) {
    const field = exp.fields[fieldIndex];
    const edgeIndex = patternEdgeIndex(ctx, exp.patterns?.[1], field.label);
    if (edgeIndex < 0 || edgeIndex >= capacity || seen.has(edgeIndex)) return null;
    seen.add(edgeIndex);
    slots[edgeIndex] = fieldIndex;
  }
  if (seen.size !== capacity || slots.some((slot) => slot == null)) return null;
  return { capacity, slots };
}

function lowerRawProduct(ctx, exp, input, plan) {
  const loweredFields = [];
  for (const field of exp.fields) {
    const child = lowerExpr(ctx, field.expr, input);
    if (child === false || child == null) return child;
    loweredFields.push({
      child,
      label: ctx.labelRef(field.label)
    });
  }

  const requestedSize = K_PRODUCT_HEADER_SIZE + (K_FIELD_SIZE * plan.capacity);
  const product = lowerRawAlloc(ctx, requestedSize, alignArenaSize(requestedSize));
  nullCheck(ctx, product);
  const fields = bytePtr(ctx, product, K_PRODUCT_HEADER_SIZE, "product_fields");
  storeI32At(ctx, product, K_VALUE_KIND_OFFSET, K_VALUE_KIND_PRODUCT);
  storePtrAt(ctx, product, K_VALUE_RT_OFFSET, "%rt");
  storeI64At(ctx, product, K_VALUE_PRODUCT_COUNT_OFFSET, plan.capacity);
  storeI64At(ctx, product, K_VALUE_PRODUCT_CAPACITY_OFFSET, plan.capacity);
  storePtrAt(ctx, product, K_VALUE_PRODUCT_FIELDS_OFFSET, fields);

  for (let slotIndex = 0; slotIndex < plan.slots.length; slotIndex++) {
    const lowered = loweredFields[plan.slots[slotIndex]];
    const slot = bytePtr(ctx, fields, slotIndex * K_FIELD_SIZE, "field_slot");
    storePtrAt(ctx, slot, K_FIELD_LABEL_OFFSET, lowered.label.pointer);
    storeI64At(ctx, slot, K_FIELD_LABEL_LENGTH_OFFSET, lowered.label.length);
    storePtrAt(ctx, slot, K_FIELD_VALUE_OFFSET, lowered.child);
  }

  return product;
}

function lowerRuntimeProduct(ctx, exp, input) {
  const product = ctx.tempName("product");
  ctx.lines.push(`  ${product} = call ptr @k_product(ptr %rt, i64 ${exp.fields.length})`);
  for (const field of exp.fields) {
    const child = lowerExpr(ctx, field.expr, input);
    if (child == null) return null;
    const label = ctx.labelRef(field.label);
    const edgeIndex = patternEdgeIndex(ctx, exp.patterns?.[1], field.label);
    if (edgeIndex >= 0) {
      ctx.lines.push(`  call void @k_product_set_at(ptr ${product}, i64 ${edgeIndex}, ptr ${label.pointer}, i64 ${label.length}, ptr ${child})`);
    } else {
      ctx.lines.push(`  call void @k_product_set_borrowed_n(ptr ${product}, ptr ${label.pointer}, i64 ${label.length}, ptr ${child})`);
    }
  }
  return product;
}

function lowerExpr(ctx, exp, input = "%input", options = {}) {
  switch (exp?.op) {
    case "empty":
      return null;
    case "identity":
    case "code":
    case "filter":
      return input;
    case "ref": {
      const functionName = ctx.functionNames.get(exp.ref);
      if (!functionName) {
        if (isIntrinsic(exp.ref)) throw unsupportedIntrinsic("LLVM compiler", exp.ref);
        return null;
      }
      if (options.tail === true && exp.ref === ctx.tailRef) {
        return lowerTailSelfRef(ctx, input);
      }
      const callResult = ctx.tempName("call");
      ctx.lines.push(`  ${callResult} = call %k_result ${functionName}(ptr %rt, ptr ${input})`);
      statusCheck(ctx, callResult);
      const value = ctx.tempName("ref");
      ctx.lines.push(`  ${value} = extractvalue %k_result ${callResult}, 1`);
      return value;
    }
    case "dot": {
      const edgeIndex = patternEdgeIndex(ctx, exp.patterns?.[0], exp.label);
      let value;
      if (edgeIndex >= 0 && ctx.runtimeMode !== "compact") {
        value = lowerProductGetAt(ctx, input, edgeIndex);
      } else {
        const label = ctx.labelRef(exp.label);
        value = ctx.tempName("field");
        if (edgeIndex >= 0) {
          ctx.lines.push(`  ${value} = call ptr @k_product_get_at(ptr ${input}, i64 ${edgeIndex})`);
        } else {
          ctx.lines.push(`  ${value} = call ptr @k_product_get_n(ptr ${input}, ptr ${label.pointer}, i64 ${label.length})`);
        }
      }
      nullCheck(ctx, value);
      return value;
    }
    case "div": {
      const label = ctx.labelRef(exp.tag);
      const matchBlock = ctx.blockName("tag_match");
      const mismatchBlock = ctx.blockName("tag_mismatch");
      if (ctx.runtimeMode === "compact") {
        const matches = ctx.tempName("tagmatch");
        const compare = ctx.tempName("tagcmp");
        ctx.lines.push(`  ${compare} = call i32 @k_variant_tag_matches(ptr ${input}, ptr ${label.pointer}, i64 ${label.length})`);
        ctx.lines.push(`  ${matches} = icmp ne i32 ${compare}, 0`);
        ctx.lines.push(`  br i1 ${matches}, label %${matchBlock}, label %${mismatchBlock}`);
      } else {
        lowerVariantMatchBranch(ctx, input, label, matchBlock, mismatchBlock);
      }
      ctx.lines.push(`${mismatchBlock}:`);
      ctx.lines.push(...result(ctx, 1));
      ctx.lines.push(`${matchBlock}:`);
      let payload;
      if (ctx.runtimeMode === "compact") {
        payload = ctx.tempName("payload");
        ctx.lines.push(`  ${payload} = call ptr @k_variant_payload(ptr ${input})`);
      } else {
        payload = lowerVariantPayload(ctx, input);
      }
      nullCheck(ctx, payload);
      return payload;
    }
    case "vid": {
      return lowerRawVariant(ctx, exp.tag, input);
    }
    case "comp": {
      let current = input;
      for (let index = 0; index < exp.items.length; index++) {
        const item = exp.items[index];
        const next = exp.items[index + 1];
        if (item?.op === "product" && item.fields.length === 0 && next?.op === "vid") {
          current = lowerUnitVariantConstant(ctx, next.tag);
          index++;
          continue;
        }
        if (options.tail === true && item?.op === "product" && hasTailSelfRefSuffix(exp.items, index + 1, ctx)) {
          const tailProduct = lowerTailSelfProduct(ctx, item, current);
          if (tailProduct !== null) return tailProduct;
        }
        const tail = options.tail === true && exp.items.slice(index + 1).every(isTailNeutral);
        current = lowerExpr(ctx, item, current, { tail });
        if (current === false) return false;
        if (current == null) return null;
      }
      return current;
    }
    case "product": {
      if (exp.fields.length === 0) {
        const unit = lowerUnit(ctx);
        nullCheck(ctx, unit);
        return unit;
      }
      if (ctx.runtimeMode === "compact") return lowerRuntimeProduct(ctx, exp, input);
      const plan = rawProductPlan(ctx, exp);
      if (plan != null) return lowerRawProduct(ctx, exp, input, plan);
      return lowerRuntimeProduct(ctx, exp, input);
    }
    case "union": {
      if (!exp.items?.length) return null;
      const functionName = ctx.addUnionFunction(exp.items, options.tail === true);
      const callResult = ctx.tempName("union");
      ctx.lines.push(`  ${callResult} = call %k_result ${functionName}(ptr %rt, ptr ${input})`);
      statusCheck(ctx, callResult);
      const value = ctx.tempName("union_value");
      ctx.lines.push(`  ${value} = extractvalue %k_result ${callResult}, 1`);
      return value;
    }
    default:
      return null;
  }
}

function entryRelation(kir) {
  const entry = kir?.rels?.[kir.main];
  if (!entry) throw new Error(`KIR main relation '${kir?.main}' is missing`);
  return entry;
}

function labelGlobals(ctx) {
  return [...ctx.labels.values()].map((label) =>
    `${label.name} = private unnamed_addr constant [${label.length} x i8] c"${cStringBytes(label.text)}", align 1`);
}

function emitFunctionBody(symbol, body, ctx, linkage = "", options = {}) {
  const input = ctx.catchTail ? "%tail_input" : "%input";
  if (ctx.catchTail) {
    ctx.tailInputSlot = "%tail_input_slot";
    ctx.tailLoopBlock = "tail_loop";
    ctx.lines.push(`  ${ctx.tailInputSlot} = alloca ptr`);
    ctx.lines.push(`  store ptr %input, ptr ${ctx.tailInputSlot}`);
    ctx.lines.push(`  br label %${ctx.tailLoopBlock}`);
    ctx.lines.push(`${ctx.tailLoopBlock}:`);
    ctx.lines.push(`  ${input} = load ptr, ptr ${ctx.tailInputSlot}`);
  }
  const value = lowerExpr(ctx, body, input, { tail: options.tail !== false });
  if (value === false) {
    // The expression emitted complete control flow, including all returns.
  } else if (value == null) {
    unsupported(ctx);
  } else {
    ctx.lines.push(...result(ctx, 0, value));
  }
  const prefix = linkage ? `define ${linkage} %k_result` : "define %k_result";
  return [
    `${prefix} ${symbol}(ptr %rt, ptr %input) {`,
    "entry:",
    ...ctx.lines,
    "}",
    ""
  ];
}

function sortedRelationEntries(kir) {
  return Object.entries(kir.rels || {})
    .filter(([name]) => name !== kir.main)
    .sort(([a], [b]) => a.localeCompare(b));
}

function relationFunctionNames(kir) {
  return new Map(sortedRelationEntries(kir).map(([name], index) => [
    name,
    llvmRelationFunctionName(name, index)
  ]));
}

export function emitLLVMModule(kir, options = {}) {
  const labels = new Map();
  const syntheticFunctions = [];
  const functionNames = relationFunctionNames(kir);
  const runtimeMode = options.runtimeMode || "fast";
  const relationFunctions = sortedRelationEntries(kir).flatMap(([name, rel]) => {
    const ctx = createLoweringContext(functionNames, labels, syntheticFunctions, rel.patternGraph || null, {
      refName: name,
      catchTail: true,
      runtimeMode
    });
    return emitFunctionBody(functionNames.get(name), rel.body, ctx, "internal");
  });
  const entry = entryRelation(kir);
  const mainContext = createLoweringContext(functionNames, labels, syntheticFunctions, entry.patternGraph || null, {
    runtimeMode
  });
  const functionBody = emitFunctionBody("@k_main", entry.body, mainContext);
  const relation = options.relation || kir.main || "main";
  const payload = JSON.stringify({
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    relation,
    kir
  });
  const payloadBytes = Buffer.byteLength(payload, "utf8") + 1;
  const symbol = llvmIdentifier(options.symbol || relation);

  return [
    "; k-llvm prototype artifact",
    `; relation: ${relation}`,
    `source_filename = "k-llvm:${symbol}"`,
    "",
    `@k_llvm_metadata = private unnamed_addr constant [${payloadBytes} x i8] c"${cStringBytes(payload)}", align 1`,
    ...labelGlobals({ labels }),
    "",
    ...runtimeDeclarations(),
    "",
    ...syntheticFunctions.flat(),
    ...relationFunctions,
    ...functionBody
  ].join("\n");
}

export function compileObjectToLLVM(object, options = {}) {
  const inputPattern = readPattern(options.inputPattern);
  const { relation, kir, inputPattern: entryInputPattern, outputPattern } = retypeObjectRelationForBackend(object, options.relation || object.main, inputPattern, {
    source: options.source || "<k-llvm>"
  });
  return {
    kir,
    relation,
    inputPattern: entryInputPattern,
    outputPattern,
    llvm: emitLLVMModule(kir, { ...options, relation })
  };
}

export function compileBufferToLLVM(buffer, options = {}) {
  return compileObjectToLLVM(decodeObject(buffer), options);
}

export {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION
};

export default {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION,
  compileBufferToLLVM,
  compileObjectToLLVM,
  emitLLVMModule,
  llvmIdentifier
};
