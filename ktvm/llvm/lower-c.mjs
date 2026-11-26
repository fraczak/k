/**
 * `mono` kTVM -> Standalone Native C99 / LLVM Codegen (`k/ktvm/llvm/lower-c.mjs`).
 *
 * Compiles any validated concrete `mono` kTVM module into a single self-contained
 * C99 source file embedding `runtime.h`, ready for `clang -O3`:
 *   - Global Moore-minimized schema DFA (`KTVM_SCHEMA_NODES`, `KTVM_SCHEMA_EDGES`)
 *   - Canonical `k-wire` bit encodings for all interned tags (for general native
 *     k-wire header verification across all Unicode planes)
 *   - Pre-encoded input/output `k-wire` header prefixes (O(headerBytes) memcmp!)
 *   - Packed `static const` 16-byte tables (`chunk_table`, `stack_table`, `fsm_table`)
 *   - Straight-line C instantiation functions for `proc`, `switch` arms, `spec` branches
 *   - Direct `goto` / `switch (ks->pc)` state machines for every `kernel`
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { unpackInt32Base64 } from "../ast.mjs";
import { validateModule } from "../validator.mjs";
import {
  compileSchemaExprToPlist,
  mooreMinimize
} from "../schema.mjs";
import { BitDeque } from "../bit-deque.mjs";
import {
  dequeToPaddedBytes,
  encodePayloadToDeque
} from "../wire.mjs";
import { Value } from "../../Value.mjs";
import {
  choiceWidth,
  CORE_PATTERN_PROPERTY_LIST
} from "../../codecs/runtime/prefix-codec.mjs";
import { textToStringValue } from "../../codecs/runtime/unicode-string.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_H_SOURCE = fs.readFileSync(path.join(__dirname, "runtime.h"), "utf8");

function propertyListToPatternVal(plist) {
  const UNIT = Value.product({});
  const encodeKBitsUint = (n) => {
    if (n === 0) return Value.variant("_", UNIT);
    const bits = [];
    let v = n;
    while (v > 0) { bits.push(v & 1 ? "1" : "0"); v = Math.floor(v / 2); }
    let cur = Value.variant("_", UNIT);
    for (let i = bits.length - 1; i >= 0; i--) cur = Value.variant(bits[i], cur);
    return cur;
  };
  let listVal = Value.variant("nil", UNIT);
  for (let i = plist.length - 1; i >= 0; i--) {
    const [kind, edges] = plist[i];
    let nodeVal;
    if (kind === "any") {
      nodeVal = Value.variant("any", UNIT);
    } else {
      let edgeList = Value.variant("nil", UNIT);
      for (let j = edges.length - 1; j >= 0; j--) {
        const [label, target] = edges[j];
        edgeList = Value.variant("cons", Value.product({
          car: Value.product({ label: textToStringValue(label), target: encodeKBitsUint(target) }),
          cdr: edgeList
        }));
      }
      nodeVal = Value.variant(kind, edgeList);
    }
    listVal = Value.variant("cons", Value.product({ car: nodeVal, cdr: listVal }));
  }
  return listVal;
}

function encodePatternHeaderBits(plist) {
  const patVal = propertyListToPatternVal(plist);
  const dq = new BitDeque(-1);
  encodePayloadToDeque(patVal, CORE_PATTERN_PROPERTY_LIST, dq, 0);
  const bitLen = dq.length;
  const bytes = dequeToPaddedBytes(dq);
  dq.release();
  return { bytes, bitLen };
}

function encodeTagWireBits(tagStr) {
  const strVal = textToStringValue(String(tagStr));
  const dq = new BitDeque(-1);
  encodePayloadToDeque(strVal, CORE_PATTERN_PROPERTY_LIST, dq, 7);
  const bitLen = dq.length;
  const bytes = dequeToPaddedBytes(dq);
  dq.release();
  return { bytes, bitLen };
}

function formatByteArray(bytes) {
  if (!bytes || bytes.length === 0) return "{ 0 }";
  const parts = [];
  for (let i = 0; i < bytes.length; i += 24) {
    const slice = [];
    for (let j = i; j < Math.min(bytes.length, i + 24); j++) {
      slice.push(`0x${bytes[j].toString(16).padStart(2, "0")}`);
    }
    parts.push("  " + slice.join(", "));
  }
  return "{\n" + parts.join(",\n") + "\n}";
}

function collectSwitchOuterIO(stmts, outerChans) {
  const local = new Set();
  const cons = new Set();
  const prod = new Set();
  const walk = (list) => {
    for (const s of list || []) {
      switch (s.op) {
        case "chan": local.add(s.name); break;
        case "drain": if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src); break;
        case "gate":
        case "splice":
        case "coerce":
        case "wrap":
        case "match":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          if (!local.has(s.dst) && outerChans.has(s.dst)) prod.add(s.dst);
          break;
        case "const_unit":
          if (!local.has(s.dst) && outerChans.has(s.dst)) prod.add(s.dst);
          break;
        case "tee":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          for (const d of s.dsts) if (!local.has(d) && outerChans.has(d)) prod.add(d);
          break;
        case "demux":
          if (!local.has(s.src) && outerChans.has(s.src)) cons.add(s.src);
          for (const f of s.fields) if (!local.has(f.name) && outerChans.has(f.name)) prod.add(f.name);
          break;
        case "mux":
          for (const f of s.fields) if (!local.has(f.name) && outerChans.has(f.name)) cons.add(f.name);
          if (!local.has(s.dst) && outerChans.has(s.dst)) prod.add(s.dst);
          break;
        case "spawn":
        case "exec":
          for (const v of s.inputs) if (!local.has(v) && outerChans.has(v)) cons.add(v);
          for (const v of s.outputs) if (!local.has(v) && outerChans.has(v)) prod.add(v);
          break;
        case "switch": {
          const first = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
          walk(first);
          break;
        }
        case "spec":
          for (const v of s.inputs) if (!local.has(v) && outerChans.has(v)) cons.add(v);
          for (const v of s.outputs) if (!local.has(v) && outerChans.has(v)) prod.add(v);
          break;
      }
    }
  };
  walk(stmts);
  return { cons, prod };
}

function packKind(k) {
  const s = typeof k === "string" ? k : (k?.ident ?? "NEED_MORE");
  if (s === "CONT") return 0;
  if (s === "EXIT") return 1;
  if (s === "NEED_MORE") return 2;
  return 3;
}

/**
 * Compile a concrete `mono` kTVM module into standalone C99 source code.
 */
