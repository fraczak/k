/**
 * Bit-Chunk / Virtual-Stack / FSM Table Synthesizer with SWAR Don't-Care Bit
 * Compression, Howard MWTR L1 Budget Allocation, and Bisimulation Verification.
 *
 * Implements DOCS/KTVM_SPEC.md §6 & §11.1 Milestone 3:
 *   - Synthesizes `chunk_table` (1-2 streaming ports + optional `reg`),
 *     `stack_table` (1 streaming port + 1 local LIFO `BitStack` + optional `reg`),
 *     and `fsm_table` (acyclic multi-step 1-stream kernels) directly by
 *     symbolically simulating each kernel's exact reference CFG (`slow_step`)!
 *   - Automatically discovers per-token don't-care bit masks (SWAR compression)
 *     when subset of bits suffices for all continuing transitions.
 *   - Evaluates worst-case throughput `rho*` via Howard's policy-improvement
 *     MWTR algorithm (`mwtr.mjs`) and selects the highest-throughput table set
 *     fitting inside `budgetBytes` (default 64 KB L1-resident).
 *   - Gracefully skips wide-alphabet kernels (`tagWidth > 4`, e.g. `ascii[]` in
 *     `djson.k`), keeping them as clean un-chunked `kernel` CFGs.
 */

import { cloneAst, createModule } from "../ast.mjs";
import { BitDeque, BitStack } from "../bit-deque.mjs";
import { choiceWidth } from "../../codecs/runtime/prefix-codec.mjs";
import {
  DEFAULT_L1_BUDGET_BYTES,
  allocateTableBudgets,
  budgetClassForBytes,
  computeMWTR
} from "./mwtr.mjs";

