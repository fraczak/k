/**
 * kTVM WebAssembly Backend API & Runner (`k/ktvm/wasm/index.mjs`).
 *
 * Compiles concrete `mono` kTVM modules to validated WebAssembly binaries via
 * `wabt` and provides a zero-decode/zero-encode direct `k-wire` execution runner.
 */

import { compileKTVMToWat } from "./lower-wasm.mjs";
import { validateModule } from "../validator.mjs";
import { specializeKTVM } from "../specialize.mjs";
import { optimizeKTVM } from "../optimize/index.mjs";
import { compileKIRToKTVM } from "../lower-kir.mjs";
import {
  KTVMQuotaError,
  KTVMSchemaError
} from "../ast.mjs";
import { schemasEquivalent } from "../schema.mjs";
import {
  decodeDequeToValue,
  dequeToPaddedBytes,
  splitEnvelopedWire,
  splitWireHeaderOnly
} from "../wire.mjs";
import { decodeWire } from "../../codecs/runtime/prefix-codec.mjs";

export { compileKTVMToWat } from "./lower-wasm.mjs";

let wabtPromise = null;

async function getWabt() {
  if (!wabtPromise) {
    wabtPromise = import("wabt").then(({ default: wabtFactory }) => wabtFactory());
  }
  return wabtPromise;
}

/**
 * Compile WAT text to a validated WebAssembly binary (`Uint8Array`).
 */
export async function assembleWatToWasm(watText, { filename = "ktvm.wat" } = {}) {
  const wabt = await getWabt();
  let mod = null;
  try {
    mod = wabt.parseWat(filename, watText, {
      mutable_globals: true,
      sat_float_to_int: true,
      sign_extension: true,
      multi_value: true,
      bulk_memory: true,
      reference_types: true
    });
    mod.resolveNames();
    mod.validate();
    const bin = mod.toBinary({
      log: false,
      canonicalize_lebs: true,
      relocatable: false,
      write_debug_names: false
    });
    return new Uint8Array(bin.buffer.slice(0));
  } catch (err) {
    // Reset shared wabt instance if Wasm trap corrupted its internal C stack/heap
    if (err instanceof WebAssembly.RuntimeError) {
      wabtPromise = null;
    }
    throw err;
  } finally {
    if (mod) {
      try { mod.destroy(); } catch {}
    }
  }
}

/**
 * Compile a concrete `mono` kTVM module directly to a validated WebAssembly
 * artifact `{ wasmBytes, wat, entry, inPlist, outPlist, inHeader, outHeader, stats }`.
 */
export async function compileKTVMToWasm(
  monoMod,
  { entry = null, validate = true, verifyTables = true } = {}
) {
  if (validate) {
    validateModule(monoMod, { verifyTables });
  }
  const lowered = compileKTVMToWat(monoMod, { entry });
  const wasmBytes = await assembleWatToWasm(lowered.wat);
  return {
    ...lowered,
    wasmBytes
  };
}

/**
 * Fast O(headerBytes) prefix check testing whether an incoming enveloped `k-wire`
 * buffer begins with the exact precomputed canonical input header bits.
 */
function matchesHeaderPrefix(wireBytes, hdrBytes, hdrBitLen) {
  const fullBytes = hdrBitLen >> 3;
  const remBits = hdrBitLen & 7;
  if (wireBytes.length < fullBytes + (remBits > 0 ? 1 : 0)) return false;
  for (let i = 0; i < fullBytes; i++) {
    if (wireBytes[i] !== hdrBytes[i]) return false;
  }
  if (remBits > 0) {
    const mask = (0xff << (8 - remBits)) & 0xff;
    if ((wireBytes[fullBytes] & mask) !== (hdrBytes[fullBytes] & mask)) return false;
  }
  return true;
}

/**
 * Instantiate a compiled kTVM Wasm artifact into a reusable, zero-GC-reset runner.
 */