export function compileKTVMToC(
  mod,
  {
    entry = null,
    validate = true,
    verifyTables = true,
    acceptedInputPlists = []
  } = {}
) {
  if (mod.layer !== "mono") {
    throw new Error(`compileKTVMToC requires a 'mono' kTVM module (got '${mod.layer}')`);
  }
  if (validate) {
    validateModule(mod, { verifyTables });
  }

  const entryName = entry || mod.entry;
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
  const schemaDecls = new Map((mod.schemas || []).map((s) => [s.name, s]));

  const entryTarget = procMap.get(entryName) || kernelMap.get(entryName);
  if (!entryTarget) throw new Error(`Unknown entry '${entryName}'`);
  if (entryTarget.inputs.length !== 1 || entryTarget.outputs.length !== 1) {
    throw new Error(`compileKTVMToC requires single-input, single-output entry '${entryName}'`);
  }

  // --- 1. Global Moore-Minimized Schema Table & Tag Interning ---
  const tagToId = new Map();
  const tagStrings = [];
  const internTag = (tag) => {
    const s = String(tag);
    let id = tagToId.get(s);
    if (id === undefined) {
      id = tagStrings.length;
      tagToId.set(s, id);
      tagStrings.push(s);
    }
    return id;
  };

  const plistCache = new Map();
  const resolvePlist = (expr) => {
    const key = JSON.stringify(expr);
    if (!plistCache.has(key)) {
      const raw = compileSchemaExprToPlist(expr, schemaDecls, { allowOpen: false });
      plistCache.set(key, mooreMinimize(raw, 0).plist);
    }
    return plistCache.get(key);
  };

  const schemaByMoore = new Map();
  const schemaNodes = [];

  const internPlistState = (plist, nodeId = 0) => {
    const min = mooreMinimize(plist, nodeId);
    if (schemaByMoore.has(min.key)) return schemaByMoore.get(min.key).id;
    const localToGlobal = new Array(min.plist.length);
    const newlyAdded = [];
    for (let i = 0; i < min.plist.length; i++) {
      const sm = i === 0 ? min : mooreMinimize(min.plist, i);
      if (schemaByMoore.has(sm.key)) {
        localToGlobal[i] = schemaByMoore.get(sm.key).id;
      } else {
        const id = schemaNodes.length;
        const entryNode = { id, key: sm.key, kind: min.plist[i][0], edges: null };
        schemaNodes.push(entryNode);
        schemaByMoore.set(sm.key, entryNode);
        localToGlobal[i] = id;
        newlyAdded.push({ i, entryNode });
      }
    }
    for (const { i, entryNode } of newlyAdded) {
      const [, rawEdges] = min.plist[i];
      entryNode.edges = rawEdges.map(([lbl, tgt]) => [internTag(lbl), localToGlobal[tgt]]);
    }
    return localToGlobal[0];
  };

  internPlistState([["closed-product", []]], 0); // ID 0 = unit
  const internSchemaExpr = (expr) => internPlistState(resolvePlist(expr), 0);

  const inPlist = resolvePlist(entryTarget.inputs[0].schema);
  const outPlist = resolvePlist(entryTarget.outputs[0].schema);
  const inSchemaId = internPlistState(inPlist, 0);
  const outSchemaId = internPlistState(outPlist, 0);

  const walkBlockSchemas = (stmts) => {
    for (const s of stmts || []) {
      if (s.schema) internSchemaExpr(s.schema);
      if (s.srcSchema) internSchemaExpr(s.srcSchema);
      if (s.dstSchema) internSchemaExpr(s.dstSchema);
      if (s.tag !== undefined) internTag(s.tag);
      if (s.op === "switch") {
        for (const a of s.arms) {
          for (const p of a.patterns) if (p.kind === "tag") internTag(p.tag);
          walkBlockSchemas(a.body);
        }
        if (s.defaultBody) walkBlockSchemas(s.defaultBody);
      } else if (s.op === "spec") {
        for (const b of s.branches) walkBlockSchemas(b.body);
      }
    }
  };
  for (const p of mod.procs || []) {
    for (const i of p.inputs) internSchemaExpr(i.schema);
    for (const o of p.outputs) internSchemaExpr(o.schema);
    walkBlockSchemas(p.body);
  }
  for (const k of mod.kernels || []) {
    for (const i of k.inputs) internSchemaExpr(i.schema);
    for (const o of k.outputs) internSchemaExpr(o.schema);
    for (const b of k.blocks || []) {
      for (const s of b.stmts) {
        if (s.nextSchema) internSchemaExpr(s.nextSchema);
        if (s.schema) internSchemaExpr(s.schema);
        if (s.srcSchema) internSchemaExpr(s.srcSchema);
        if (s.dstSchema) internSchemaExpr(s.dstSchema);
      }
    }
  }

  // --- 2. Build Static C Data Declarations ---
  const dataDecls = [];
  const forwardDecls = [];
  const funcDefs = [];

  // Schema edges & nodes
  const flatEdges = [];
  const nodeRows = [];
  for (const sn of schemaNodes) {
    const edgesOff = flatEdges.length;
    const isUnion = sn.kind === "closed-union";
    const w = isUnion ? choiceWidth(sn.edges.length) : 0;
    for (const [tid, tgt] of sn.edges) flatEdges.push(`  { ${tid}, ${tgt} }`);
    nodeRows.push(`  { ${isUnion ? 1 : 0}, ${w}, ${sn.edges.length}, ${edgesOff} }`);
  }
  if (flatEdges.length === 0) flatEdges.push("  { 0, 0 }");

  dataDecls.push(`const KtvmSchemaEdge KTVM_SCHEMA_EDGES[] = {\n${flatEdges.join(",\n")}\n};`);
  dataDecls.push(`const KtvmSchemaNode KTVM_SCHEMA_NODES[] = {\n${nodeRows.join(",\n")}\n};`);
  dataDecls.push(`const int32_t KTVM_NUM_SCHEMA_NODES = ${schemaNodes.length};`);
  dataDecls.push(`const int32_t KTVM_IN_SCHEMA_ID = ${inSchemaId};`);
  dataDecls.push(`const int32_t KTVM_OUT_SCHEMA_ID = ${outSchemaId};`);

  // Interned tag k-wire bit arrays
  const tagWireRows = [];
  for (let i = 0; i < tagStrings.length; i++) {
    const tw = encodeTagWireBits(tagStrings[i]);
    dataDecls.push(`static const uint8_t KTVM_TAG_BYTES_${i}[] = ${formatByteArray(tw.bytes)};`);
    tagWireRows.push(`  { KTVM_TAG_BYTES_${i}, ${tw.bitLen} }`);
  }
  if (tagWireRows.length === 0) {
    dataDecls.push("static const uint8_t KTVM_TAG_BYTES_0[] = { 0 };");
    tagWireRows.push("  { KTVM_TAG_BYTES_0, 0 }");
  }
  dataDecls.push(`const KtvmTagWire KTVM_TAG_WIRES[] = {\n${tagWireRows.join(",\n")}\n};`);
  dataDecls.push(`const int32_t KTVM_NUM_TAGS = ${tagStrings.length};`);

  // Pre-encoded input/output headers (canonical Moore-minimized + any extra accepted input headers)
  const inHeader = encodePatternHeaderBits(inPlist);
  const outHeader = encodePatternHeaderBits(outPlist);
  const headerPresets = [inHeader];
  const seenHdrHex = new Set([Buffer.from(inHeader.bytes).toString("hex") + ":" + inHeader.bitLen]);
  for (const extraPl of acceptedInputPlists || []) {
    if (!extraPl) continue;
    try {
      const h = encodePatternHeaderBits(extraPl);
      const hk = Buffer.from(h.bytes).toString("hex") + ":" + h.bitLen;
      if (!seenHdrHex.has(hk)) {
        seenHdrHex.add(hk);
        headerPresets.push(h);
      }
    } catch { /* ignore invalid extra hint */ }
  }
  const hdrPresetRows = [];
  for (let i = 0; i < headerPresets.length; i++) {
    dataDecls.push(`static const uint8_t KTVM_IN_HDR_${i}[] = ${formatByteArray(headerPresets[i].bytes)};`);
    hdrPresetRows.push(`  { KTVM_IN_HDR_${i}, ${headerPresets[i].bitLen} }`);
  }
  dataDecls.push(`const KtvmHeaderPreset KTVM_ACCEPTED_IN_HEADERS[] = {\n${hdrPresetRows.join(",\n")}\n};`);
  dataDecls.push(`const int32_t KTVM_NUM_ACCEPTED_IN_HEADERS = ${headerPresets.length};`);
  dataDecls.push(`const uint8_t KTVM_OUT_HDR_BYTES[] = ${formatByteArray(outHeader.bytes)};`);
  dataDecls.push(`const int32_t KTVM_OUT_HDR_BITS = ${outHeader.bitLen};`);

  // --- 3. Emit Packed Tables (`chunk_table`, `stack_table`, `fsm_table`) ---
  const tableVarName = new Map();
  let totalTableBytes = 0;
  let tblSeq = 0;

  for (const t of mod.tables || []) {
    const entries = t.entries || [];
    let numEntries = 0;
    if (t.packedBase64) {
      const words = unpackInt32Base64(t.packedBase64);
      const stride = t.props?.stride || 2;
      numEntries = Math.floor(words.length / stride);
    } else {
      for (const row of entries) if (row.index + 1 > numEntries) numEntries = row.index + 1;
    }

    const entryBuf = new Uint8Array(Math.max(1, numEntries) * 16);
    const dv = new DataView(entryBuf.buffer);
    if (t.packedBase64) {
      const words = unpackInt32Base64(t.packedBase64);
      const stride = t.props?.stride || 2;
      for (let i = 0; i < numEntries; i++) {
        const w0 = words[i * stride] | 0;
        const w1 = stride >= 2 ? (words[i * stride + 1] | 0) : 0;
        if (t.kind === "chunk_table") {
          dv.setUint8(i * 16 + 0, w0 & 3);
          dv.setUint8(i * 16 + 1, (w0 >>> 2) & 0x3f);
          dv.setUint8(i * 16 + 2, (w0 >>> 8) & 0xff);
          dv.setUint8(i * 16 + 3, (w0 >>> 16) & 0xff);
          dv.setUint8(i * 16 + 4, (w0 >>> 24) & 0xff);
          dv.setUint32(i * 16 + 8, w1 >>> 0, true);
        } else {
          dv.setUint8(i * 16 + 0, 2);
        }
      }
    } else {
      for (let i = 0; i < numEntries; i++) dv.setUint8(i * 16 + 0, 2);
      for (const row of entries) {
        const off = row.index * 16;
        const v = row.value;
        const kind = packKind(v.kind);
        dv.setUint8(off + 0, kind);
        if (t.kind === "chunk_table") {
          dv.setUint8(off + 1, (kind === 1 ? (v.exit ?? 0) : (v.next_q ?? 0)) & 0xff);
          const sh = v.shift || [];
          const el = v.emit_len || [];
          const ew = v.emit_word || [];
          dv.setUint8(off + 2, (sh[0] ?? 0) & 0xff);
          dv.setUint8(off + 3, (sh[1] ?? 0) & 0xff);
          dv.setUint8(off + 4, (el[0] ?? 0) & 0xff);
          dv.setUint8(off + 5, (el[1] ?? 0) & 0xff);
          dv.setUint32(off + 8, (ew[0] ?? 0) >>> 0, true);
          dv.setUint32(off + 12, (ew[1] ?? 0) >>> 0, true);
        } else if (t.kind === "stack_table") {
          dv.setUint8(off + 1, (kind === 1 ? (v.exit ?? 0) : (v.next_q ?? 0)) & 0xff);
          dv.setUint8(off + 2, (v.shift_stream ?? 0) & 0xff);
          dv.setUint8(off + 3, (v.pop_stack ?? 0) & 0xff);
          dv.setUint8(off + 4, (v.push_stack_len ?? 0) & 0xff);
          dv.setUint8(off + 5, (v.emit_len ?? 0) & 0xff);
          dv.setUint32(off + 8, (v.push_stack_word ?? 0) >>> 0, true);
          dv.setUint32(off + 12, (v.emit_word ?? 0) >>> 0, true);
        } else if (t.kind === "fsm_table") {
          dv.setUint8(off + 1, (v.exit ?? 0) & 0xff);
          const sh = v.shift || [];
          const el = v.emit_len || [];
          const ew = v.emit_word || [];
          dv.setUint8(off + 2, (sh[0] ?? 0) & 0xff);
          dv.setUint8(off + 4, (el[0] ?? 0) & 0xff);
          dv.setUint8(off + 5, (el[1] ?? 0) & 0xff);
          dv.setUint32(off + 8, (ew[0] ?? 0) >>> 0, true);
          dv.setUint32(off + 12, (ew[1] ?? 0) >>> 0, true);
        }
      }
    }

    const tid = tblSeq++;
    const eVar = `KTVM_TBL_DATA_${tid}`;
    const mVar = `KTVM_TBL_META_${tid}`;
    tableVarName.set(t.name, mVar);
    totalTableBytes += entryBuf.length;
    dataDecls.push(`static const uint8_t ${eVar}[] = ${formatByteArray(entryBuf)};`);

    if (t.kind === "chunk_table") {
      const ins = t.props.inputs || [];
      const outs = t.props.outputs || [];
      const maskOf = (inp) => (inp && inp.compress && typeof inp.compress.mask === "number" ? (inp.compress.mask | 0) : -1);
      const modeOf = (o) => ((o?.mode?.ident ?? o?.mode ?? "push") === "unshift" ? 1 : 0);
      dataDecls.push(
        `static const KtvmTableMeta ${mVar} = { 0, ${t.props.states ?? 1}, ${ins.length}, ${outs.length}, ` +
        `${ins[0]?.raw_bits ?? 0}, ${ins[0]?.eff_bits ?? ins[0]?.raw_bits ?? 0}, ${maskOf(ins[0])}, ` +
        `${ins[1]?.raw_bits ?? 0}, ${ins[1]?.eff_bits ?? ins[1]?.raw_bits ?? 0}, ${maskOf(ins[1])}, ` +
        `${modeOf(outs[0])}, ${modeOf(outs[1])}, 0, 0, ${numEntries}, ${eVar} };`
      );
    } else if (t.kind === "stack_table") {
      const wStream = t.props.stream_bits ?? 0;
      const wStack = t.props.stack_bits ?? 0;
      const encStr = t.props.stack_encoding?.ident ?? t.props.stack_encoding ?? "bits";
      const stEnc = encStr === "depth_only" ? 1 : 0;
      const stStride = stEnc === 1 ? (wStack + 1) : ((1 << (wStack + 1)) - 1);
      const outMode = (t.props.output_mode?.ident ?? t.props.output_mode ?? "push") === "unshift" ? 1 : 0;
      dataDecls.push(
        `static const KtvmTableMeta ${mVar} = { 1, ${t.props.states ?? 1}, 1, 1, ` +
        `${wStream}, ${wStream}, ${stEnc}, 0, 0, -1, ${outMode}, 0, ${wStack}, ${stStride}, ${numEntries}, ${eVar} };`
      );
    } else if (t.kind === "fsm_table") {
      const wRaw = t.props.input_bits ?? 0;
      const nOut = (t.props.outputs || []).length || 1;
      dataDecls.push(
        `static const KtvmTableMeta ${mVar} = { 2, 1, 1, ${nOut}, ` +
        `${wRaw}, ${wRaw}, -1, 0, 0, -1, 0, 0, 0, 0, ${numEntries}, ${eVar} };`
      );
    }
  }

  // --- 4. Pre-register Proc & Kernel Function Names ---
  let fnSeq = 0;
  let descSeq = 0;
  const procFnName = new Map();
  const kernelMeta = new Map();

  for (const p of mod.procs || []) {
    const fn = `ktvm_proc_${fnSeq++}`;
    procFnName.set(p.name, fn);
    forwardDecls.push(`static void ${fn}(KtvmRuntime *rt, KtvmScope *sc, void **env);`);
  }

  for (const k of mod.kernels || []) {
    const fn = `ktvm_kern_${fnSeq++}`;
    forwardDecls.push(`static int ${fn}(KtvmRuntime *rt, KtvmNode *n);`);
    const regs = k.regs || [];
    const stacks = k.stacks || [];
    const inToIdx = new Map(k.inputs.map((p, i) => [p.name, i]));
    const outToIdx = new Map(k.outputs.map((p, i) => [p.name, i]));
    const regToIdx = new Map(regs.map((r, i) => [r.name, i]));
    const stackToIdx = new Map(stacks.map((s, i) => [s.name, i]));
    const tempToIdx = new Map();
    for (const blk of k.blocks || []) {
      for (const s of blk.stmts) {
        if ((s.op === "peek_bits" || s.op === "stack_pop") && !tempToIdx.has(s.dst)) {
          tempToIdx.set(s.dst, tempToIdx.size);
        }
      }
    }
    let regInitVar = "NULL";
    if (regs.length > 0) {
      regInitVar = `KTVM_REG_INIT_${fn}`;
      dataDecls.push(`static const int32_t ${regInitVar}[] = { ${regs.map((r) => r.init | 0).join(", ")} };`);
    }
    kernelMeta.set(k.name, {
      fn,
      inCount: k.inputs.length,
      outCount: k.outputs.length,
      numRegs: regs.length,
      numStacks: stacks.length,
      numTemps: tempToIdx.size,
      regInitVar,
      inToIdx,
      outToIdx,
      regToIdx,
      stackToIdx,
      tempToIdx
    });
  }

  // --- 5. Compile Proc / Switch-Arm / Spec-Branch Instantiation Functions ---
  function compileBlockFn(fnName, stmts, envSlots) {
    const chanLocal = new Map();
    const barLocal = new Map();
    const tokLocal = new Map();
    const decls = [];
    const body = [];
    let lvSeq = 0;

    for (let i = 0; i < envSlots.length; i++) {
      const slot = envSlots[i];
      const lv = `v_${lvSeq++}`;
      if (slot.kind === "chan") {
        decls.push(`  KtvmChan *${lv} = (KtvmChan *)env[${i}];`);
        chanLocal.set(slot.name, lv);
      } else if (slot.kind === "barrier") {
        decls.push(`  KtvmBarrier *${lv} = (KtvmBarrier *)env[${i}];`);
        barLocal.set(slot.name, lv);
      } else if (slot.kind === "token") {
        decls.push(`  KtvmToken *${lv} = (KtvmToken *)env[${i}];`);
        tokLocal.set(slot.name, lv);
      }
    }

    const emitNode = (kind, ins, outs, extraLines) => {
      const nv = `n_${lvSeq++}`;
      body.push(`  {`);
      body.push(`    KtvmNode *${nv} = ktvm_node_alloc(rt, sc, ${kind}, ${ins.length}, ${outs.length});`);
      body.push(`    if (${nv}) {`);
      for (let i = 0; i < ins.length; i++) body.push(`      ktvm_node_set_in(${nv}, ${i}, ${chanLocal.get(ins[i])});`);
      for (let i = 0; i < outs.length; i++) body.push(`      ktvm_node_set_out(${nv}, ${i}, ${chanLocal.get(outs[i])});`);
      for (const el of extraLines) body.push(`      ${el.replaceAll("$N", nv)}`);
      body.push(`    }`);
      body.push(`  }`);
    };

    for (const s of stmts || []) {
      switch (s.op) {
        case "chan": {
          const lv = `v_${lvSeq++}`;
          const sid = internSchemaExpr(s.schema);
          decls.push(`  KtvmChan *${lv} = ktvm_chan_alloc(rt, sc, ${sid});`);
          chanLocal.set(s.name, lv);
          break;
        }
        case "barrier": {
          const lv = `v_${lvSeq++}`;
          decls.push(`  KtvmBarrier *${lv} = ktvm_barrier_alloc(rt);`);
          barLocal.set(s.name, lv);
          break;
        }
        case "const_unit":
          emitNode("NK_CONST_UNIT", [], [s.dst], []);
          break;
        case "splice":
          emitNode("NK_SPLICE", [s.src], [s.dst], []);
          break;
        case "coerce": {
          const sSid = internSchemaExpr(s.srcSchema);
          const dSid = internSchemaExpr(s.dstSchema);
          emitNode("NK_COERCE", [s.src], [s.dst], [`$N->a0 = ${sSid}; $N->a1 = ${dSid};`]);
          break;
        }
        case "wrap":
          emitNode("NK_WRAP", [s.src], [s.dst], [`$N->a0 = ${internTag(s.tag)};`]);
          break;
        case "match":
          emitNode("NK_MATCH", [s.src], [s.dst], [`$N->a0 = ${internTag(s.tag)};`]);
          break;
        case "demux": {
          const pSid = internSchemaExpr(s.schema);
          const sorted = [...s.fields].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
          emitNode("NK_DEMUX", [s.src], sorted.map((f) => f.name), [`$N->a0 = ${pSid};`]);
          break;
        }
        case "mux": {
          const pSid = internSchemaExpr(s.schema);
          const sorted = [...s.fields].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
          emitNode("NK_MUX", sorted.map((f) => f.name), [s.dst], [`$N->a0 = ${pSid};`]);
          break;
        }
        case "tee":
          emitNode("NK_TEE", [s.src], s.dsts, []);
          break;
        case "drain": {
          const sid = internSchemaExpr(s.schema);
          const barExpr = s.barrier ? barLocal.get(s.barrier) : "NULL";
          const extra = [`$N->a0 = ${sid};`, `$N->p1 = ${barExpr};`];
          if (s.barrier) {
            extra.push(`if (${barExpr}) { ${barExpr}->pending++; $N->p2 = ${barExpr}->first_drain; ${barExpr}->first_drain = $N; }`);
          }
          emitNode("NK_DRAIN", [s.src], [], extra);
          break;
        }
        case "gate":
          emitNode("NK_GATE", [s.src], [s.dst], [`$N->p0 = ${barLocal.get(s.barrier)};`]);
          break;
        case "spawn": {
          const targetFn = procFnName.get(s.target);
          if (!targetFn) throw new Error(`Unknown spawn target '${s.target}'`);
          const extra = [`$N->p0 = (void *)${targetFn};`];
          if (s.after) extra.push(`$N->p1 = ${tokLocal.get(s.after)};`);
          if (s.token) {
            const tv = `v_${lvSeq++}`;
            decls.push(`  KtvmToken *${tv} = NULL;`);
            tokLocal.set(s.token, tv);
            extra.push(`${tv} = ktvm_token_alloc(rt, $N->outs, ${s.outputs.length});`);
            extra.push(`$N->p2 = ${tv};`);
          }
          emitNode("NK_SPAWN", s.inputs, s.outputs, extra);
          break;
        }
        case "exec": {
          const km = kernelMeta.get(s.target);
          if (!km) throw new Error(`Unknown exec target '${s.target}'`);
          const nv = `n_${lvSeq++}`;
          body.push(`  {`);
          body.push(`    KtvmNode *${nv} = ktvm_emit_kernel(rt, sc, ${km.fn}, ${km.inCount}, ${km.outCount}, ${km.numRegs}, ${km.numStacks}, ${km.numTemps}, ${km.regInitVar});`);
          body.push(`    if (${nv}) {`);
          for (let i = 0; i < s.inputs.length; i++) body.push(`      ktvm_node_set_in(${nv}, ${i}, ${chanLocal.get(s.inputs[i])});`);
          for (let i = 0; i < s.outputs.length; i++) body.push(`      ktvm_node_set_out(${nv}, ${i}, ${chanLocal.get(s.outputs[i])});`);
          body.push(`    }`);
          body.push(`  }`);
          break;
        }
        case "switch": {
          const firstBody = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
          const { cons: swCons, prod: swProd } = collectSwitchOuterIO(firstBody, chanLocal);
          const remIns = [...swCons];
          const remOuts = [...swProd];

          const capSlots = [];
          for (const [nm] of chanLocal.entries()) capSlots.push({ kind: "chan", name: nm });
          for (const [nm] of barLocal.entries()) capSlots.push({ kind: "barrier", name: nm });
          for (const [nm] of tokLocal.entries()) capSlots.push({ kind: "token", name: nm });

          let testedMask = 0;
          for (const arm of s.arms) {
            for (let j = 0; j < arm.patterns.length; j++) {
              if (arm.patterns[j].kind === "tag") testedMask |= (1 << j);
            }
          }

          const did = descSeq++;
          const armRows = [];
          for (let a = 0; a < s.arms.length; a++) {
            const arm = s.arms[a];
            const armFn = `ktvm_sw_${fnSeq++}`;
            forwardDecls.push(`static void ${armFn}(KtvmRuntime *rt, KtvmScope *sc, void **env);`);
            compileBlockFn(armFn, arm.body, capSlots);
            const patVar = `KTVM_SW_PAT_${did}_${a}`;
            const pats = arm.patterns.map((p) => (p.kind === "tag" ? internTag(p.tag) : -1));
            dataDecls.push(`static const int32_t ${patVar}[] = { ${pats.join(", ")} };`);
            armRows.push(`  { ${armFn}, ${patVar} }`);
          }
          let defFn = "NULL";
          if (s.defaultBody) {
            defFn = `ktvm_swd_${fnSeq++}`;
            forwardDecls.push(`static void ${defFn}(KtvmRuntime *rt, KtvmScope *sc, void **env);`);
            compileBlockFn(defFn, s.defaultBody, capSlots);
          }
          const armsVar = `KTVM_SW_ARMS_${did}`;
          const descVar = `KTVM_SW_DESC_${did}`;
          if (armRows.length === 0) armRows.push("  { NULL, NULL }");
          dataDecls.push(`static const KtvmSwitchArm ${armsVar}[] = {\n${armRows.join(",\n")}\n};`);
          dataDecls.push(`static const KtvmSwitchDesc ${descVar} = { ${s.inputs.length}, ${s.arms.length}, ${testedMask >>> 0}u, ${armsVar}, ${defFn} };`);

          const extra = [
            `$N->a0 = ${capSlots.length};`,
            `$N->p0 = (void *)&${descVar};`,
            `KtvmChan **insp = (KtvmChan **)ktvm_alloc(rt, ${Math.max(1, s.inputs.length)} * sizeof(KtvmChan *));`,
            ...s.inputs.map((inp, j) => `insp[${j}] = ${chanLocal.get(inp)};`),
            `$N->p1 = insp;`,
            `void **cap = (void **)ktvm_alloc(rt, ${Math.max(1, capSlots.length)} * sizeof(void *));`,
            ...capSlots.map((sl, j) => {
              const lv = sl.kind === "chan" ? chanLocal.get(sl.name)
                : (sl.kind === "barrier" ? barLocal.get(sl.name) : tokLocal.get(sl.name));
              return `cap[${j}] = (void *)${lv};`;
            }),
            `$N->p2 = cap;`
          ];
          emitNode("NK_SWITCH", remIns, remOuts, extra);
          break;
        }
        case "spec": {
          const brSlots = [
            ...s.inputs.map((nm) => ({ kind: "chan", name: nm })),
            ...s.outputs.map((nm) => ({ kind: "chan", name: nm }))
          ];
          const did = descSeq++;
          const brFns = [];
          for (const br of s.branches) {
            const bFn = `ktvm_sp_${fnSeq++}`;
            forwardDecls.push(`static void ${bFn}(KtvmRuntime *rt, KtvmScope *sc, void **env);`);
            compileBlockFn(bFn, br.body, brSlots);
            brFns.push(bFn);
          }
          const brArrVar = `KTVM_SP_BRS_${did}`;
          const descVar = `KTVM_SP_DESC_${did}`;
          dataDecls.push(`static const KtvmBlockFn ${brArrVar}[] = { ${brFns.length > 0 ? brFns.join(", ") : "NULL"} };`);
          dataDecls.push(`static const KtvmSpecDesc ${descVar} = { ${s.inputs.length}, ${s.outputs.length}, ${brFns.length}, ${brArrVar} };`);

          const extra = [
            `$N->p0 = (void *)&${descVar};`,
            `KtvmChan **reps = (KtvmChan **)ktvm_alloc(rt, ${Math.max(1, s.inputs.length)} * sizeof(KtvmChan *));`,
            ...s.inputs.map((_, j) => `reps[${j}] = ktvm_chan_alloc(rt, NULL, 0);`),
            `$N->p1 = reps;`
          ];
          emitNode("NK_SPEC", s.inputs, s.outputs, extra);
          break;
        }
        default:
          throw new Error(`Unsupported proc statement '${s.op}' in C backend`);
      }
    }

    funcDefs.push(
      `static void ${fnName}(KtvmRuntime *rt, KtvmScope *sc, void **env) {\n` +
      `  (void)rt; (void)sc; (void)env;\n` +
      decls.join("\n") + (decls.length ? "\n" : "") +
      body.join("\n") + (body.length ? "\n" : "") +
      `}`
    );
  }

  for (const p of mod.procs || []) {
    const envSlots = [
      ...p.inputs.map((x) => ({ kind: "chan", name: x.name })),
      ...p.outputs.map((x) => ({ kind: "chan", name: x.name }))
    ];
    compileBlockFn(procFnName.get(p.name), p.body, envSlots);
  }

  // --- 6. Compile Kernel Direct-Goto State Machines ---
  for (const k of mod.kernels || []) {
    const km = kernelMeta.get(k.name);
    const labelToId = new Map();
    const states = []; // { id, label, stmts, term, fallthroughId }

    const SUSPEND_OPS = new Set([
      "peek_bits", "shift_bits", "shift_tag", "drain_guard", "dpda_copy", "dpda_coerce", "yield"
    ]);

    // Ensure `entry` block is ALWAYS state 0 (`ks->pc == 0`)!
    const rawBlocks = [
      ...(k.blocks || []).filter((b) => b.label === "entry"),
      ...(k.blocks || []).filter((b) => b.label !== "entry")
    ];
    let nextId = 0;

    for (const blk of rawBlocks) {
      const startId = nextId;
      labelToId.set(blk.label, startId);

      // Split block around every suspend point so resume never re-executes prior side effects!
      const chunks = [];
      let curStmts = [];
      for (const s of blk.stmts) {
        if (SUSPEND_OPS.has(s.op) && curStmts.length > 0) {
          chunks.push(curStmts);
          curStmts = [s];
        } else {
          curStmts.push(s);
          if (s.op === "drain_guard" || s.op === "dpda_copy" || s.op === "dpda_coerce" || s.op === "yield") {
            chunks.push(curStmts);
            curStmts = [];
          }
        }
      }
      if (curStmts.length > 0 || chunks.length === 0) chunks.push(curStmts);

      for (let c = 0; c < chunks.length; c++) {
        const id = nextId++;
        const isLast = c === chunks.length - 1;
        states.push({
          id,
          stmts: chunks[c],
          term: isLast ? blk.term : null,
          fallthroughId: isLast ? -1 : id + 1
        });
      }
    }

    const lines = [];
    lines.push(`static int ${km.fn}(KtvmRuntime *rt, KtvmNode *n) {`);
    lines.push(`  KtvmKernelState *ks = (KtvmKernelState *)n->p1;`);
    lines.push(`  switch (ks->pc) {`);
    for (const st of states) {
      lines.push(`    case ${st.id}: goto L_${st.id};`);
    }
    lines.push(`    default: return ktvm_k_fail(rt, n);`);
    lines.push(`  }`);

    const emitTableDispatchC = (exits, curStateId) => {
      const shortId = labelToId.get(exits.short);
      const failId = exits.fail ? labelToId.get(exits.fail) : -1;
      lines.push(`  if (tres == 1) { ks->pc = ${curStateId}; return STEP_NEED_PULL; }`);
      lines.push(`  if (tres == 0) { ks->pc = ${curStateId}; return STEP_YIELDED; }`);
      lines.push(`  if (tres == 2) goto L_${shortId};`);
      if (failId >= 0) lines.push(`  if (tres == 4) goto L_${failId};`);
      else lines.push(`  if (tres == 4) return ktvm_k_fail(rt, n);`);
      // tres == 3 -> exit switch
      const exitKeys = Object.keys(exits).filter((ek) => ek !== "short" && ek !== "fail");
      if (exitKeys.length === 1) {
        lines.push(`  goto L_${labelToId.get(exits[exitKeys[0]])};`);
      } else {
        lines.push(`  switch (ks->last_exit) {`);
        for (const ek of exitKeys) {
          lines.push(`    case ${Number(ek)}: goto L_${labelToId.get(exits[ek])};`);
        }
        lines.push(`    default: return ktvm_k_fail(rt, n);`);
        lines.push(`  }`);
      }
    };

    for (const st of states) {
      lines.push(`L_${st.id}: {`);
      for (const s of st.stmts) {
        switch (s.op) {
          case "peek_bits": {
            const inIdx = km.inToIdx.get(s.src);
            const tIdx = km.tempToIdx.get(s.dst);
            const need = s.offset + s.width;
            const eofId = labelToId.get(s.onEof);
            lines.push(`  { KtvmChan *ch = n->ins[${inIdx}];`);
            lines.push(`    if (ch->status == CHAN_FAILED) return ktvm_k_fail(rt, n);`);
            lines.push(`    if (ch->len < ${need}) {`);
            lines.push(`      if (ch->status == CHAN_OPEN) { rt->need_pull = ch; ks->pc = ${st.id}; return STEP_NEED_PULL; }`);
            lines.push(`      goto L_${eofId};`);
            lines.push(`    }`);
            lines.push(`    ks->temps[${tIdx}] = ktvm_bd_peek_bits_at(ch, ${s.offset}, ${s.width});`);
            lines.push(`  }`);
            break;
          }
          case "shift_bits": {
            const inIdx = km.inToIdx.get(s.src);
            lines.push(`  { KtvmChan *ch = n->ins[${inIdx}];`);
            if (s.width > 0) {
              lines.push(`    if (ch->len < ${s.width}) {`);
              lines.push(`      if (ch->status == CHAN_OPEN) { rt->need_pull = ch; ks->pc = ${st.id}; return STEP_NEED_PULL; }`);
              lines.push(`      return ktvm_k_fail(rt, n);`);
              lines.push(`    }`);
              lines.push(`    ktvm_bd_shift_bits(ch, ${s.width});`);
            }
            lines.push(`    ch->aligned = 0; }`);
            break;
          }
          case "shift_tag": {
            const inIdx = km.inToIdx.get(s.src);
            const nextSid = internSchemaExpr(s.nextSchema);
            lines.push(`  { KtvmChan *ch = n->ins[${inIdx}];`);
            if (s.width > 0) {
              lines.push(`    if (ch->len < ${s.width}) {`);
              lines.push(`      if (ch->status == CHAN_OPEN) { rt->need_pull = ch; ks->pc = ${st.id}; return STEP_NEED_PULL; }`);
              lines.push(`      return ktvm_k_fail(rt, n);`);
              lines.push(`    }`);
              lines.push(`    ktvm_bd_shift_bits(ch, ${s.width});`);
            }
            lines.push(`    ch->cons_schema = ${nextSid}; ch->aligned = 1; }`);
            break;
          }
          case "push_bits": {
            const outIdx = km.outToIdx.get(s.dst);
            const val = parseInt(s.bits, 2) >>> 0;
            lines.push(`  ktvm_bd_push_bits(rt, n->outs[${outIdx}], ${val}u, ${s.width});`);
            lines.push(`  if (rt->error_code) return STEP_OK;`);
            break;
          }
          case "unshift_bits": {
            const outIdx = km.outToIdx.get(s.dst);
            const val = parseInt(s.bits, 2) >>> 0;
            lines.push(`  ktvm_kernel_unshift_bits(rt, n, ${outIdx}, ${val}u, ${s.width});`);
            lines.push(`  if (rt->error_code) return STEP_OK;`);
            break;
          }
          case "set_reg": {
            const rIdx = km.regToIdx.get(s.reg);
            lines.push(`  ks->regs[${rIdx}] = ${s.value | 0};`);
            break;
          }
          case "stack_push": {
            const sIdx = km.stackToIdx.get(s.stack);
            const val = parseInt(s.bits, 2) >>> 0;
            lines.push(`  ktvm_bs_push(rt, ks->stacks[${sIdx}], ${val}u, ${s.width});`);
            lines.push(`  if (rt->error_code) return STEP_OK;`);
            break;
          }
          case "stack_pop": {
            const sIdx = km.stackToIdx.get(s.stack);
            const tIdx = km.tempToIdx.get(s.dst);
            const emptyId = labelToId.get(s.onEmpty);
            lines.push(`  if (ks->stacks[${sIdx}]->len_bits < ${s.width}) goto L_${emptyId};`);
            lines.push(`  ks->temps[${tIdx}] = ktvm_bs_pop(ks->stacks[${sIdx}], ${s.width});`);
            break;
          }
          case "stack_clear": {
            const sIdx = km.stackToIdx.get(s.stack);
            lines.push(`  ktvm_bs_clear(ks->stacks[${sIdx}]);`);
            break;
          }
          case "drain_guard": {
            const inIdx = km.inToIdx.get(s.src);
            const sid = internSchemaExpr(s.schema);
            lines.push(`  { int dr = ktvm_k_drain_guard(rt, n, ${inIdx}, ${sid});`);
            lines.push(`    if (dr == 1) { ks->pc = ${st.id}; return STEP_NEED_PULL; }`);
            lines.push(`    if (dr == 2) return ktvm_k_fail(rt, n); }`);
            break;
          }
          case "dpda_copy": {
            const inIdx = km.inToIdx.get(s.src);
            const outIdx = km.outToIdx.get(s.dst);
            const sid = internSchemaExpr(s.schema);
            lines.push(`  { int dr = ktvm_k_dpda_copy(rt, n, ${inIdx}, ${outIdx}, ${sid});`);
            lines.push(`    if (dr == 1) { ks->pc = ${st.id}; return STEP_NEED_PULL; }`);
            lines.push(`    if (dr == 2) return ktvm_k_fail(rt, n); }`);
            break;
          }
          case "dpda_coerce": {
            const inIdx = km.inToIdx.get(s.src);
            const outIdx = km.outToIdx.get(s.dst);
            const sSid = internSchemaExpr(s.srcSchema);
            const dSid = internSchemaExpr(s.dstSchema);
            lines.push(`  { int dr = ktvm_k_dpda_coerce(rt, n, ${inIdx}, ${outIdx}, ${sSid}, ${dSid});`);
            lines.push(`    if (dr == 1) { ks->pc = ${st.id}; return STEP_NEED_PULL; }`);
            lines.push(`    if (dr == 2) return ktvm_k_fail(rt, n); }`);
            break;
          }
          case "splice": {
            const inIdx = km.inToIdx.get(s.src);
            const outIdx = km.outToIdx.get(s.dst);
            lines.push(`  ktvm_k_splice(rt, n, ${inIdx}, ${outIdx});`);
            break;
          }
          case "close": {
            const outIdx = km.outToIdx.get(s.dst);
            lines.push(`  ktvm_k_close(rt, n, ${outIdx});`);
            break;
          }
          case "yield": {
            const outIdx = km.outToIdx.get(s.dst);
            const resumeId = st.fallthroughId >= 0 ? st.fallthroughId : st.id;
            lines.push(`  if (n->outs[${outIdx}]->consumer && n->outs[${outIdx}]->len >= ${s.threshold | 0}) {`);
            lines.push(`    ks->pc = ${resumeId}; return STEP_YIELDED;`);
            lines.push(`  }`);
            break;
          }
          default:
            throw new Error(`Unsupported kernel stmt '${s.op}' in C backend`);
        }
      }

      if (st.fallthroughId >= 0) {
        lines.push(`  goto L_${st.fallthroughId};`);
        lines.push(`}`);
        continue;
      }

      const t = st.term;
      switch (t.op) {
        case "goto":
          lines.push(`  goto L_${labelToId.get(t.target)};`);
          break;
        case "retire":
          lines.push(`  ktvm_retire_node(rt, n);`);
          lines.push(`  return STEP_OK;`);
          break;
        case "fail":
          lines.push(`  return ktvm_k_fail(rt, n);`);
          break;
        case "handoff": {
          const inIndices = t.inputs.map((v) => km.inToIdx.get(v));
          const outIndices = t.outputs.map((v) => km.outToIdx.get(v));
          lines.push(`  { KtvmScope *sc = n->scope;`);
          lines.push(`    KtvmChan *old_in[${Math.max(1, inIndices.length)}] = { ${inIndices.map((idx) => `n->ins[${idx}]`).join(", ") || "NULL"} };`);
          lines.push(`    KtvmChan *old_out[${Math.max(1, outIndices.length)}] = { ${outIndices.map((idx) => `n->outs[${idx}]`).join(", ") || "NULL"} };`);
          lines.push(`    ktvm_retire_node(rt, n);`);
          if (kernelMeta.has(t.target)) {
            const tm = kernelMeta.get(t.target);
            lines.push(`    KtvmNode *nn = ktvm_emit_kernel(rt, sc, ${tm.fn}, ${tm.inCount}, ${tm.outCount}, ${tm.numRegs}, ${tm.numStacks}, ${tm.numTemps}, ${tm.regInitVar});`);
          } else {
            const pFn = procFnName.get(t.target);
            if (!pFn) throw new Error(`Unknown handoff target '${t.target}'`);
            lines.push(`    KtvmNode *nn = ktvm_node_alloc(rt, sc, NK_SPAWN, ${inIndices.length}, ${outIndices.length});`);
            lines.push(`    if (nn) nn->p0 = (void *)${pFn};`);
          }
          lines.push(`    if (nn) {`);
          for (let j = 0; j < inIndices.length; j++) lines.push(`      ktvm_node_set_in(nn, ${j}, old_in[${j}]);`);
          for (let j = 0; j < outIndices.length; j++) lines.push(`      ktvm_node_set_out(nn, ${j}, old_out[${j}]);`);
          lines.push(`    }`);
          lines.push(`    return STEP_OK; }`);
          break;
        }
        case "switch_bits": {
          const tIdx = km.tempToIdx.get(t.src);
          lines.push(`  switch (ks->temps[${tIdx}]) {`);
          for (const c of t.cases) {
            lines.push(`    case ${parseInt(c.bits, 2) >>> 0}u: goto L_${labelToId.get(c.target)};`);
          }
          if (t.defaultTarget) lines.push(`    default: goto L_${labelToId.get(t.defaultTarget)};`);
          else lines.push(`    default: return ktvm_k_fail(rt, n);`);
          lines.push(`  }`);
          break;
        }
        case "switch_reg": {
          const rIdx = km.regToIdx.get(t.reg);
          lines.push(`  switch (ks->regs[${rIdx}]) {`);
          for (const c of t.cases) {
            lines.push(`    case ${c.value | 0}: goto L_${labelToId.get(c.target)};`);
          }
          lines.push(`    default: return ktvm_k_fail(rt, n);`);
          lines.push(`  }`);
          break;
        }
        case "table_step": {
          const mVar = tableVarName.get(t.table);
          const rIdx = km.regToIdx.get(t.reg);
          const in0 = km.inToIdx.get(t.inputs[0]);
          const in1 = t.inputs.length > 1 ? km.inToIdx.get(t.inputs[1]) : 0;
          const out0 = km.outToIdx.get(t.outputs[0]);
          const out1 = t.outputs.length > 1 ? km.outToIdx.get(t.outputs[1]) : 0;
          lines.push(`  int tres = ktvm_exec_chunk_table_step(rt, n, &${mVar}, ${rIdx}, ${in0}, ${in1}, ${out0}, ${out1});`);
          emitTableDispatchC(t.exits, st.id);
          break;
        }
        case "stack_table_step": {
          const mVar = tableVarName.get(t.table);
          const rIdx = km.regToIdx.get(t.reg);
          const inIdx = km.inToIdx.get(t.input);
          const sIdx = km.stackToIdx.get(t.stack);
          const outIdx = km.outToIdx.get(t.output);
          lines.push(`  int tres = ktvm_exec_stack_table_step(rt, n, &${mVar}, ${rIdx}, ${inIdx}, ${sIdx}, ${outIdx});`);
          emitTableDispatchC(t.exits, st.id);
          break;
        }
        case "fsm_table_step": {
          const mVar = tableVarName.get(t.table);
          const inIdx = km.inToIdx.get(t.input);
          const out0 = km.outToIdx.get(t.outputs[0]);
          const out1 = t.outputs.length > 1 ? km.outToIdx.get(t.outputs[1]) : 0;
          lines.push(`  int tres = ktvm_exec_fsm_table_step(rt, n, &${mVar}, ${inIdx}, ${out0}, ${out1});`);
          emitTableDispatchC(t.exits, st.id);
          break;
        }
        default:
          throw new Error(`Unsupported kernel terminator '${t.op}' in C backend`);
      }
      lines.push(`}`);
    }
    lines.push(`}`);
    funcDefs.push(lines.join("\n"));
  }

  // --- 7. Entry Bootstrap ---
  let entryBody;
  if (procFnName.has(entryName)) {
    const fn = procFnName.get(entryName);
    entryBody =
      `void ktvm_start_entry(KtvmRuntime *rt, KtvmScope *root_sc, KtvmChan *root_in, KtvmChan *root_out) {\n` +
      `  void *env[2] = { root_in, root_out };\n` +
      `  ${fn}(rt, root_sc, env);\n` +
      `}`;
  } else {
    const km = kernelMeta.get(entryName);
    entryBody =
      `void ktvm_start_entry(KtvmRuntime *rt, KtvmScope *root_sc, KtvmChan *root_in, KtvmChan *root_out) {\n` +
      `  KtvmNode *n = ktvm_emit_kernel(rt, root_sc, ${km.fn}, ${km.inCount}, ${km.outCount}, ${km.numRegs}, ${km.numStacks}, ${km.numTemps}, ${km.regInitVar});\n` +
      `  if (n) { ktvm_node_set_in(n, 0, root_in); ktvm_node_set_out(n, 0, root_out); }\n` +
      `}`;
  }

  const cSource = [
    "/* Generated by @fraczak/k kTVM C/LLVM backend */",
    RUNTIME_H_SOURCE,
    "/* === Forward Declarations === */",
    ...forwardDecls,
    "/* === Static Schema, Header, Table & Descriptor Data === */",
    ...dataDecls,
    "/* === Compiled Procs & Kernels === */",
    ...funcDefs,
    "/* === Entry Bootstrap === */",
    entryBody
  ].join("\n\n") + "\n";

  return {
    cSource,
    entry: entryName,
    inPlist,
    outPlist,
    inHeader,
    outHeader,
    stats: {
      schemaNodes: schemaNodes.length,
      tags: tagStrings.length,
      procs: (mod.procs || []).length,
      kernels: (mod.kernels || []).length,
      tables: (mod.tables || []).length,
      totalTableBytes
    }
  };
}
