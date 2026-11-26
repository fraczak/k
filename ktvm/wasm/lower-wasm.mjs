/**
 * Concrete `mono` kTVM -> WebAssembly Text (`WAT`) Compiler (Milestone 4).
 *
 * Lowers a validated concrete `mono` kTVM module (including unoptimized procs,
 * fused kernels, virtual stacks, SWAR-compressed `chunk_table`s, `stack_table`s,
 * and `fsm_table`s) into a standalone, zero-JS-callback WAT module backed by
 * `k/ktvm/wasm/runtime.wat`.
 *
 * Key properties:
 *   - Global Moore-minimized schema DFA deduplication (`schemasEquivalent` = `i32.eq`).
 *   - Static linear-memory data segments for schema tables, chunk/stack/FSM tables,
 *     switch/spec descriptors, and pre-encoded output `k-wire` headers.
 *   - Straight-line Wasm instantiation functions for all `proc`s, `switch` arms,
 *     and `spec` branches (no bytecode interpreter).
 *   - Native Wasm `br_table` state machines for all compiled `kernel`s with
 *     suspend-point splitting and zero-overhead hot table bursts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectSwitchOuterIO } from "../ast.mjs";
import { BitDeque } from "../bit-deque.mjs";
import {
  compileSchemaExprToPlist,
  mooreMinimize,
  productFields
} from "../schema.mjs";
import { encodePayloadToDeque } from "../wire.mjs";
import { choiceWidth, CORE_PATTERN_PROPERTY_LIST } from "../../codecs/runtime/prefix-codec.mjs";
import { textToStringValue } from "../../codecs/runtime/unicode-string.mjs";
import { Value } from "../../Value.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _runtimeWat = null;
function getRuntimeWat() {
  if (_runtimeWat !== null) return _runtimeWat;
  const localPath = path.join(__dirname, "runtime.wat");
  if (fs.existsSync(localPath)) {
    const text = fs.readFileSync(localPath, "utf8");
    if (text.includes("ktvm_run_wire")) {
      _runtimeWat = text;
      return _runtimeWat;
    }
  }
  _runtimeWat = fs.readFileSync("ktvm/wasm/runtime.wat", "utf8");
  return _runtimeWat;
}

function encodeBytesToWatString(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += "\\" + b.toString(16).padStart(2, "0");
  }
  return out;
}

class DataBuilder {
  constructor(startOffset = 256) {
    this.offset = startOffset;
    this.chunks = []; // { offset, bytes: Uint8Array }
  }

  align(a = 4) {
    this.offset = (this.offset + (a - 1)) & ~(a - 1);
  }

  emitBytes(bytes, alignment = 4) {
    this.align(alignment);
    const addr = this.offset;
    const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (copy.length > 0) {
      this.chunks.push({ offset: addr, bytes: copy });
      this.offset += copy.length;
    }
    return addr;
  }

  emitI32Array(ints) {
    const buf = new ArrayBuffer(ints.length * 4);
    const dv = new DataView(buf);
    for (let i = 0; i < ints.length; i++) {
      dv.setInt32(i * 4, ints[i] | 0, true);
    }
    return this.emitBytes(new Uint8Array(buf), 4);
  }

  toWatDataSegments() {
    if (this.chunks.length === 0) return "";
    // Merge contiguous/nearby chunks into a single compact static image!
    const start = this.chunks[0].offset;
    const end = this.offset;
    const merged = new Uint8Array(end - start);
    for (const c of this.chunks) {
      merged.set(c.bytes, c.offset - start);
    }
    // Emit in 4096-byte WAT data segments for fast wabt parsing
    const lines = [];
    const CHUNK = 4096;
    for (let off = 0; off < merged.length; off += CHUNK) {
      const slice = merged.subarray(off, Math.min(off + CHUNK, merged.length));
      lines.push(`  (data (i32.const ${start + off}) "${encodeBytesToWatString(slice)}")`);
    }
    return lines.join("\n");
  }
}

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
        const edgeProd = Value.product({
          label: textToStringValue(label),
          target: encodeKBitsUint(target)
        });
        edgeList = Value.variant("cons", Value.product({ car: edgeProd, cdr: edgeList }));
      }
      nodeVal = Value.variant(kind, edgeList);
    }
    listVal = Value.variant("cons", Value.product({ car: nodeVal, cdr: listVal }));
  }
  return listVal;
}

export function encodeHeaderBitsForPlist(plist) {
  const dq = new BitDeque(-98);
  encodePayloadToDeque(propertyListToPatternVal(plist), CORE_PATTERN_PROPERTY_LIST, dq, 0);
  const bitLen = dq.length;
  const nBytes = (bitLen + 7) >> 3;
  const bytes = new Uint8Array(nBytes);
  for (let i = 0; i < nBytes; i++) {
    const rem = dq.length;
    if (rem >= 8) bytes[i] = dq.shiftBits(8);
    else bytes[i] = dq.shiftBits(rem) << (8 - rem);
  }
  dq.release();
  return { bytes, bitLen };
}

/**
 * Compile a validated concrete `mono` kTVM module into standalone WAT source +
 * metadata (`inPlist`, `outPlist`, `inHeader`, `outHeader`, `tableBytes`).
 */