export async function instantiateKTVMWasm(artifact, { quota = null } = {}) {
  const { instance } = await WebAssembly.instantiate(artifact.wasmBytes, {});
  const exports = instance.exports;
  const {
    memory,
    ktvm_run_wire,
    ktvm_set_quotas,
    ktvm_reserve_io,
    ktvm_get_io_base,
    ktvm_get_steps,
    ktvm_get_peak_nodes,
    ktvm_get_peak_bytes,
    ktvm_get_table_lookups,
    ktvm_get_splices,
    ktvm_get_mux_demux_fusions,
    ktvm_get_spec_rollbacks,
    ktvm_get_spec_upstream_aborts,
    ktvm_get_spec_tail_splices,
    ktvm_get_after_settlements
  } = exports;

  const defaultMaxSteps = quota?.maxSteps ?? 50_000_000;
  const defaultMaxNodes = quota?.maxNodes ?? 200_000;
  const defaultMaxBytes = quota?.maxBitDequeBytes ?? 64 * 1024 * 1024;
  ktvm_set_quotas(defaultMaxSteps, defaultMaxNodes, defaultMaxBytes);

  let reservedIoBytes = 1048576; // default 1 MiB
  const ioBase = ktvm_get_io_base();
  const verifiedHeaders = [artifact.inHeader];
  let cachedMemU8 = new Uint8Array(memory.buffer);

  function getMemU8() {
    if (cachedMemU8.buffer !== memory.buffer) {
      cachedMemU8 = new Uint8Array(memory.buffer);
    }
    return cachedMemU8;
  }

  function matchVerifiedHeader(wireBytes) {
    for (let i = 0; i < verifiedHeaders.length; i++) {
      const h = verifiedHeaders[i];
      if (matchesHeaderPrefix(wireBytes, h.bytes, h.bitLen)) return h.bitLen;
    }
    return -1;
  }

  function readTelemetry() {
    return {
      steps: ktvm_get_steps(),
      peakActiveNodes: ktvm_get_peak_nodes(),
      peakBitDequeBytes: ktvm_get_peak_bytes(),
      tableLookups: ktvm_get_table_lookups(),
      splices: ktvm_get_splices(),
      muxDemuxFusions: ktvm_get_mux_demux_fusions(),
      specRollbacks: ktvm_get_spec_rollbacks(),
      specUpstreamAborts: ktvm_get_spec_upstream_aborts(),
      specTailSplices: ktvm_get_spec_tail_splices(),
      afterSettlements: ktvm_get_after_settlements()
    };
  }

  function handleErrorCode(code, limits) {
    if (code === -1) return { status: "FAILED", wire: null, value: null, telemetry: readTelemetry() };
    if (code === -2) throw new KTVMQuotaError("maxSteps", limits.maxSteps, ktvm_get_steps());
    if (code === -3) throw new KTVMQuotaError("maxNodes", limits.maxNodes, ktvm_get_peak_nodes());
    if (code === -4) throw new KTVMQuotaError("maxBitDequeBytes", limits.maxBytes, ktvm_get_peak_bytes());
    if (code === -6) throw new Error("Malformed k-wire envelope payload (truncated, invalid ordinal, or nonzero padding)");
    if (code === -7) throw new Error("kTVM Wasm invariant violation: deadlock on unproduced channel");
    if (code === -8) throw new RangeError("kTVM Wasm out of linear memory (arena exhausted)");
    throw new Error(`kTVM Wasm execution failed with error code ${code}`);
  }

  /**
   * Execute directly on an enveloped `k-wire` Buffer/Uint8Array!
   * Fast path: exact header prefix match -> zero JS decode/copy, straight into Wasm!
   * Fallback path: structurally equivalent reordered header -> splitEnvelopedWire!
   */
  function executeWire(wireBuffer, { decodeValue = false, quota: runQuota = null } = {}) {
    const activeLimits = {
      maxSteps: runQuota?.maxSteps ?? defaultMaxSteps,
      maxNodes: runQuota?.maxNodes ?? defaultMaxNodes,
      maxBytes: runQuota?.maxBitDequeBytes ?? defaultMaxBytes
    };
    if (runQuota) {
      ktvm_set_quotas(activeLimits.maxSteps, activeLimits.maxNodes, activeLimits.maxBytes);
    }

    const wireBytes = wireBuffer instanceof Uint8Array ? wireBuffer : new Uint8Array(wireBuffer);
    let inBytes = wireBytes;
    let inBitOff = 0;
    let inBitLen = 0;
    let validatePad = 1;

    const matchedBitLen = matchVerifiedHeader(wireBytes);
    if (matchedBitLen >= 0) {
      inBitOff = matchedBitLen;
      inBitLen = wireBytes.length * 8 - inBitOff;
      validatePad = 1;
    } else {
      // Decode ONLY the pattern header prefix; if equivalent & canonical, cache it and stream
      // payload bits directly into Wasm (zero JS payload DPDA!).
      const { plist, headerBitLen, canonicalOrder } = splitWireHeaderOnly(wireBytes);
      if (!schemasEquivalent(plist, 0, artifact.inPlist, 0)) {
        throw new KTVMSchemaError("Incoming k-wire schema does not match compiled kTVM Wasm input schema");
      }
      if (canonicalOrder) {
        const hdrByteLen = (headerBitLen + 7) >> 3;
        if (verifiedHeaders.length < 16) {
          verifiedHeaders.push({ bytes: wireBytes.slice(0, hdrByteLen), bitLen: headerBitLen });
        }
        inBitOff = headerBitLen;
        inBitLen = wireBytes.length * 8 - inBitOff;
        validatePad = 1;
      } else {
        const { payloadDeque } = splitEnvelopedWire(wireBytes);
        inBitLen = payloadDeque.length;
        inBytes = dequeToPaddedBytes(payloadDeque);
        payloadDeque.release();
        inBitOff = 0;
        validatePad = 0;
      }
    }

    // Reserve sufficient I/O space (input + output buffer, growing dynamically on -5 OUT_CAP!)
    let outCap = Math.max(262144, inBytes.length * 8 + artifact.outHeader.bytes.length + 4096);
    for (let attempt = 0; attempt < 5; attempt++) {
      const inAligned = (inBytes.length + 15) & ~15;
      const needed = inAligned + outCap;
      if (needed > reservedIoBytes) {
        const resBase = ktvm_reserve_io(needed);
        if (!resBase) throw new RangeError(`kTVM Wasm failed to reserve ${needed} bytes for I/O buffer`);
        reservedIoBytes = needed;
      }

      const memU8 = getMemU8();
      memU8.set(inBytes, ioBase);
      const outPtr = ioBase + inAligned;

      const outByteLen = ktvm_run_wire(
        ioBase,
        inBitOff,
        inBitLen,
        validatePad,
        outPtr,
        outCap,
        1 // frameHeader = 1 -> returns complete enveloped k-wire!
      );

      if (outByteLen === -5) {
        outCap *= 4;
        continue;
      }

      if (runQuota) {
        ktvm_set_quotas(defaultMaxSteps, defaultMaxNodes, defaultMaxBytes);
      }

      if (outByteLen < 0) {
        return handleErrorCode(outByteLen, activeLimits);
      }

      // Copy framed output bytes out of linear memory (refresh view in case memory grew!)
      const finalMem = getMemU8();
      const outWire = Buffer.from(finalMem.subarray(outPtr, outPtr + outByteLen));
      const telemetry = readTelemetry();
      const value = decodeValue ? decodeWire(outWire, { eager: true }).value : null;
      return {
        status: "OK",
        wire: outWire,
        value,
        outputPlist: artifact.outPlist,
        telemetry
      };
    }

    throw new Error("kTVM Wasm output exceeded maximum I/O buffer capacity");
  }

  return {
    artifact,
    exports,
    executeWire,
    getTelemetry: readTelemetry
  };
}

/**
 * End-to-end compilation from a K object relation + concrete input schema
 * directly to a validated WebAssembly artifact (with optional Milestone 3 optimizer).
 */
export async function compileObjectToKTVMWasm(
  obj,
  relNameOrHash,
  inputPlist,
  { optimize = true, budgetBytes, validate = true, verifyTables = true } = {}
) {
  let compiled = compileKIRToKTVM(obj, relNameOrHash, inputPlist, { validate });
  let optStats = null;
  if (optimize) {
    const opt = optimizeKTVM(compiled.module, {
      budgetBytes,
      validate,
      verifyTables
    });
    compiled = { ...compiled, module: opt.module };
    optStats = opt.stats;
  }
  const wasmArtifact = await compileKTVMToWasm(compiled.module, {
    entry: compiled.entry,
    validate: false,
    verifyTables: false
  });
  return {
    ...wasmArtifact,
    ktvmModule: compiled.module,
    optStats
  };
}