function popcount(x) {
  let c = 0;
  let v = x >>> 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

function sanitize(raw) {
  const s = String(raw || "").replace(/^[@$%&]/, "").replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `t_${s}`;
}

/**
 * Exact PEXT-style bit compression matching `vm.mjs`'s `applyInputCompress`.
 */
export function compressBitsWithMask(rawVal, rawBits, mask) {
  let out = 0;
  let bitPos = 0;
  const m = mask >>> 0;
  for (let i = 0; i < rawBits; i++) {
    if ((m >>> i) & 1) {
      out |= ((rawVal >>> i) & 1) << bitPos;
      bitPos++;
    }
  }
  return out;
}

/**
 * Repeat a per-token `unitMask` (width `w`) across `numTokens` tokens to form a
 * full `W_raw = w * numTokens` bitmask.
 */
function repeatUnitMask(unitMask, w, numTokens) {
  let full = 0;
  for (let t = 0; t < numTokens; t++) {
    full = (full << w) | (unitMask & ((1 << w) - 1));
  }
  return full >>> 0;
}

/**
 * Simulate a kernel's reference CFG (`slow_step`) over finite input bit windows
 * (+ optional initial register state and optional initial LIFO BitStack).
 *
 * Returns `{ kind: "CONT"|"EXIT"|"NEED_MORE"|"FAIL", nextQ, shifts, emitWords,
 * emitLens, exitId, stackPop, stackPushWord, stackPushLen, stackCleared }`.
 */
export function simulateKernelReferenceCFG({
  kernel,
  blockMap,
  loopHeader,
  slowLabel,
  regName,
  startQ,
  inputNames,
  inputBits,
  inputWidths,
  outputNames,
  stackName = null,
  initStackBits = 0,
  initStackDepth = 0,
  stackWindowTruncated = initStackDepth > 0,
  exitLabelToId,
  failLabel = "err",
  maxSteps = 256
}) {
  const inDqs = new Map();
  const initLens = new Map();
  for (let p = 0; p < inputNames.length; p++) {
    const dq = new BitDeque(p);
    dq.pushBits(inputBits[p], inputWidths[p]);
    inDqs.set(inputNames[p], dq);
    initLens.set(inputNames[p], inputWidths[p]);
  }
  const outDqs = new Map();
  for (let o = 0; o < outputNames.length; o++) {
    outDqs.set(outputNames[o], new BitDeque(100 + o));
  }
  const regs = new Map((kernel.regs || []).map((r) => [r.name, r.init ?? 0]));
  if (regName) regs.set(regName, startQ);

  // Track stack operations precisely using a symbolic stack suffix + explicit top bits!
  // We track net pops from the initial stack (`baseDepth`) plus newly pushed bits (`pushed[]`)
  // so we can reconstruct exact `(pop_stack, push_stack_word, push_stack_len)`!
  const stacks = new Map((kernel.stacks || []).map((s) => [s.name, new BitStack()]));
  let initStackRem = initStackDepth;
  let totalPoppedFromInit = 0;
  const pushedBits = []; // bottom-to-top bits pushed above remaining init stack
  let stackCleared = false;
  if (stackName && initStackDepth > 0) {
    stacks.get(stackName).push(initStackBits, initStackDepth);
  }

  let curBlock = slowLabel;
  let lastValid = null;
  const temps = new Map();

  for (let step = 0; step < maxSteps; step++) {
    if (exitLabelToId.has(curBlock)) {
      // `EXIT` table entries do not carry `next_q`: ONLY if this exit block actually
      // reads `regName` (e.g. `switch_reg`) AND an earlier unrolled iteration modified
      // `regName`, stop at `lastValid` (`CONT`) so the exit sees the updated register!
      const exitBlk = blockMap.get(curBlock);
      const exitReadsReg = Boolean(
        regName && exitBlk && exitBlk.term?.op === "switch_reg" && exitBlk.term.reg === regName
      );
      if (exitReadsReg && regs.get(regName) !== startQ) {
        return lastValid || snapshot("NEED_MORE", {});
      }
      return snapshot("EXIT", { exitId: exitLabelToId.get(curBlock) });
    }
    if (curBlock === failLabel) {
      return snapshot("FAIL", {});
    }
    if (curBlock === loopHeader) {
      lastValid = snapshot("CONT", {});
      // For acyclic FSMs (`loopHeader === null`), stop immediately; for loops, keep unrolling!
      if (!loopHeader) return lastValid;
      curBlock = slowLabel;
      continue;
    }

    const blk = blockMap.get(curBlock);
    if (!blk) return lastValid || snapshot("NEED_MORE", {});
    let jumped = false;

    for (const s of blk.stmts) {
      switch (s.op) {
        case "peek_bits": {
          const dq = inDqs.get(s.src);
          if (!dq || s.offset + s.width > dq.length) {
            return lastValid || snapshot("NEED_MORE", {});
          }
          temps.set(s.dst, dq.peekBitsAt(s.offset, s.width));
          break;
        }
        case "shift_bits":
        case "shift_tag": {
          const dq = inDqs.get(s.src);
          if (!dq || s.width > dq.length) {
            return lastValid || snapshot("NEED_MORE", {});
          }
          dq.shiftBits(s.width);
          break;
        }
        case "push_bits":
          outDqs.get(s.dst).pushBits(parseInt(s.bits, 2), s.width);
          break;
        case "unshift_bits":
          outDqs.get(s.dst).unshiftBits(parseInt(s.bits, 2), s.width);
          break;
        case "set_reg":
          regs.set(s.reg, s.value);
          break;
        case "stack_push": {
          const val = parseInt(s.bits, 2);
          stacks.get(s.stack).push(val, s.width);
          if (s.stack === stackName) {
            for (let b = 0; b < s.width; b++) pushedBits.push((val >>> b) & 1);
          }
          break;
        }
        case "stack_pop": {
          const st = stacks.get(s.stack);
          if (st.length < s.width) {
            // Note: if initial stack was truncated (`initStackDepth === W_k`), we don't know if
            // real stack is truly empty or deeper! Return `lastValid` (or `NEED_MORE`)!
            if (s.stack === stackName && stackWindowTruncated && totalPoppedFromInit >= initStackDepth) {
              return lastValid || snapshot("NEED_MORE", {});
            }
            curBlock = s.onEmpty;
            jumped = true;
          } else {
            const v = st.pop(s.width);
            temps.set(s.dst, v);
            if (s.stack === stackName) {
              for (let b = 0; b < s.width; b++) {
                if (pushedBits.length > 0) pushedBits.pop();
                else {
                  initStackRem--;
                  totalPoppedFromInit++;
                }
              }
            }
          }
          break;
        }
        case "stack_clear":
          stacks.get(s.stack).clear();
          if (s.stack === stackName) {
            pushedBits.length = 0;
            stackCleared = true;
          }
          break;
        case "drain_guard":
        case "yield":
          break;
        default:
          return lastValid || snapshot("NEED_MORE", {});
      }
      if (jumped) break;
    }
    if (jumped) continue;

    const t = blk.term;
    if (t.op === "goto") {
      curBlock = t.target;
    } else if (t.op === "fail") {
      return snapshot("FAIL", {});
    } else if (t.op === "switch_bits") {
      const val = temps.get(t.src);
      let next = t.defaultTarget;
      for (const c of t.cases) {
        if (parseInt(c.bits, 2) === val) {
          next = c.target;
          break;
        }
      }
      curBlock = next || failLabel;
    } else if (t.op === "switch_reg") {
      const val = regs.get(t.reg);
      const found = t.cases.find((c) => c.value === val);
      curBlock = found ? found.target : failLabel;
    } else {
      return lastValid || snapshot("NEED_MORE", {});
    }
  }
  return lastValid || snapshot("NEED_MORE", {});

  function snapshot(kind, extra) {
    const shifts = inputNames.map((n) => initLens.get(n) - inDqs.get(n).length);
    const emitLens = outputNames.map((n) => outDqs.get(n).length);
    const emitWords = outputNames.map((n) => {
      const dq = outDqs.get(n);
      return dq.length > 0 ? dq.peekBits(dq.length) : 0;
    });
    let pushWord = 0;
    for (let i = 0; i < pushedBits.length; i++) {
      if (pushedBits[i]) pushWord |= (1 << i);
    }
    return {
      kind,
      nextQ: regName ? regs.get(regName) : 0,
      shifts,
      emitWords,
      emitLens,
      popStack: totalPoppedFromInit,
      pushStackWord: pushWord >>> 0,
      pushStackLen: pushedBits.length,
      stackCleared,
      ...extra
    };
  }
}

/**
 * Test if a per-token bitmask `unitMask` (strict subset of `(1 << w) - 1`) produces
 * 100% identical CFG behavior across all VALID tag ordinals `0 .. tagCounts[p]-1`
 * on port `portIdx` (invalid out-of-range ordinals like `0b11` on 3-tag `$bits` are
 * handled soundly via conservative `NEED_MORE` fallback during compressed synthesis!).
 */
function findMinimalUnitMask({
  kernel,
  blockMap,
  loopHeader,
  slowLabel,
  regName,
  numStates,
  inputNames,
  portWidths,
  tagCounts,
  outputNames,
  exitLabelToId,
  portIdx
}) {
  const w = portWidths[portIdx];
  const fullMask = (1 << w) - 1;
  if (w <= 1) return fullMask;

  // Test on a 1-token or 2-token probe so multi-token-per-step kernels (e.g. `half_max_tally`
  // which inspects 2 tokens per step!) also reveal exact don't-care bits!
  const probeTokens = (numStates * portWidths.reduce((a, x) => a * (1 << (2 * x)), 1) <= 512) ? 2 : 1;
  const probeWidths = portWidths.map((pw) => pw * probeTokens);
  const validTokCounts = tagCounts.map((c, i) => Math.min(c, 1 << portWidths[i]));

  // Build list of valid probe values per port (all combinations of valid tag ordinals!)
  const validProbesPerPort = portWidths.map((pw, p) => {
    const vals = [];
    const nTags = validTokCounts[p];
    if (probeTokens === 1) {
      for (let t0 = 0; t0 < nTags; t0++) vals.push(t0);
    } else {
      for (let t0 = 0; t0 < nTags; t0++) {
        for (let t1 = 0; t1 < nTags; t1++) {
          vals.push((t0 << pw) | t1);
        }
      }
    }
    return vals;
  });

  const totalCombos = numStates * validProbesPerPort.reduce((a, vs) => a * vs.length, 1);
  if (totalCombos > 1024) return fullMask;

  const refBehavior = new Map();
  const enumerate = (q, idx, acc) => {
    if (idx === inputNames.length) {
      const sim = simulateKernelReferenceCFG({
        kernel,
        blockMap,
        loopHeader,
        slowLabel,
        regName,
        startQ: q,
        inputNames,
        inputBits: acc,
        inputWidths: probeWidths,
        outputNames,
        exitLabelToId
      });
      const sig = `${sim.kind}|${sim.nextQ}|${sim.exitId ?? ""}|${sim.shifts.join(",")}|${sim.emitWords.join(",")}|${sim.emitLens.join(",")}`;
      refBehavior.set(`${q}:${acc.join(",")}`, sig);
      return;
    }
    for (const v of validProbesPerPort[idx]) {
      acc[idx] = v;
      enumerate(q, idx + 1, acc);
    }
  };
  for (let q = 0; q < numStates; q++) enumerate(q, 0, new Array(inputNames.length));

  let curMask = fullMask;
  for (let b = 0; b < w; b++) {
    const cand = curMask & ~(1 << b);
    if (cand === 0) continue;
    const probeCandMask = repeatUnitMask(cand, w, probeTokens);
    let identical = true;

    for (let q = 0; q < numStates && identical; q++) {
      const groups = new Map();
      for (const [k, sig] of refBehavior.entries()) {
        if (!k.startsWith(`${q}:`)) continue;
        const toks = k.slice(k.indexOf(":") + 1).split(",").map(Number);
        toks[portIdx] = compressBitsWithMask(toks[portIdx], probeWidths[portIdx], probeCandMask);
        const gk = toks.join(",");
        if (!groups.has(gk)) groups.set(gk, sig);
        else if (groups.get(gk) !== sig) {
          identical = false;
          break;
        }
      }
    }
    if (identical) curMask = cand;
  }

  return curMask;
}

/**
 * Synthesize static bit-chunk, virtual-stack, and FSM transition tables for
 * eligible kernels in a `mono` kTVM module under a global Howard MWTR byte budget.
 */
export function synthesizeTables(
  mod,
  {
    budgetBytes = DEFAULT_L1_BUDGET_BYTES,
    maxEntriesPerTable = 4096,
    maxTagWidth = 4
  } = {}
) {
  if (mod.layer !== "mono") {
    throw new Error("synthesizeTables requires a concrete 'mono' kTVM module");
  }

  const outMod = cloneAst(mod);
  const existingTableNames = new Set((outMod.tables || []).map((t) => t.name));

  // Keep `_optMeta` references from the original `mod` (structuredClone preserves plain objects)
  const frontiers = [];
  const kernelReports = [];

  for (const kernel of outMod.kernels || []) {
    const meta = kernel._optMeta;
    if (!meta) continue;
    // Skip if kernel already dispatches a table
    if (kernel.blocks.some((b) => ["table_step", "stack_table_step", "fsm_table_step"].includes(b.term.op))) {
      continue;
    }

    const blockMap = new Map(kernel.blocks.map((b) => [b.label, b]));
    const streamPorts = meta.streamPortIndices;
    const regPorts = meta.regPortIndices;
    const stackPorts = meta.stackPortIndices;

    // Skip kernels with > 1 register (compound state) or 0 / > 2 stream ports
    if (regPorts.length > 1 || streamPorts.length === 0 || streamPorts.length > 2) continue;

    // Check stream tag widths (graceful fallback on wide alphabets like `ascii[]`!)
    const tagCounts = streamPorts.map((p) => {
      const pl = meta.inLeaves[p].plist;
      if (pl[0][0] !== "closed-union") return 999;
      return pl[0][1].length;
    });
    const tagWidths = tagCounts.map((c) => (c > 256 ? 99 : choiceWidth(c)));
    if (tagWidths.some((w) => w < 1 || w > maxTagWidth)) {
      kernelReports.push({ kernel: kernel.name, status: "cfg_only_wide_alphabet", tagWidths });
      continue;
    }

    // Only emit tables when outputs are pure push/unshift (or 0..2 outputs)
    if (kernel.outputs.length === 0 || kernel.outputs.length > 2) continue;

    const exitLabelToId = new Map(meta.exitBlocks.map((lbl, idx) => [lbl, idx]));
    const regDecl = regPorts.length === 1 ? kernel.regs[0] : null;
    const numStates = regDecl ? regDecl.states : 1;
    const regName = regDecl ? regDecl.name : null;
    const inputNames = streamPorts.map((p) => kernel.inputs[p].name);
    const outputNames = kernel.outputs.map((o) => o.name);

    // --- Case 1: Streaming Loop Kernel -> `chunk_table` (with SWAR compression!) ---
    if (meta.isLoop && stackPorts.length === 0) {
      // Discover minimal per-token SWAR compression masks!
      const unitMasks = streamPorts.map((_, idx) =>
        findMinimalUnitMask({
          kernel,
          blockMap,
          loopHeader: meta.loopHeaderLabel,
          slowLabel: meta.slowStepLabel,
          regName,
          numStates,
          inputNames,
          portWidths: tagWidths,
          tagCounts,
          outputNames,
          exitLabelToId,
          portIdx: idx
        })
      );
      const effPerTok = unitMasks.map(popcount);

      // Generate candidate token counts (k0, [k1])
      const tokenConfigs = [];
      if (streamPorts.length === 1) {
        for (let k0 = 1; k0 <= 4; k0++) {
          const eff = k0 * effPerTok[0];
          const entries = numStates * (1 << eff);
          if (entries <= maxEntriesPerTable && k0 * tagWidths[0] <= 16) {
            tokenConfigs.push([k0]);
          }
        }
      } else {
        for (let k = 1; k <= 3; k++) {
          const eff0 = k * effPerTok[0];
          const eff1 = k * effPerTok[1];
          const entries = numStates * (1 << (eff0 + eff1));
          if (entries <= maxEntriesPerTable && k * tagWidths[0] <= 12 && k * tagWidths[1] <= 12) {
            tokenConfigs.push([k, k]);
          }
        }
      }

      const candidates = [];
      for (const cfg of tokenConfigs) {
        const cand = buildChunkTableCandidate({
          kernel,
          meta,
          blockMap,
          regName,
          numStates,
          inputNames,
          outputNames,
          tagWidths,
          unitMasks,
          effPerTok,
          tokenCounts: cfg,
          exitLabelToId
        });
        if (cand && cand.rho > 0 && Number.isFinite(cand.rho)) {
          candidates.push(cand);
        }
      }

      if (candidates.length > 0) {
        frontiers.push({ kernelName: kernel.name, candidates });
      }
      continue;
    }

    // --- Case 2: Virtual-Stack Kernel -> `stack_table` ---
    if (meta.isLoop && stackPorts.length === 1 && streamPorts.length === 1) {
      const stackName = kernel.stacks[0].name;
      const candidates = [];
      for (let kStream = 1; kStream <= 2; kStream++) {
        const wStream = kStream * tagWidths[0];
        if (wStream > 6) continue;
        for (let wStack = 1; wStack <= 3; wStack++) {
          const stackStride = (1 << (wStack + 1)) - 1;
          if (numStates * (1 << wStream) * stackStride > maxEntriesPerTable) continue;
          const cand = buildStackTableCandidate({
            kernel,
            meta,
            blockMap,
            regName,
            numStates,
            inputName: inputNames[0],
            outputName: outputNames[0],
            stackName,
            wStream,
            wStack,
            exitLabelToId
          });
          if (cand && cand.rho > 0 && Number.isFinite(cand.rho)) {
            candidates.push(cand);
          }
        }
      }
      if (candidates.length > 0) {
        frontiers.push({ kernelName: kernel.name, candidates });
      }
      continue;
    }

    // --- Case 3: Acyclic Multi-Step 1-Stream Kernel -> `fsm_table` ---
    if (!meta.isLoop && streamPorts.length === 1 && stackPorts.length === 0 && regPorts.length === 0) {
      const wRaw = tagWidths[0];
      if ((1 << wRaw) <= 64) {
        const cand = buildFsmTableCandidate({
          kernel,
          meta,
          blockMap,
          inputName: inputNames[0],
          outputNames,
          wRaw,
          exitLabelToId
        });
        if (cand) {
          frontiers.push({ kernelName: kernel.name, candidates: [cand] });
        }
      }
    }
  }

  // Run global Howard MWTR L1 budget allocation across ALL kernels!
  const allocation = allocateTableBudgets(frontiers, { budgetBytes });
  let tablesSynthesized = 0;

  for (const kernel of outMod.kernels || []) {
    const picked = allocation.chosen.get(kernel.name);
    if (!picked) continue;

    let tName = `&tab_${sanitize(kernel.name)}`;
    let tSeq = 0;
    while (existingTableNames.has(tName)) tName = `&tab_${sanitize(kernel.name)}_${tSeq++}`;
    existingTableNames.add(tName);

    const meta = kernel._optMeta;
    const exits = { short: meta.slowStepLabel, fail: "err" };
    meta.exitBlocks.forEach((lbl, idx) => { exits[String(idx)] = lbl; });

    // Ensure kernel has a register if `table_step` needs one (dummy 1-state reg if stateless)
    let regName = picked.regName;
    if ((picked.kind === "chunk_table" || picked.kind === "stack_table") && !regName) {
      regName = "q0";
      kernel.regs = [...(kernel.regs || []), { name: regName, states: 1, init: 0 }];
    }

    // Wire `table_step` / `stack_table_step` / `fsm_table_step` into loop header block!
    const hdrBlk = kernel.blocks.find((b) => b.label === meta.loopHeaderLabel);
    if (!hdrBlk) continue;

    if (picked.kind === "chunk_table") {
      hdrBlk.term = {
        op: "table_step",
        table: tName,
        reg: regName,
        inputs: picked.inputNames,
        outputs: picked.outputNames,
        exits
      };
    } else if (picked.kind === "stack_table") {
      hdrBlk.term = {
        op: "stack_table_step",
        table: tName,
        reg: regName,
        input: picked.inputName,
        stack: picked.stackName,
        output: picked.outputName,
        exits
      };
    } else if (picked.kind === "fsm_table") {
      hdrBlk.term = {
        op: "fsm_table_step",
        table: tName,
        input: picked.inputName,
        outputs: picked.outputNames,
        exits
      };
    }

    outMod.tables.push({
      name: tName,
      kind: picked.kind,
      props: {
        ...picked.props,
        verified_against: { proc: kernel.name },
        mwtr: {
          rho: Number(picked.rho.toFixed(4)),
          bytes: picked.bytes,
          budget_class: budgetClassForBytes(picked.bytes)
        }
      },
      entries: picked.entries,
      packedBase64: null
    });

    tablesSynthesized += 1;
    kernelReports.push({
      kernel: kernel.name,
      table: tName,
      kind: picked.kind,
      entries: picked.entries.length,
      bytes: picked.bytes,
      rho: Number(picked.rho.toFixed(4)),
      compressed: Boolean(picked.compressed)
    });
  }

  // Strip internal `_optMeta` before returning clean canonical AST
  for (const k of outMod.kernels || []) delete k._optMeta;

  return {
    module: outMod,
    stats: {
      tablesSynthesized,
      totalTableBytes: allocation.usedBytes,
      budgetBytes,
      kernelReports
    }
  };
}

function buildChunkTableCandidate({
  kernel,
  meta,
  blockMap,
  regName,
  numStates,
  inputNames,
  outputNames,
  tagWidths,
  unitMasks,
  effPerTok,
  tokenCounts,
  exitLabelToId
}) {
  const rawBits = tokenCounts.map((k, i) => k * tagWidths[i]);
  const effBits = tokenCounts.map((k, i) => k * effPerTok[i]);
  const fullMasks = tokenCounts.map((k, i) => repeatUnitMask(unitMasks[i], tagWidths[i], k));
  const isCompressed = tokenCounts.map((k, i) => effBits[i] < rawBits[i]);
  const totalEff = effBits.reduce((a, b) => a + b, 0);
  const numEntries = numStates * (1 << totalEff);

  const entries = [];
  const mwtrEdges = [];
  let maxEmitBits = 0;
  let contCount = 0;

  if (!isCompressed.some(Boolean)) {
    for (let idx = 0; idx < numEntries; idx++) {
      let rem = idx;
      const rawVals = new Array(inputNames.length);
      for (let p = inputNames.length - 1; p >= 0; p--) {
        rawVals[p] = rem & ((1 << rawBits[p]) - 1);
        rem >>>= rawBits[p];
      }
      const startQ = rem;

      const sim = simulateKernelReferenceCFG({
        kernel,
        blockMap,
        loopHeader: meta.loopHeaderLabel,
        slowLabel: meta.slowStepLabel,
        regName,
        startQ,
        inputNames,
        inputBits: rawVals,
        inputWidths: rawBits,
        outputNames,
        exitLabelToId
      });

      if (sim.kind === "CONT") {
        contCount++;
        const totalShifted = sim.shifts.reduce((a, b) => a + b, 0);
        if (totalShifted === 0) return null;
        for (const el of sim.emitLens) if (el > maxEmitBits) maxEmitBits = el;
        mwtrEdges.push({ from: startQ, to: sim.nextQ, w: totalShifted, t: 1 });
        entries.push({
          index: idx,
          value: {
            kind: { ident: "CONT" },
            next_q: sim.nextQ,
            shift: sim.shifts,
            emit_word: sim.emitWords,
            emit_len: sim.emitLens
          }
        });
      } else if (sim.kind === "EXIT") {
        for (const el of sim.emitLens) if (el > maxEmitBits) maxEmitBits = el;
        entries.push({
          index: idx,
          value: {
            kind: { ident: "EXIT" },
            exit: sim.exitId,
            shift: sim.shifts,
            emit_word: sim.emitWords,
            emit_len: sim.emitLens
          }
        });
      } else if (sim.kind === "NEED_MORE") {
        entries.push({ index: idx, value: { kind: { ident: "NEED_MORE" } } });
      } else {
        entries.push({ index: idx, value: { kind: { ident: "FAIL" } } });
      }
    }
  } else {
    // Compressed table synthesis: exhaustively group ALL raw windows by compressed key!
    // Any compressed key where ALL raw windows agree gets the exact CONT/EXIT/FAIL entry;
    // any key where raw windows disagree (e.g. valid `_` vs invalid `0b11` on 3-tag `$bits`)
    // soundly stores `NEED_MORE`, punting the boundary/error case directly to `slow_step`!
    const rawSpace = numStates * rawBits.reduce((a, w) => a * (1 << w), 1);
    if (rawSpace > 16384) return null;

    const bucketSim = new Array(numEntries).fill(null);
    const bucketConflict = new Uint8Array(numEntries);

    const sameOutcome = (a, b) => {
      if (a.kind !== b.kind) return false;
      if (a.kind === "CONT") {
        if (a.nextQ !== b.nextQ) return false;
        if (a.shifts.some((v, i) => v !== b.shifts[i])) return false;
        if (a.emitLens.some((v, i) => v !== b.emitLens[i])) return false;
        if (a.emitWords.some((v, i) => v !== b.emitWords[i])) return false;
      } else if (a.kind === "EXIT") {
        if (a.exitId !== b.exitId) return false;
        if (a.shifts.some((v, i) => v !== b.shifts[i])) return false;
        if (a.emitLens.some((v, i) => v !== b.emitLens[i])) return false;
        if (a.emitWords.some((v, i) => v !== b.emitWords[i])) return false;
      }
      return true;
    };

    const walkRaw = (q, p, rawAcc) => {
      if (p === inputNames.length) {
        let cIdx = q;
        for (let i = 0; i < inputNames.length; i++) {
          const eff = isCompressed[i]
            ? compressBitsWithMask(rawAcc[i], rawBits[i], fullMasks[i])
            : rawAcc[i];
          cIdx = (cIdx << effBits[i]) | eff;
        }
        if (bucketConflict[cIdx]) return;
        const sim = simulateKernelReferenceCFG({
          kernel,
          blockMap,
          loopHeader: meta.loopHeaderLabel,
          slowLabel: meta.slowStepLabel,
          regName,
          startQ: q,
          inputNames,
          inputBits: rawAcc,
          inputWidths: rawBits,
          outputNames,
          exitLabelToId
        });
        if (bucketSim[cIdx] === null) {
          bucketSim[cIdx] = sim;
        } else if (!sameOutcome(bucketSim[cIdx], sim)) {
          bucketConflict[cIdx] = 1;
        }
        return;
      }
      for (let r = 0; r < (1 << rawBits[p]); r++) {
        rawAcc[p] = r;
        walkRaw(q, p + 1, rawAcc);
      }
    };
    for (let q = 0; q < numStates; q++) walkRaw(q, 0, new Array(inputNames.length));

    for (let idx = 0; idx < numEntries; idx++) {
      const startQ = idx >>> totalEff;
      const sim = bucketConflict[idx] ? { kind: "NEED_MORE" } : bucketSim[idx];
      if (!sim || sim.kind === "NEED_MORE") {
        entries.push({ index: idx, value: { kind: { ident: "NEED_MORE" } } });
      } else if (sim.kind === "CONT") {
        contCount++;
        const totalShifted = sim.shifts.reduce((a, b) => a + b, 0);
        if (totalShifted === 0) return null;
        for (const el of sim.emitLens) if (el > maxEmitBits) maxEmitBits = el;
        mwtrEdges.push({ from: startQ, to: sim.nextQ, w: totalShifted, t: 1 });
        entries.push({
          index: idx,
          value: {
            kind: { ident: "CONT" },
            next_q: sim.nextQ,
            shift: sim.shifts,
            emit_word: sim.emitWords,
            emit_len: sim.emitLens
          }
        });
      } else if (sim.kind === "EXIT") {
        for (const el of sim.emitLens) if (el > maxEmitBits) maxEmitBits = el;
        entries.push({
          index: idx,
          value: {
            kind: { ident: "EXIT" },
            exit: sim.exitId,
            shift: sim.shifts,
            emit_word: sim.emitWords,
            emit_len: sim.emitLens
          }
        });
      } else {
        entries.push({ index: idx, value: { kind: { ident: "FAIL" } } });
      }
    }
  }

  if (contCount === 0 || maxEmitBits > 30) return null;

  const mwtr = computeMWTR(numStates, mwtrEdges);
  const bytesPerEntry = 4 + 4 * outputNames.length; // compact native entry size
  const bytes = numEntries * bytesPerEntry;

  return {
    kind: "chunk_table",
    regName,
    inputNames,
    outputNames,
    entries,
    bytes,
    rho: mwtr.rho,
    compressed: isCompressed.some(Boolean),
    props: {
      states: numStates,
      inputs: inputNames.map((_, p) => ({
        port: p,
        raw_bits: rawBits[p],
        eff_bits: effBits[p],
        compress: isCompressed[p] ? { mask: fullMasks[p] } : { ident: "none" }
      })),
      outputs: outputNames.map((_, o) => ({
        port: o,
        mode: { ident: (meta.outputModes && meta.outputModes[o]) || "push" },
        max_emit_bits: maxEmitBits
      }))
    }
  };
}

function buildStackTableCandidate({
  kernel,
  meta,
  blockMap,
  regName,
  numStates,
  inputName,
  outputName,
  stackName,
  wStream,
  wStack,
  exitLabelToId
}) {
  const stackStride = (1 << (wStack + 1)) - 1; // bijective depth+bits encoding
  const numEntries = numStates * (1 << wStream) * stackStride;
  if (numEntries > 4096) return null;

  const entries = [];
  const mwtrEdges = [];
  let maxEmitBits = 0;
  let contCount = 0;

  for (let q = 0; q < numStates; q++) {
    for (let sBits = 0; sBits < (1 << wStream); sBits++) {
      for (let stCode = 0; stCode < stackStride; stCode++) {
        // Decode bijective stack code -> (depth, topBits)
        let depth = 0;
        let topBits = 0;
        if (stCode > 0) {
          let rem = stCode;
          for (let d = 1; d <= wStack; d++) {
            const count = 1 << d;
            if (rem <= count) {
              depth = d;
              topBits = rem - 1;
              break;
            }
            rem -= count;
          }
        }
        const idx = (((q << wStream) | sBits) * stackStride) + stCode;

        const sim = simulateKernelReferenceCFG({
          kernel,
          blockMap,
          loopHeader: meta.loopHeaderLabel,
          slowLabel: meta.slowStepLabel,
          regName,
          startQ: q,
          inputNames: [inputName],
          inputBits: [sBits],
          inputWidths: [wStream],
          outputNames: [outputName],
          stackName,
          initStackBits: topBits,
          initStackDepth: depth,
          stackWindowTruncated: wStack > 0 && depth === wStack,
          exitLabelToId
        });

        if (sim.stackCleared && sim.kind === "CONT") return null;

        if (sim.kind === "CONT") {
          contCount++;
          const sh = sim.shifts[0];
          const progress = sh + sim.popStack;
          if (progress === 0) return null;
          if (sim.emitLens[0] > maxEmitBits) maxEmitBits = sim.emitLens[0];
          // Amortized cycle weight: input bits shifted + popped bits (2b emitted per popped stack bit)
          mwtrEdges.push({ from: q, to: sim.nextQ, w: sh + sim.popStack * 2, t: 1 });
          entries.push({
            index: idx,
            value: {
              kind: { ident: "CONT" },
              next_q: sim.nextQ,
              shift_stream: sh,
              pop_stack: sim.popStack,
              push_stack_word: sim.pushStackWord,
              push_stack_len: sim.pushStackLen,
              emit_word: sim.emitWords[0],
              emit_len: sim.emitLens[0]
            }
          });
        } else if (sim.kind === "EXIT") {
          if (sim.emitLens[0] > maxEmitBits) maxEmitBits = sim.emitLens[0];
          entries.push({
            index: idx,
            value: {
              kind: { ident: "EXIT" },
              exit: sim.exitId,
              shift_stream: sim.shifts[0],
              pop_stack: sim.popStack,
              push_stack_word: sim.pushStackWord,
              push_stack_len: sim.pushStackLen,
              emit_word: sim.emitWords[0],
              emit_len: sim.emitLens[0]
            }
          });
        } else if (sim.kind === "NEED_MORE") {
          entries.push({ index: idx, value: { kind: { ident: "NEED_MORE" } } });
        } else {
          entries.push({ index: idx, value: { kind: { ident: "FAIL" } } });
        }
      }
    }
  }

  if (contCount === 0 || maxEmitBits > 30) return null;
  const mwtr = computeMWTR(numStates, mwtrEdges);
  const bytes = numEntries * 8;

  return {
    kind: "stack_table",
    regName,
    inputName,
    outputName,
    stackName,
    entries,
    bytes,
    rho: mwtr.rho,
    compressed: false,
    props: {
      states: numStates,
      stream_bits: wStream,
      stack_bits: wStack,
      stack_encoding: { ident: "bits" },
      output_mode: { ident: "push" }
    }
  };
}

function buildFsmTableCandidate({
  kernel,
  meta,
  blockMap,
  inputName,
  outputNames,
  wRaw,
  exitLabelToId
}) {
  const numEntries = 1 << wRaw;
  const entries = [];
  let maxEmitBits = 0;
  let exitCount = 0;

  for (let idx = 0; idx < numEntries; idx++) {
    const sim = simulateKernelReferenceCFG({
      kernel,
      blockMap,
      loopHeader: null,
      slowLabel: meta.slowStepLabel,
      regName: null,
      startQ: 0,
      inputNames: [inputName],
      inputBits: [idx],
      inputWidths: [wRaw],
      outputNames,
      exitLabelToId
    });
    if (sim.kind === "EXIT") {
      exitCount++;
      for (const el of sim.emitLens) if (el > maxEmitBits) maxEmitBits = el;
      entries.push({
        index: idx,
        value: {
          kind: { ident: "EXIT" },
          exit: sim.exitId,
          shift: sim.shifts,
          emit_word: sim.emitWords,
          emit_len: sim.emitLens
        }
      });
    } else if (sim.kind === "NEED_MORE") {
      entries.push({ index: idx, value: { kind: { ident: "NEED_MORE" } } });
    } else {
      entries.push({ index: idx, value: { kind: { ident: "FAIL" } } });
    }
  }

  if (exitCount === 0 || maxEmitBits > 30) return null;
  const bytes = numEntries * (4 + 4 * outputNames.length);
  return {
    kind: "fsm_table",
    regName: null,
    inputName,
    outputNames,
    entries,
    bytes,
    rho: wRaw,
    compressed: false,
    props: {
      input_bits: wRaw,
      output_modes: outputNames.map(() => ({ ident: "push" }))
    }
  };
}