export function compileKTVMToWat(mod, { entry = null } = {}) {
  if (mod.layer !== "mono") {
    throw new Error("compileKTVMToWat requires a concrete 'mono' kTVM module");
  }
  const entryName = entry || mod.entry;
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));
  const tableMap = new Map((mod.tables || []).map((t) => [t.name, t]));
  const schemaDecls = new Map((mod.schemas || []).map((s) => [s.name, s]));

  const entryProc = procMap.get(entryName);
  const entryKernel = kernelMap.get(entryName);
  const entryTarget = entryProc || entryKernel;
  if (!entryTarget) throw new Error(`Unknown entry '${entryName}'`);
  if (entryTarget.inputs.length !== 1 || entryTarget.outputs.length !== 1) {
    throw new Error(`kTVM Wasm entry '${entryName}' must have 1 input and 1 output (got ${entryTarget.inputs.length} -> ${entryTarget.outputs.length})`);
  }

  // --- 1. Global Moore-Minimized Schema DFA Registry & Tag Interner ---
  const tagToId = new Map();
  const internTag = (tag) => {
    const s = String(tag);
    let id = tagToId.get(s);
    if (id === undefined) {
      id = tagToId.size;
      tagToId.set(s, id);
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

  // Global deduplicated schema states: mooreKey -> { id, kind, edges: [[tagId, targetKey]] }
  const schemaByMoore = new Map();
  const schemaNodes = []; // indexed by global id (`0` is always `unit`!)

  const internPlistState = (plist, nodeId = 0) => {
    const min = mooreMinimize(plist, nodeId);
    if (schemaByMoore.has(min.key)) return schemaByMoore.get(min.key).id;

    // Register all reachable states of `min.plist` in two passes (handles cycles cleanly!)
    const localToGlobal = new Array(min.plist.length);
    const localMins = new Array(min.plist.length);
    const newlyAdded = [];

    for (let i = 0; i < min.plist.length; i++) {
      const sm = i === 0 ? min : mooreMinimize(min.plist, i);
      localMins[i] = sm;
      if (schemaByMoore.has(sm.key)) {
        localToGlobal[i] = schemaByMoore.get(sm.key).id;
      } else {
        const id = schemaNodes.length;
        const entry = { id, key: sm.key, kind: min.plist[i][0], edges: null };
        schemaNodes.push(entry);
        schemaByMoore.set(sm.key, entry);
        localToGlobal[i] = id;
        newlyAdded.push({ i, entry });
      }
    }
    for (const { i, entry } of newlyAdded) {
      const [, rawEdges] = min.plist[i];
      entry.edges = rawEdges.map(([lbl, tgt]) => [internTag(lbl), localToGlobal[tgt]]);
    }
    return localToGlobal[0];
  };

  // Always reserve global schema ID 0 for `unit`!
  internPlistState([["closed-product", []]], 0);

  const internSchemaExpr = (expr) => internPlistState(resolvePlist(expr), 0);

  const inPlist = resolvePlist(entryTarget.inputs[0].schema);
  const outPlist = resolvePlist(entryTarget.outputs[0].schema);
  const inSchemaId = internPlistState(inPlist, 0);
  const outSchemaId = internPlistState(outPlist, 0);

  // Pre-intern all schemas referenced in procs & kernels
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

  const data = new DataBuilder(256);

  // --- 2. Pack Static Data Segments: Schemas, Tables, Headers ---

  // 2a. Schema Edges & Schema Nodes
  const edgePtrs = schemaNodes.map((sn) => {
    if (sn.edges.length === 0) return 0;
    const flat = [];
    for (const [tid, tgt] of sn.edges) {
      flat.push(tid, tgt);
    }
    return data.emitI32Array(flat);
  });
  const schemaNodeWords = [];
  for (let i = 0; i < schemaNodes.length; i++) {
    const sn = schemaNodes[i];
    const isUnion = sn.kind === "closed-union" ? 1 : 0;
    const width = isUnion ? choiceWidth(sn.edges.length) : 0;
    schemaNodeWords.push(isUnion, width, sn.edges.length, edgePtrs[i]);
  }
  const DATA_SCHEMA_NODES = data.emitI32Array(schemaNodeWords);

  // 2b. Output & Input k-wire headers
  const inHeader = encodeHeaderBitsForPlist(inPlist);
  const outHeader = encodeHeaderBitsForPlist(outPlist);
  const DATA_OUT_HDR_PTR = outHeader.bytes.length > 0 ? data.emitBytes(outHeader.bytes, 4) : 0;
  const DATA_OUT_HDR_BITS = outHeader.bitLen;

  // 2c. Static Chunk / Stack / FSM Tables
  const tableMetaPtrs = new Map();
  let totalTableBytes = 0;

  const packKind = (k) => {
    const s = k?.ident ?? k;
    if (s === "CONT") return 0;
    if (s === "EXIT") return 1;
    if (s === "NEED_MORE") return 2;
    return 3; // FAIL
  };

  for (const t of mod.tables || []) {
    const entries = t.entries || [];
    let numEntries = 0;
    for (const r of entries) if (r.index + 1 > numEntries) numEntries = r.index + 1;
    // Also support packedBase64 chunk_tables!
    let entryBuf;
    if (t.packedBase64 && entries.length === 0) {
      const raw = Buffer.from(t.packedBase64, "base64");
      const states = t.props.states || 1;
      const inSpecs = t.props.inputs || [];
      const totalEff = inSpecs.reduce((a, inp) => a + (inp.eff_bits ?? inp.raw_bits), 0);
      numEntries = states * (1 << totalEff);
      entryBuf = new Uint8Array(numEntries * 16);
      const dv = new DataView(entryBuf.buffer);
      const dvRaw = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let i = 0; i < numEntries; i++) {
        if (i * 8 + 8 <= raw.byteLength) {
          const w0 = dvRaw.getUint32(i * 8, true);
          const w1 = dvRaw.getUint32(i * 8 + 4, true);
          const kind = w0 & 3;
          const nextQ = (w0 >>> 2) & 0x3f;
          const sh0 = (w0 >>> 8) & 0xff;
          const sh1 = (w0 >>> 16) & 0xff;
          const elen0 = (w0 >>> 24) & 0xff;
          dv.setUint8(i * 16 + 0, kind);
          dv.setUint8(i * 16 + 1, nextQ);
          dv.setUint8(i * 16 + 2, sh0);
          dv.setUint8(i * 16 + 3, sh1);
          dv.setUint8(i * 16 + 4, elen0);
          dv.setUint32(i * 16 + 8, w1 >>> 0, true);
        } else {
          dv.setUint8(i * 16 + 0, 2); // NEED_MORE
        }
      }
    } else {
      entryBuf = new Uint8Array(numEntries * 16);
      const dv = new DataView(entryBuf.buffer);
      // Default missing slots to NEED_MORE (2)
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

    const entriesPtr = entryBuf.length > 0 ? data.emitBytes(entryBuf, 4) : 0;
    totalTableBytes += entryBuf.length;

    if (t.kind === "chunk_table") {
      const ins = t.props.inputs || [];
      const outs = t.props.outputs || [];
      const maskOf = (inp) => {
        if (!inp || !inp.compress || inp.compress.ident === "none") return -1;
        if (typeof inp.compress.mask === "number") return inp.compress.mask | 0;
        return -1;
      };
      const modeOf = (o) => ((o?.mode?.ident ?? o?.mode ?? "push") === "unshift" ? 1 : 0);
      const metaPtr = data.emitI32Array([
        entriesPtr,
        numEntries,
        ins.length,
        outs.length,
        ins[0]?.raw_bits ?? 0,
        ins[0]?.eff_bits ?? ins[0]?.raw_bits ?? 0,
        maskOf(ins[0]),
        ins[1]?.raw_bits ?? 0,
        ins[1]?.eff_bits ?? ins[1]?.raw_bits ?? 0,
        maskOf(ins[1]),
        modeOf(outs[0]),
        modeOf(outs[1])
      ]);
      tableMetaPtrs.set(t.name, metaPtr);
    } else if (t.kind === "stack_table") {
      const wStream = t.props.stream_bits ?? 0;
      const wStack = t.props.stack_bits ?? 0;
      const encStr = t.props.stack_encoding?.ident ?? t.props.stack_encoding ?? "bits";
      const stEnc = encStr === "depth_only" ? 1 : 0;
      const stStride = stEnc === 1 ? (wStack + 1) : ((1 << (wStack + 1)) - 1);
      const outMode = (t.props.output_mode?.ident ?? t.props.output_mode ?? "push") === "unshift" ? 1 : 0;
      const metaPtr = data.emitI32Array([
        entriesPtr,
        numEntries,
        wStream,
        wStack,
        stEnc,
        stStride,
        outMode,
        0
      ]);
      tableMetaPtrs.set(t.name, metaPtr);
    } else if (t.kind === "fsm_table") {
      const wRaw = t.props.input_bits ?? 0;
      const oms = t.props.output_modes || [];
      const modeOf = (m) => ((m?.ident ?? m ?? "push") === "unshift" ? 1 : 0);
      const metaPtr = data.emitI32Array([
        entriesPtr,
        numEntries,
        wRaw,
        oms.length || 1,
        modeOf(oms[0]),
        modeOf(oms[1]),
        0
      ]);
      tableMetaPtrs.set(t.name, metaPtr);
    }
  }

  // --- 3. Assign Function Table Indices for Procs, Kernels, Switch Arms, Spec Branches ---
  const fnTableNames = [];
  const registerFn = (watName) => {
    const idx = fnTableNames.length;
    fnTableNames.push(watName);
    return idx;
  };

  const procFnIdx = new Map();
  const procWatName = new Map();
  let fnSeq = 0;
  for (const p of mod.procs || []) {
    const wn = `$p_${fnSeq++}`;
    procWatName.set(p.name, wn);
    procFnIdx.set(p.name, registerFn(wn));
  }

  const kernelFnIdx = new Map();
  const kernelWatName = new Map();
  const kernelMeta = new Map();
  for (const k of mod.kernels || []) {
    const wn = `$k_${fnSeq++}`;
    kernelWatName.set(k.name, wn);
    kernelFnIdx.set(k.name, registerFn(wn));
    const regInits = (k.regs || []).map((r) => r.init ?? 0);
    const regInitPtr = regInits.length > 0 ? data.emitI32Array(regInits) : 0;
    // Count distinct temp names used in kernel
    const tempNames = new Set();
    for (const b of k.blocks || []) {
      for (const s of b.stmts) {
        if (s.dst && (s.op === "peek_bits" || s.op === "stack_pop")) tempNames.add(s.dst);
      }
    }
    kernelMeta.set(k.name, {
      funcIdx: kernelFnIdx.get(k.name),
      inCount: k.inputs.length,
      outCount: k.outputs.length,
      numRegs: (k.regs || []).length,
      numStacks: (k.stacks || []).length,
      numTemps: tempNames.size,
      regInitPtr,
      tempToIdx: new Map([...tempNames].map((n, i) => [n, i])),
      regToIdx: new Map((k.regs || []).map((r, i) => [r.name, i])),
      stackToIdx: new Map((k.stacks || []).map((s, i) => [s.name, i])),
      inToIdx: new Map(k.inputs.map((p, i) => [p.name, i])),
      outToIdx: new Map(k.outputs.map((p, i) => [p.name, i]))
    });
  }

  const emittedFuncs = [];

  // --- 4. Compile `proc` / `switch` arm / `spec` branch blocks to straight-line Wasm ---

  function compileBlockFn(watFnName, stmts, envSlots) {
    // envSlots: array of `{ kind: "chan"|"barrier"|"token", name }`
    const chanLocal = new Map();
    const barLocal = new Map();
    const tokLocal = new Map();
    let localSeq = 0;
    const localDecls = [];
    const freshLocal = (prefix = "v") => {
      const nm = `$${prefix}_${localSeq++}`;
      localDecls.push(`(local ${nm} i32)`);
      return nm;
    };

    const lines = [];
    const tmpNode = freshLocal("n");
    const tmpArr = freshLocal("arr");

    // Load env slots into locals
    for (let i = 0; i < envSlots.length; i++) {
      const sl = envSlots[i];
      const loc = freshLocal("e");
      if (sl.kind === "chan") chanLocal.set(sl.name, loc);
      else if (sl.kind === "barrier") barLocal.set(sl.name, loc);
      else if (sl.kind === "token") tokLocal.set(sl.name, loc);
      lines.push(`    (local.set ${loc} (i32.load (i32.add (local.get $env) (i32.const ${i * 4}))))`);
    }

    for (const s of stmts || []) {
      switch (s.op) {
        case "chan": {
          const loc = freshLocal("c");
          chanLocal.set(s.name, loc);
          const sid = internSchemaExpr(s.schema);
          lines.push(`    (local.set ${loc} (call $chan_alloc (local.get $sc) (i32.const ${sid})))`);
          break;
        }
        case "barrier": {
          const loc = freshLocal("b");
          barLocal.set(s.name, loc);
          lines.push(`    (local.set ${loc} (call $barrier_alloc))`);
          break;
        }
        case "const_unit": {
          lines.push(`    (call $emit_const_unit (local.get $sc) (local.get ${chanLocal.get(s.dst)}))`);
          break;
        }
        case "splice": {
          lines.push(`    (call $emit_splice (local.get $sc) (local.get ${chanLocal.get(s.src)}) (local.get ${chanLocal.get(s.dst)}))`);
          break;
        }
        case "coerce": {
          const sSid = internSchemaExpr(s.srcSchema);
          const dSid = internSchemaExpr(s.dstSchema);
          lines.push(`    (call $emit_coerce (local.get $sc) (local.get ${chanLocal.get(s.src)}) (local.get ${chanLocal.get(s.dst)}) (i32.const ${sSid}) (i32.const ${dSid}))`);
          break;
        }
        case "wrap": {
          const tid = internTag(s.tag);
          lines.push(`    (call $emit_wrap (local.get $sc) (local.get ${chanLocal.get(s.src)}) (local.get ${chanLocal.get(s.dst)}) (i32.const ${tid}))`);
          break;
        }
        case "match": {
          const tid = internTag(s.tag);
          lines.push(`    (call $emit_match (local.get $sc) (local.get ${chanLocal.get(s.src)}) (local.get ${chanLocal.get(s.dst)}) (i32.const ${tid}))`);
          break;
        }
        case "drain": {
          const sid = internSchemaExpr(s.schema);
          const barExpr = s.barrier ? `(local.get ${barLocal.get(s.barrier)})` : `(i32.const 0)`;
          lines.push(`    (call $emit_drain (local.get $sc) (local.get ${chanLocal.get(s.src)}) (i32.const ${sid}) ${barExpr})`);
          break;
        }
        case "gate": {
          lines.push(`    (call $emit_gate (local.get $sc) (local.get ${barLocal.get(s.barrier)}) (local.get ${chanLocal.get(s.src)}) (local.get ${chanLocal.get(s.dst)}))`);
          break;
        }
        case "demux": {
          const pl = resolvePlist(s.schema);
          const sid = internPlistState(pl, 0);
          const pf = productFields(pl, 0);
          const byLbl = new Map(s.fields.map((f) => [f.label, f.name]));
          const orderedOuts = pf.map((f) => byLbl.get(f.label));
          lines.push(`    (local.set ${tmpNode} (call $node_alloc (local.get $sc) (i32.const 6) (i32.const 1) (i32.const ${orderedOuts.length})))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const 0) (local.get ${chanLocal.get(s.src)}))`);
          for (let i = 0; i < orderedOuts.length; i++) {
            lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(orderedOuts[i])}))`);
          }
          lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 32)) (i32.const ${sid}))`);
          lines.push(`    ))`);
          break;
        }
        case "mux": {
          const pl = resolvePlist(s.schema);
          const sid = internPlistState(pl, 0);
          const pf = productFields(pl, 0);
          const byLbl = new Map(s.fields.map((f) => [f.label, f.name]));
          const orderedIns = pf.map((f) => byLbl.get(f.label));
          lines.push(`    (local.set ${tmpNode} (call $node_alloc (local.get $sc) (i32.const 7) (i32.const ${orderedIns.length}) (i32.const 1)))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          for (let i = 0; i < orderedIns.length; i++) {
            lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(orderedIns[i])}))`);
          }
          lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const 0) (local.get ${chanLocal.get(s.dst)}))`);
          lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 32)) (i32.const ${sid}))`);
          lines.push(`    ))`);
          break;
        }
        case "tee": {
          lines.push(`    (local.set ${tmpNode} (call $node_alloc (local.get $sc) (i32.const 8) (i32.const 1) (i32.const ${s.dsts.length})))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const 0) (local.get ${chanLocal.get(s.src)}))`);
          for (let i = 0; i < s.dsts.length; i++) {
            lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.dsts[i])}))`);
          }
          lines.push(`    ))`);
          break;
        }
        case "spawn": {
          const targetIdx = procFnIdx.get(s.target);
          if (targetIdx === undefined) throw new Error(`Unknown spawn target proc '${s.target}'`);
          lines.push(`    (local.set ${tmpNode} (call $node_alloc (local.get $sc) (i32.const 14) (i32.const ${s.inputs.length}) (i32.const ${s.outputs.length})))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          for (let i = 0; i < s.inputs.length; i++) {
            lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.inputs[i])}))`);
          }
          for (let i = 0; i < s.outputs.length; i++) {
            lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.outputs[i])}))`);
          }
          lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 32)) (i32.const ${targetIdx}))`);
          if (s.after) {
            lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 36)) (local.get ${tokLocal.get(s.after)}))`);
          }
          if (s.token) {
            const tLoc = freshLocal("tok");
            tokLocal.set(s.token, tLoc);
            lines.push(`      (local.set ${tLoc} (call $token_alloc (i32.load (i32.add (local.get ${tmpNode}) (i32.const 24))) (i32.const ${s.outputs.length})))`);
          }
          lines.push(`    ))`);
          break;
        }
        case "exec": {
          const km = kernelMeta.get(s.target);
          if (!km) throw new Error(`Unknown exec target kernel '${s.target}'`);
          lines.push(`    (local.set ${tmpNode} (call $emit_kernel (local.get $sc) (i32.const ${km.funcIdx}) (i32.const ${km.inCount}) (i32.const ${km.outCount}) (i32.const ${km.numRegs}) (i32.const ${km.numStacks}) (i32.const ${km.numTemps}) (i32.const ${km.regInitPtr})))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          for (let i = 0; i < s.inputs.length; i++) {
            lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.inputs[i])}))`);
          }
          for (let i = 0; i < s.outputs.length; i++) {
            lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.outputs[i])}))`);
          }
          lines.push(`    ))`);
          break;
        }
        case "switch": {
          const firstBody = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
          const { cons: swCons, prod: swProd } = collectSwitchOuterIO(firstBody, chanLocal);
          const remIns = [...swCons];
          const remOuts = [...swProd];

          // Capture ALL currently live channels, barriers, and tokens in scope for switch arms
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

          const armEntries = [];
          for (const arm of s.arms) {
            const armFnName = `$sw_${fnSeq++}`;
            const armFnIdx = registerFn(armFnName);
            compileBlockFn(armFnName, arm.body, capSlots);
            armEntries.push(armFnIdx);
            for (const p of arm.patterns) {
              armEntries.push(p.kind === "tag" ? internTag(p.tag) : -1);
            }
          }
          let defFnIdx = -1;
          if (s.defaultBody) {
            const defFnName = `$swd_${fnSeq++}`;
            defFnIdx = registerFn(defFnName);
            compileBlockFn(defFnName, s.defaultBody, capSlots);
          }

          const switchDescPtr = data.emitI32Array([
            s.inputs.length,
            s.arms.length,
            defFnIdx,
            testedMask,
            ...armEntries
          ]);

          lines.push(`    (local.set ${tmpNode} (call $node_alloc (local.get $sc) (i32.const 11) (i32.const ${remIns.length}) (i32.const ${remOuts.length})))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          for (let i = 0; i < remIns.length; i++) {
            lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(remIns[i])}))`);
          }
          for (let i = 0; i < remOuts.length; i++) {
            lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(remOuts[i])}))`);
          }
          lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 32)) (i32.const ${switchDescPtr}))`);
          // Pack captured env
          if (capSlots.length > 0) {
            lines.push(`      (local.set ${tmpArr} (call $alloc (i32.const ${capSlots.length * 4})))`);
            for (let i = 0; i < capSlots.length; i++) {
              const sl = capSlots[i];
              const loc = sl.kind === "chan" ? chanLocal.get(sl.name) : (sl.kind === "barrier" ? barLocal.get(sl.name) : tokLocal.get(sl.name));
              lines.push(`      (i32.store (i32.add (local.get ${tmpArr}) (i32.const ${i * 4})) (local.get ${loc}))`);
            }
            lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 36)) (local.get ${tmpArr}))`);
            lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 40)) (i32.const ${capSlots.length}))`);
          }
          // Pack inspectChans
          if (s.inputs.length > 0) {
            lines.push(`      (local.set ${tmpArr} (call $alloc (i32.const ${s.inputs.length * 4})))`);
            for (let i = 0; i < s.inputs.length; i++) {
              lines.push(`      (i32.store (i32.add (local.get ${tmpArr}) (i32.const ${i * 4})) (local.get ${chanLocal.get(s.inputs[i])}))`);
            }
            lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 44)) (local.get ${tmpArr}))`);
            lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 48)) (i32.const ${s.inputs.length}))`);
          }
          lines.push(`    ))`);
          break;
        }
        case "spec": {
          const brSlots = [
            ...s.inputs.map((nm) => ({ kind: "chan", name: nm })),
            ...s.outputs.map((nm) => ({ kind: "chan", name: nm }))
          ];
          const brFnIndices = [];
          for (const br of s.branches) {
            const brName = `$sp_${fnSeq++}`;
            const brIdx = registerFn(brName);
            compileBlockFn(brName, br.body, brSlots);
            brFnIndices.push(brIdx);
          }
          const specDescPtr = data.emitI32Array([s.branches.length, ...brFnIndices]);

          lines.push(`    (local.set ${tmpNode} (call $node_alloc (local.get $sc) (i32.const 12) (i32.const ${s.inputs.length}) (i32.const ${s.outputs.length})))`);
          lines.push(`    (if (i32.ne (local.get ${tmpNode}) (i32.const 0)) (then`);
          for (let i = 0; i < s.inputs.length; i++) {
            lines.push(`      (call $node_set_in (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.inputs[i])}))`);
          }
          for (let i = 0; i < s.outputs.length; i++) {
            lines.push(`      (call $node_set_out (local.get ${tmpNode}) (i32.const ${i}) (local.get ${chanLocal.get(s.outputs[i])}))`);
          }
          lines.push(`      (i32.store (i32.add (local.get ${tmpNode}) (i32.const 32)) (i32.const ${specDescPtr}))`);
          lines.push(`    ))`);
          break;
        }
        default:
          throw new Error(`Unsupported proc instruction '${s.op}' in Wasm compiler`);
      }
    }

    emittedFuncs.push([
      `  (func ${watFnName} (type $block_fn) (param $sc i32) (param $env i32)`,
      ...localDecls.map((d) => `    ${d}`),
      ...lines,
      `  )`
    ].join("\n"));
  }

  for (const p of mod.procs || []) {
    const envSlots = [
      ...p.inputs.map((i) => ({ kind: "chan", name: i.name })),
      ...p.outputs.map((o) => ({ kind: "chan", name: o.name }))
    ];
    compileBlockFn(procWatName.get(p.name), p.body, envSlots);
  }

  // --- 5. Compile `kernel`s to Native Wasm `br_table` State Machines ---

  const SUSPEND_OPS = new Set([
    "peek_bits",
    "shift_bits",
    "shift_tag",
    "drain_guard",
    "dpda_copy",
    "dpda_coerce",
    "yield"
  ]);

  function compileKernelFn(k) {
    const km = kernelMeta.get(k.name);
    const watName = kernelWatName.get(k.name);

    // Order blocks so `entry` is ALWAYS pc = 0!
    const orderedBlocks = [];
    const entryBlk = k.blocks.find((b) => b.label === "entry");
    orderedBlocks.push(entryBlk);
    for (const b of k.blocks) if (b.label !== "entry") orderedBlocks.push(b);

    // Split each block at suspending statements so every PC resumes cleanly at stmt 0!
    const states = []; // { pc, stmts, term, fallthroughPc }
    const labelToPc = new Map();

    for (const b of orderedBlocks) {
      const startPc = states.length;
      labelToPc.set(b.label, startPc);

      const segs = [];
      let cur = [];
      for (const s of b.stmts) {
        if (SUSPEND_OPS.has(s.op) && cur.length > 0) {
          segs.push(cur);
          cur = [s];
        } else {
          cur.push(s);
          // After `drain_guard`/`dpda_copy`/`dpda_coerce`/`yield`, also split so the next
          // statement has its own PC when resuming after completion or yield!
          if (s.op === "drain_guard" || s.op === "dpda_copy" || s.op === "dpda_coerce" || s.op === "yield") {
            segs.push(cur);
            cur = [];
          }
        }
      }
      if (cur.length > 0 || segs.length === 0) segs.push(cur);

      for (let i = 0; i < segs.length; i++) {
        const pc = states.length;
        const isLast = i === segs.length - 1;
        states.push({
          pc,
          stmts: segs[i],
          term: isLast ? b.term : null,
          fallthroughPc: isLast ? -1 : pc + 1
        });
      }
    }

    const M = states.length;
    const lines = [];
    lines.push(`  (func ${watName} (type $kernel_fn) (param $n i32) (result i32)`);
    lines.push(`    (local $ks i32)`);
    lines.push(`    (local $pc i32)`);
    lines.push(`    (local $ch i32)`);
    lines.push(`    (local $val i32)`);
    lines.push(`    (local $st i32)`);
    lines.push(`    (local $res i32)`);
    lines.push(`    (local $burst i32)`);
    lines.push(`    (local $nn i32)`);
    lines.push(`    (local.set $ks (i32.load (i32.add (local.get $n) (i32.const 40))))`);
    lines.push(`    (local.set $pc (i32.load (i32.add (local.get $n) (i32.const 36))))`);
    lines.push(`    (local.set $burst (i32.const 0))`);
    lines.push(`    (loop $dispatch`);
    lines.push(`      (if (i32.ge_s (local.get $burst) (i32.const 64)) (then`);
    lines.push(`        (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc))`);
    lines.push(`        (return (i32.const 0))))`);
    lines.push(`      (local.set $burst (i32.add (local.get $burst) (i32.const 1)))`);

    const emitGoto = (targetPc) => [
      `      (if (call $quota_tick_step) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (i32.const ${targetPc})) (return (i32.const 0))))`,
      `      (local.set $pc (i32.const ${targetPc}))`,
      `      (br $dispatch)`
    ];

    // Pre-generate body lines for each state `0 .. M-1`
    const stateBodies = new Array(M);
    for (let i = 0; i < M; i++) {
      const st = states[i];
      const bl = [];

      for (const s of st.stmts) {
        switch (s.op) {
          case "peek_bits": {
            const inIdx = km.inToIdx.get(s.src);
            const tIdx = km.tempToIdx.get(s.dst);
            const needed = s.offset + s.width;
            const eofPc = labelToPc.get(s.onEof);
            bl.push(`      (local.set $ch (call $node_get_in (local.get $n) (i32.const ${inIdx})))`);
            bl.push(`      (if (i32.lt_s (i32.load (i32.add (local.get $ch) (i32.const 44))) (i32.const ${needed})) (then`);
            bl.push(`        (if (i32.eq (i32.load (local.get $ch)) (i32.const 0)) (then`);
            bl.push(`          (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc))`);
            bl.push(`          (global.set $g_need_pull (local.get $ch))`);
            bl.push(`          (return (i32.const 1))))`);
            bl.push(`        (if (i32.eq (i32.load (local.get $ch)) (i32.const 2)) (then (return (call $k_fail (local.get $n)))))`);
            bl.push(`        (local.set $pc (i32.const ${eofPc}))`);
            bl.push(`        (br $dispatch)))`);
            bl.push(`      (i32.store (i32.add (i32.load (i32.add (local.get $ks) (i32.const 20))) (i32.const ${tIdx * 4})) (call $bd_peek_bits_at (local.get $ch) (i32.const ${s.offset}) (i32.const ${s.width})))`);
            break;
          }
          case "shift_bits": {
            const inIdx = km.inToIdx.get(s.src);
            bl.push(`      (local.set $ch (call $node_get_in (local.get $n) (i32.const ${inIdx})))`);
            if (s.width > 0) {
              bl.push(`      (if (i32.lt_s (i32.load (i32.add (local.get $ch) (i32.const 44))) (i32.const ${s.width})) (then`);
              bl.push(`        (if (i32.eq (i32.load (local.get $ch)) (i32.const 0)) (then`);
              bl.push(`          (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc))`);
              bl.push(`          (global.set $g_need_pull (local.get $ch))`);
              bl.push(`          (return (i32.const 1))))`);
              bl.push(`        (return (call $k_fail (local.get $n)))))`);
              bl.push(`      (drop (call $bd_shift_bits (local.get $ch) (i32.const ${s.width})))`);
            }
            bl.push(`      (i32.store (i32.add (local.get $ch) (i32.const 12)) (i32.const 0))`);
            break;
          }
          case "shift_tag": {
            const inIdx = km.inToIdx.get(s.src);
            const nextSid = internSchemaExpr(s.nextSchema);
            bl.push(`      (local.set $ch (call $node_get_in (local.get $n) (i32.const ${inIdx})))`);
            if (s.width > 0) {
              bl.push(`      (if (i32.lt_s (i32.load (i32.add (local.get $ch) (i32.const 44))) (i32.const ${s.width})) (then`);
              bl.push(`        (if (i32.eq (i32.load (local.get $ch)) (i32.const 0)) (then`);
              bl.push(`          (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc))`);
              bl.push(`          (global.set $g_need_pull (local.get $ch))`);
              bl.push(`          (return (i32.const 1))))`);
              bl.push(`        (return (call $k_fail (local.get $n)))))`);
              bl.push(`      (drop (call $bd_shift_bits (local.get $ch) (i32.const ${s.width})))`);
            }
            bl.push(`      (i32.store (i32.add (local.get $ch) (i32.const 8)) (i32.const ${nextSid}))`);
            bl.push(`      (i32.store (i32.add (local.get $ch) (i32.const 12)) (i32.const 1))`);
            break;
          }
          case "push_bits": {
            const outIdx = km.outToIdx.get(s.dst);
            const bitsVal = parseInt(s.bits, 2) | 0;
            bl.push(`      (call $bd_push_bits (call $node_get_out (local.get $n) (i32.const ${outIdx})) (i32.const ${bitsVal}) (i32.const ${s.width}))`);
            break;
          }
          case "unshift_bits": {
            const outIdx = km.outToIdx.get(s.dst);
            const bitsVal = parseInt(s.bits, 2) | 0;
            bl.push(`      (call $bd_unshift_bits (call $k_get_unshift_buf (local.get $n) (i32.const ${outIdx})) (i32.const ${bitsVal}) (i32.const ${s.width}))`);
            break;
          }
          case "set_reg": {
            const rIdx = km.regToIdx.get(s.reg);
            bl.push(`      (i32.store (i32.add (i32.load (local.get $ks)) (i32.const ${rIdx * 4})) (i32.const ${s.value | 0}))`);
            break;
          }
          case "stack_push": {
            const sIdx = km.stackToIdx.get(s.stack);
            const bitsVal = parseInt(s.bits, 2) | 0;
            bl.push(`      (call $bs_push (i32.load (i32.add (i32.load (i32.add (local.get $ks) (i32.const 4))) (i32.const ${sIdx * 4}))) (i32.const ${bitsVal}) (i32.const ${s.width}))`);
            break;
          }
          case "stack_pop": {
            const sIdx = km.stackToIdx.get(s.stack);
            const tIdx = km.tempToIdx.get(s.dst);
            const emptyPc = labelToPc.get(s.onEmpty);
            bl.push(`      (local.set $st (i32.load (i32.add (i32.load (i32.add (local.get $ks) (i32.const 4))) (i32.const ${sIdx * 4}))))`);
            bl.push(`      (if (i32.lt_s (i32.load (i32.add (local.get $st) (i32.const 8))) (i32.const ${s.width})) (then`);
            bl.push(`        (local.set $pc (i32.const ${emptyPc}))`);
            bl.push(`        (br $dispatch)))`);
            bl.push(`      (i32.store (i32.add (i32.load (i32.add (local.get $ks) (i32.const 20))) (i32.const ${tIdx * 4})) (call $bs_pop (local.get $st) (i32.const ${s.width})))`);
            break;
          }
          case "stack_clear": {
            const sIdx = km.stackToIdx.get(s.stack);
            bl.push(`      (call $bs_clear (i32.load (i32.add (i32.load (i32.add (local.get $ks) (i32.const 4))) (i32.const ${sIdx * 4}))))`);
            break;
          }
          case "drain_guard": {
            const inIdx = km.inToIdx.get(s.src);
            const sid = internSchemaExpr(s.schema);
            bl.push(`      (local.set $res (call $k_drain_guard (local.get $n) (i32.const ${inIdx}) (i32.const ${sid})))`);
            bl.push(`      (if (i32.eq (local.get $res) (i32.const 1)) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc)) (return (i32.const 1))))`);
            bl.push(`      (if (i32.eq (local.get $res) (i32.const 2)) (then (return (call $k_fail (local.get $n)))))`);
            break;
          }
          case "dpda_copy": {
            const inIdx = km.inToIdx.get(s.src);
            const outIdx = km.outToIdx.get(s.dst);
            const sid = internSchemaExpr(s.schema);
            bl.push(`      (local.set $res (call $k_dpda_copy (local.get $n) (i32.const ${inIdx}) (i32.const ${outIdx}) (i32.const ${sid})))`);
            bl.push(`      (if (i32.eq (local.get $res) (i32.const 1)) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc)) (return (i32.const 1))))`);
            bl.push(`      (if (i32.eq (local.get $res) (i32.const 2)) (then (return (call $k_fail (local.get $n)))))`);
            break;
          }
          case "dpda_coerce": {
            const inIdx = km.inToIdx.get(s.src);
            const outIdx = km.outToIdx.get(s.dst);
            const sSid = internSchemaExpr(s.srcSchema);
            const dSid = internSchemaExpr(s.dstSchema);
            bl.push(`      (local.set $res (call $k_dpda_coerce (local.get $n) (i32.const ${inIdx}) (i32.const ${outIdx}) (i32.const ${sSid}) (i32.const ${dSid})))`);
            bl.push(`      (if (i32.eq (local.get $res) (i32.const 1)) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc)) (return (i32.const 1))))`);
            bl.push(`      (if (i32.eq (local.get $res) (i32.const 2)) (then (return (call $k_fail (local.get $n)))))`);
            break;
          }
          case "splice": {
            const inIdx = km.inToIdx.get(s.src);
            const outIdx = km.outToIdx.get(s.dst);
            bl.push(`      (call $k_splice (local.get $n) (i32.const ${inIdx}) (i32.const ${outIdx}))`);
            break;
          }
          case "close": {
            const outIdx = km.outToIdx.get(s.dst);
            bl.push(`      (call $k_close (local.get $n) (i32.const ${outIdx}))`);
            break;
          }
          case "yield": {
            const outIdx = km.outToIdx.get(s.dst);
            bl.push(`      (i32.store (i32.add (local.get $ks) (i32.const 28)) (i32.const ${s.threshold | 0}))`);
            bl.push(`      (local.set $ch (call $node_get_out (local.get $n) (i32.const ${outIdx})))`);
            if (st.fallthroughPc >= 0) {
              bl.push(`      (if (i32.and (i32.ne (i32.load (i32.add (local.get $ch) (i32.const 20))) (i32.const 0)) (i32.ge_s (i32.load (i32.add (local.get $ch) (i32.const 44))) (i32.const ${s.threshold | 0}))) (then`);
              bl.push(`        (i32.store (i32.add (local.get $n) (i32.const 36)) (i32.const ${st.fallthroughPc}))`);
              bl.push(`        (return (i32.const 2))))`);
            }
            break;
          }
          default:
            throw new Error(`Unsupported kernel stmt '${s.op}' in Wasm compiler`);
        }
      }

      if (st.fallthroughPc >= 0) {
        bl.push(`      (local.set $pc (i32.const ${st.fallthroughPc}))`);
        bl.push(`      (br $dispatch)`);
        stateBodies[i] = bl;
        continue;
      }

      const t = st.term;
      switch (t.op) {
        case "goto": {
          bl.push(...emitGoto(labelToPc.get(t.target)));
          break;
        }
        case "retire": {
          bl.push(`      (call $k_retire (local.get $n))`);
          bl.push(`      (return (i32.const 0))`);
          break;
        }
        case "fail": {
          bl.push(`      (return (call $k_fail (local.get $n)))`);
          break;
        }
        case "handoff": {
          bl.push(`      (local.set $st (i32.load (i32.add (local.get $n) (i32.const 8))))`);
          const inIndices = t.inputs.map((v) => km.inToIdx.get(v));
          const outIndices = t.outputs.map((v) => km.outToIdx.get(v));
          bl.push(`      (call $retire_node (local.get $n))`);
          if (kernelMeta.has(t.target)) {
            const tm = kernelMeta.get(t.target);
            bl.push(`      (local.set $nn (call $emit_kernel (local.get $st) (i32.const ${tm.funcIdx}) (i32.const ${tm.inCount}) (i32.const ${tm.outCount}) (i32.const ${tm.numRegs}) (i32.const ${tm.numStacks}) (i32.const ${tm.numTemps}) (i32.const ${tm.regInitPtr})))`);
          } else {
            const pIdx = procFnIdx.get(t.target);
            if (pIdx === undefined) throw new Error(`Unknown handoff target '${t.target}'`);
            bl.push(`      (local.set $nn (call $node_alloc (local.get $st) (i32.const 14) (i32.const ${inIndices.length}) (i32.const ${outIndices.length})))`);
            bl.push(`      (if (i32.ne (local.get $nn) (i32.const 0)) (then (i32.store (i32.add (local.get $nn) (i32.const 32)) (i32.const ${pIdx}))))`);
          }
          bl.push(`      (if (i32.ne (local.get $nn) (i32.const 0)) (then`);
          for (let j = 0; j < inIndices.length; j++) {
            bl.push(`        (call $node_set_in (local.get $nn) (i32.const ${j}) (call $node_get_in (local.get $n) (i32.const ${inIndices[j]})))`);
          }
          for (let j = 0; j < outIndices.length; j++) {
            bl.push(`        (call $node_set_out (local.get $nn) (i32.const ${j}) (call $node_get_out (local.get $n) (i32.const ${outIndices[j]})))`);
          }
          bl.push(`      ))`);
          bl.push(`      (return (i32.const 0))`);
          break;
        }
        case "switch_bits": {
          const tIdx = km.tempToIdx.get(t.src);
          bl.push(`      (local.set $val (i32.load (i32.add (i32.load (i32.add (local.get $ks) (i32.const 20))) (i32.const ${tIdx * 4}))))`);
          for (const c of t.cases) {
            const cVal = parseInt(c.bits, 2) | 0;
            const tPc = labelToPc.get(c.target);
            bl.push(`      (if (i32.eq (local.get $val) (i32.const ${cVal})) (then (local.set $pc (i32.const ${tPc})) (br $dispatch)))`);
          }
          if (t.defaultTarget) {
            bl.push(`      (local.set $pc (i32.const ${labelToPc.get(t.defaultTarget)}))`);
            bl.push(`      (br $dispatch)`);
          } else {
            bl.push(`      (return (call $k_fail (local.get $n)))`);
          }
          break;
        }
        case "switch_reg": {
          const rIdx = km.regToIdx.get(t.reg);
          bl.push(`      (local.set $val (i32.load (i32.add (i32.load (local.get $ks)) (i32.const ${rIdx * 4}))))`);
          for (const c of t.cases) {
            const tPc = labelToPc.get(c.target);
            bl.push(`      (if (i32.eq (local.get $val) (i32.const ${c.value | 0})) (then (local.set $pc (i32.const ${tPc})) (br $dispatch)))`);
          }
          bl.push(`      (return (call $k_fail (local.get $n)))`);
          break;
        }
        case "table_step": {
          const metaPtr = tableMetaPtrs.get(t.table);
          const rIdx = km.regToIdx.get(t.reg);
          const in0 = km.inToIdx.get(t.inputs[0]);
          const in1 = t.inputs.length > 1 ? km.inToIdx.get(t.inputs[1]) : 0;
          const out0 = km.outToIdx.get(t.outputs[0]);
          const out1 = t.outputs.length > 1 ? km.outToIdx.get(t.outputs[1]) : 0;
          bl.push(`      (local.set $res (call $exec_chunk_table_step (local.get $n) (i32.const ${metaPtr}) (i32.const ${rIdx}) (i32.const ${in0}) (i32.const ${in1}) (i32.const ${out0}) (i32.const ${out1})))`);
          emitTableDispatch(bl, t.exits, labelToPc);
          break;
        }
        case "stack_table_step": {
          const metaPtr = tableMetaPtrs.get(t.table);
          const rIdx = km.regToIdx.get(t.reg);
          const inIdx = km.inToIdx.get(t.input);
          const sIdx = km.stackToIdx.get(t.stack);
          const outIdx = km.outToIdx.get(t.output);
          bl.push(`      (local.set $res (call $exec_stack_table_step (local.get $n) (i32.const ${metaPtr}) (i32.const ${rIdx}) (i32.const ${inIdx}) (i32.const ${sIdx}) (i32.const ${outIdx})))`);
          emitTableDispatch(bl, t.exits, labelToPc);
          break;
        }
        case "fsm_table_step": {
          const metaPtr = tableMetaPtrs.get(t.table);
          const inIdx = km.inToIdx.get(t.input);
          const out0 = km.outToIdx.get(t.outputs[0]);
          const out1 = t.outputs.length > 1 ? km.outToIdx.get(t.outputs[1]) : 0;
          bl.push(`      (local.set $res (call $exec_fsm_table_step (local.get $n) (i32.const ${metaPtr}) (i32.const ${inIdx}) (i32.const ${out0}) (i32.const ${out1})))`);
          emitTableDispatch(bl, t.exits, labelToPc);
          break;
        }
        default:
          throw new Error(`Unsupported kernel terminator '${t.op}' in Wasm compiler`);
      }
      stateBodies[i] = bl;
    }

    // Emit balanced binary-split + bounded-depth `br_table` dispatch (max nesting <= 20 even
    // for 1,000+ states, preventing wabt recursive-descent stack overflow!)
    const emitRange = (lo, hi) => {
      const count = hi - lo;
      if (count <= 16) {
        for (let i = hi - 1; i >= lo; i--) {
          lines.push(`      (block $s_${i}`);
        }
        const targets = [];
        for (let i = lo; i < hi; i++) targets.push(`$s_${i}`);
        const idxExpr = lo === 0 ? `(local.get $pc)` : `(i32.sub (local.get $pc) (i32.const ${lo}))`;
        lines.push(`        (br_table ${targets.join(" ")} ${idxExpr})`);
        for (let i = lo; i < hi; i++) {
          lines.push(`      )`);
          lines.push(...stateBodies[i]);
        }
        return;
      }
      const mid = (lo + hi) >> 1;
      lines.push(`      (if (i32.lt_s (local.get $pc) (i32.const ${mid})) (then`);
      emitRange(lo, mid);
      lines.push(`      ) (else`);
      emitRange(mid, hi);
      lines.push(`      ))`);
    };

    emitRange(0, M);

    lines.push(`    ) ;; end $dispatch`);
    lines.push(`    (i32.const 0)`);
    lines.push(`  )`);
    emittedFuncs.push(lines.join("\n"));
  }

  function emitTableDispatch(lines, exits, labelToPc) {
    const shortPc = labelToPc.get(exits.short || exits.fail);
    const failPc = labelToPc.get(exits.fail);
    lines.push(`      (if (i32.eq (local.get $res) (i32.const 0)) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc)) (return (i32.const 0))))`);
    lines.push(`      (if (i32.eq (local.get $res) (i32.const 1)) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc)) (return (i32.const 1))))`);
    lines.push(`      (if (i32.eq (local.get $res) (i32.const 2)) (then (i32.store (i32.add (local.get $n) (i32.const 36)) (local.get $pc)) (return (i32.const 2))))`);
    lines.push(`      (if (i32.eq (local.get $res) (i32.const 3)) (then (local.set $pc (i32.const ${shortPc})) (br $dispatch)))`);
    lines.push(`      (if (i32.eq (local.get $res) (i32.const 4)) (then (local.set $pc (i32.const ${failPc})) (br $dispatch)))`);
    const numericExits = Object.entries(exits)
      .filter(([k]) => k !== "short" && k !== "fail")
      .map(([k, lbl]) => [Number(k), labelToPc.get(lbl)])
      .sort((a, b) => a[0] - b[0]);
    for (const [eid, epc] of numericExits) {
      lines.push(`      (if (i32.eq (local.get $res) (i32.const ${100 + eid})) (then (local.set $pc (i32.const ${epc})) (br $dispatch)))`);
    }
    lines.push(`      (local.set $pc (i32.const ${failPc}))`);
    lines.push(`      (br $dispatch)`);
  }

  for (const k of mod.kernels || []) {
    compileKernelFn(k);
  }

  // --- 6. Emit `$start_entry` & Static Globals / Function Table / Data Segments ---
  const startEntryLines = [
    `  (func $start_entry (param $sc i32) (param $rootIn i32) (param $rootOut i32)`,
    `    (local $n i32)`
  ];
  if (entryProc) {
    const pIdx = procFnIdx.get(entryName);
    startEntryLines.push(
      `    (local.set $n (call $node_alloc (local.get $sc) (i32.const 14) (i32.const 1) (i32.const 1)))`,
      `    (if (i32.eqz (local.get $n)) (then (return)))`,
      `    (call $node_set_in (local.get $n) (i32.const 0) (local.get $rootIn))`,
      `    (call $node_set_out (local.get $n) (i32.const 0) (local.get $rootOut))`,
      `    (i32.store (i32.add (local.get $n) (i32.const 32)) (i32.const ${pIdx}))`
    );
  } else {
    const km = kernelMeta.get(entryName);
    startEntryLines.push(
      `    (local.set $n (call $emit_kernel (local.get $sc) (i32.const ${km.funcIdx}) (i32.const 1) (i32.const 1) (i32.const ${km.numRegs}) (i32.const ${km.numStacks}) (i32.const ${km.numTemps}) (i32.const ${km.regInitPtr})))`,
      `    (if (i32.eqz (local.get $n)) (then (return)))`,
      `    (call $node_set_in (local.get $n) (i32.const 0) (local.get $rootIn))`,
      `    (call $node_set_out (local.get $n) (i32.const 0) (local.get $rootOut))`
    );
  }
  startEntryLines.push(`  )`);

  data.align(16);
  const DATA_IO_BASE = data.offset;
  // Default 1 MiB reserved for I/O buffer (expandable dynamically via `ktvm_reserve_io`)
  const DATA_HEAP_BASE = DATA_IO_BASE + 1048576;

  const fnTableCount = Math.max(1, fnTableNames.length);
  const elemLine = fnTableNames.length > 0
    ? `  (elem (i32.const 0) func ${fnTableNames.join(" ")})`
    : "";

  const wat = [
    `(module`,
    getRuntimeWat(),
    ``,
    `  ;; --- Generated Module Static Constants & Function Table ---`,
    `  (global $DATA_SCHEMA_NODES i32 (i32.const ${DATA_SCHEMA_NODES}))`,
    `  (global $DATA_IN_SCHEMA_ID i32 (i32.const ${inSchemaId}))`,
    `  (global $DATA_OUT_SCHEMA_ID i32 (i32.const ${outSchemaId}))`,
    `  (global $DATA_OUT_HDR_PTR i32 (i32.const ${DATA_OUT_HDR_PTR}))`,
    `  (global $DATA_OUT_HDR_BITS i32 (i32.const ${DATA_OUT_HDR_BITS}))`,
    `  (global $DATA_IO_BASE i32 (i32.const ${DATA_IO_BASE}))`,
    `  (global $DATA_HEAP_BASE i32 (i32.const ${DATA_HEAP_BASE}))`,
    ``,
    `  (table ${fnTableCount} funcref)`,
    elemLine,
    ``,
    data.toWatDataSegments(),
    ``,
    startEntryLines.join("\n"),
    ``,
    emittedFuncs.join("\n\n"),
    `)`
  ].join("\n");

  return {
    wat,
    entry: entryName,
    inPlist,
    outPlist,
    inHeader,
    outHeader,
    stats: {
      schemaNodes: schemaNodes.length,
      procs: (mod.procs || []).length,
      kernels: (mod.kernels || []).length,
      tables: (mod.tables || []).length,
      totalTableBytes,
      staticDataBytes: DATA_IO_BASE - 256,
      functions: fnTableNames.length
    }
  };
}
