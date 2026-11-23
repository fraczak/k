/**
 * Iteration 4: Variable-Width Bit-Chunk Compiler over Unmodified `k-wire`.
 *
 * Keeps K's wire serialization (`codecs/WIRE_FORMAT.md`) 100% UNTOUCHED!
 * Instead of forcing transducers to step either 1 token at a time OR on fixed
 * byte boundaries (which breaks alignment across 1b/2b/3b/7b `k-wire` tokens),
 * `BitChunkCompilerV4` lowers V3 decision DAGs (`COMPILED_LOOP` AND `COMPILED_FSM`)
 * to bit-level `k-wire` tests and compiles them into **variable-width bit-chunk**
 * super-transitions where ONE increment consumes `consumeBits ∈ 1..W_raw` raw
 * `k-wire` bits — NOT necessarily aligned to a single token:
 *
 *   1. **Sub-token bit-prefix guards**: e.g. on `bits[]` (`0=00, 1=01, _=10`),
 *      peeking just the 1st bit (`0` vs `1`) disambiguates `{0,1}` from `_`
 *      without reading bit 1 (`lsb_shl` guards `x` on 1 single bit!).
 *   2. **Automatic don't-care bit compression (PEXT-style key packing)**:
 *      Whenever a `w`-bit `k-wire` token only depends on `k < w` bits for all
 *      continuing transitions (e.g. `mask=0b10` -> 1 bit per 2-bit `bits[]` tag
 *      on `lsb_shl.k`, `_half_max_tally.{x,y}`, `_lsb_split.k`, `_classify_bits.x`,
 *      `_drop16.x`), we gather ONLY the relevant bits via 4 SWAR bitwise ops!
 *      This DOUBLES the raw `k-wire` chunk width inside the EXACT same L1 table:
 *        - `lsb_shl`:         W_raw = 16b (8 tokens) in 256 entries!
 *        - `_classify_bits`:  W_raw = 16b (8 tokens) in 3×256 = 768 entries!
 *        - `_half_max_tally`: W_raw = 12b × 12b (24b total!) in 4,096 entries (3× jump)!
 *        - `_lsb_split`:      W_raw = 8b × 8b (16b total!) in 4,096 entries!
 *   3. **Heterogeneous cross-schema FSM chunks**:
 *      For multi-step 1-stream `COMPILED_FSM`s whose transitions cross different
 *      union schemas with different bit-widths (e.g., `int[]` 1b + `bits[]` 2b×k = 7b,
 *      or `unicode` `ascii` 3b + 7×1b = 10b), synthesizes variable-width `W_raw=8`
 *      chunk tables consuming `1..8` raw `k-wire` bits across multiple schema nodes
 *      in ONE lookup!
 */

import { computeMWTR } from "./mwtr.mjs";

function popcount(x) {
  let c = 0;
  let v = x >>> 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

/**
 * Extract masked bits of one `w`-bit code `raw` according to `unitMask` (MSB-first).
 */
function maskSingleCode(raw, w, unitMask) {
  let out = 0;
  for (let b = w - 1; b >= 0; b--) {
    if ((unitMask >>> b) & 1) {
      out = (out << 1) | ((raw >>> b) & 1);
    }
  }
  return out;
}

/**
 * Build a fast SWAR bit-extractor for `numTokens` consecutive `w`-bit `k-wire` tokens
 * with per-token sensitivity mask `unitMask`.
 */
function buildBitExtractor(w, unitMask, numTokens) {
  const W_raw = w * numTokens;
  const fullMask = (1 << w) - 1;
  const kBitsPerTok = popcount(unitMask);
  const keyBits = kBitsPerTok * numTokens;

  if (unitMask === fullMask) {
    return {
      w,
      unitMask,
      numTokens,
      W_raw,
      kBitsPerTok: w,
      keyBits: W_raw,
      isIdentity: true,
      extract: (v) => v
    };
  }

  // Fast 4-op SWAR Morton-pack for `w === 2, unitMask === 0b10` (high bit of every 2-bit pair, up to 8 tokens = 16b!)
  if (w === 2 && unitMask === 0b10 && numTokens <= 8) {
    return {
      w,
      unitMask,
      numTokens,
      W_raw,
      kBitsPerTok: 1,
      keyBits: numTokens,
      isIdentity: false,
      extract: (v) => {
        let x = (v >>> 1) & 0x5555;
        x = (x | (x >>> 1)) & 0x3333;
        x = (x | (x >>> 2)) & 0x0f0f;
        x = (x | (x >>> 4)) & 0x00ff;
        return x;
      }
    };
  }

  // Fast 4-op SWAR pack for `w === 2, unitMask === 0b01` (low bit of every 2-bit pair, up to 8 tokens = 16b!)
  if (w === 2 && unitMask === 0b01 && numTokens <= 8) {
    return {
      w,
      unitMask,
      numTokens,
      W_raw,
      kBitsPerTok: 1,
      keyBits: numTokens,
      isIdentity: false,
      extract: (v) => {
        let x = v & 0x5555;
        x = (x | (x >>> 1)) & 0x3333;
        x = (x | (x >>> 2)) & 0x0f0f;
        x = (x | (x >>> 4)) & 0x00ff;
        return x;
      }
    };
  }

  // General fallback for any `(w, unitMask, numTokens)`
  const bitOffsets = [];
  for (let tok = 0; tok < numTokens; tok++) {
    const base = (numTokens - 1 - tok) * w;
    for (let b = w - 1; b >= 0; b--) {
      if ((unitMask >>> b) & 1) bitOffsets.push(base + b);
    }
  }
  return {
    w,
    unitMask,
    numTokens,
    W_raw,
    kBitsPerTok,
    keyBits,
    isIdentity: false,
    extract: (v) => {
      let out = 0;
      for (let i = 0; i < bitOffsets.length; i++) {
        out = (out << 1) | ((v >>> bitOffsets[i]) & 1);
      }
      return out;
    }
  };
}

/**
 * Check whether two union nodes in `plist` share the exact same `k-wire` tag layout
 * (same tag names in the same canonical order -> identical bit-widths & codepoints).
 */
function sameUnionLayout(plist, nodeA, nodeB) {
  if (nodeA === nodeB) return true;
  const a = plist?.[nodeA];
  const b = plist?.[nodeB];
  if (!a || !b) return false;
  if ((a[0] !== "closed-union" && a[0] !== "open-union") || (b[0] !== "closed-union" && b[0] !== "open-union")) {
    return false;
  }
  const ea = a[1];
  const eb = b[1];
  if (ea.length !== eb.length) return false;
  for (let i = 0; i < ea.length; i++) {
    if (ea[i][0] !== eb[i][0]) return false;
  }
  return true;
}

/**
 * Precompute equivalence classes of `w`-bit `k-wire` codes under `unitMask` for a
 * union node `(tbl, plist, baseNodeId)`.
 *
 * `classRep[mk]` is non-null iff EVERY `w`-bit completion of masked key `mk` is a
 * valid continuing tag (matching `sameUnionLayout(plist, baseNodeId, ent.target)`
 * OR — when `allowFinalEmit` is true for FSM chains — leading to an identical edge).
 */
function buildMaskedTokenTable(tbl, plist, baseNodeId, unitMask, continuingTagSet = null) {
  const w = tbl.maxWidth;
  const kBits = popcount(unitMask);
  const numClasses = 1 << kBits;
  const buckets = Array.from({ length: numClasses }, () => []);
  for (let raw = 0; raw < (1 << w); raw++) {
    const mk = maskSingleCode(raw, w, unitMask);
    buckets[mk].push(raw);
  }
  const classRep = new Array(numClasses).fill(null);
  for (let mk = 0; mk < numClasses; mk++) {
    const raws = buckets[mk];
    let allCont = raws.length > 0;
    for (const raw of raws) {
      const ent = tbl.decodeTable[raw];
      if (!ent) { allCont = false; break; }
      const isCont = continuingTagSet
        ? continuingTagSet.has(ent.tag)
        : sameUnionLayout(plist, baseNodeId, ent.target);
      if (!isCont) { allCont = false; break; }
    }
    if (allCont) {
      classRep[mk] = tbl.decodeTable[raws[0]];
    }
  }
  return { w, kBits, unitMask, classRep, buckets };
}

/**
 * Check whether two V3 DAG nodes are equivalent on all CONTINUING loop paths
 * (i.e. ignoring exit-only `emit` leaves, which never execute inside a stride loop!).
 * For example, in `_lsb_split`, `PEEK(k[0])` branches `"0" -> D4` and `"1" -> D6`
 * have identical loop leaves (`D1`, `D2`) and only differ on exit (`D3` vs `D5`),
 * so `k`'s low bit is 100% don't-care inside the streaming loop!
 */
function areLoopEquivalent(a, b, memo = new Map()) {
  if (a === b) return true;
  if (!a || !b) return false;
  // Two non-loop leaves (emit/fail) never run inside a continuing chunk!
  const aTerm = a.kind === "emit" || a.kind === "fail";
  const bTerm = b.kind === "emit" || b.kind === "fail";
  if (aTerm && bTerm) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "loop") return a.id === b.id;
  if (a.p !== b.p || a.depth !== b.depth) return false;
  const mk = `${a.id}:${b.id}`;
  if (memo.has(mk)) return memo.get(mk);
  memo.set(mk, true); // optimistic for DAG
  const keys = new Set([...Object.keys(a.cases || {}), ...Object.keys(b.cases || {})]);
  for (const k of keys) {
    if (!areLoopEquivalent(a.cases?.[k], b.cases?.[k], memo)) {
      memo.set(mk, false);
      return false;
    }
  }
  return true;
}

/**
 * Automatically discover the minimal per-token bit-sensitivity mask `unitMask`
 * for stream port `portIdx` across all reachable decision nodes of `compiled`.
 */
function analyzePortUnitMask(compiled, bp, tbl, baseNodeId, portIdx, isLoop) {
  const w = tbl.maxWidth;
  const fullMask = (1 << w) - 1;
  if (w <= 1) return fullMask;

  // Collect all reachable decision nodes branching on `portIdx`
  const portNodes = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    if ((n.kind === "peek" || n.kind === "shift") && n.p === portIdx) {
      portNodes.push(n);
    }
    if (n.cases) for (const c of Object.values(n.cases)) walk(c);
  };
  walk(compiled.root);
  if (portNodes.length === 0) return fullMask;

  // Identify continuing tags: tags whose target keeps the same union layout
  // (covers both self-recursive `bits[]` AND unrolled finite chains like `_drop16`/`_classify_bits`!)
  const contEntries = [];
  const contTagSet = new Set();
  for (const ent of tbl.byTag.values()) {
    if (sameUnionLayout(bp.inPlist, baseNodeId, ent.target)) {
      contEntries.push(ent);
      contTagSet.add(ent.tag);
    }
  }
  // For unrolled finite chains (like `_classify_bits` where `inPlist[0]` has `"0"->1, "1"->21`),
  // also check `sameUnionLayout(bp.inPlist, 0, ent.target)` — already handled above!
  if (contEntries.length === 0) return fullMask;

  let curMask = fullMask;
  for (let b = 0; b < w; b++) {
    const cand = curMask & ~(1 << b);
    if (cand === 0) continue;

    // 1. Every continuing tag must remain separated from all non-continuing / invalid codes
    const mt = buildMaskedTokenTable(tbl, bp.inPlist, baseNodeId, cand, contTagSet);
    let separatesAll = true;
    for (const ent of contEntries) {
      const mk = maskSingleCode(ent.code, w, cand);
      if (!mt.classRep[mk]) { separatesAll = false; break; }
    }
    if (!separatesAll) continue;

    // 2. For every reachable decision node on `portIdx`, every pair of continuing tags in
    //    the same `cand`-equivalence class must lead to equivalent transitions!
    let identical = true;
    for (let mk = 0; mk < mt.buckets.length && identical; mk++) {
      if (!mt.classRep[mk]) continue;
      const tagsInClass = mt.buckets[mk].map((raw) => tbl.decodeTable[raw].tag);
      if (tagsInClass.length <= 1) continue;
      for (const dn of portNodes) {
        const refChild = dn.cases[tagsInClass[0]];
        for (let i = 1; i < tagsInClass.length; i++) {
          const ch = dn.cases[tagsInClass[i]];
          const eq = isLoop ? areLoopEquivalent(refChild, ch) : (refChild === ch);
          if (!eq) { identical = false; break; }
        }
        if (!identical) break;
      }
    }

    if (identical) curMask = cand;
  }

  return curMask;
}

/**
 * Given a set of valid guard tags on union `tbl` (e.g. `{"0", "1"}` on `bits[]`),
 * find the shortest MSB bit-prefix `(prefixBits, prefixCode)` that EXACTLY matches
 * `validTags` (sub-token guard!). Returns `null` if no single bit-prefix matches.
 */
function findSubTokenPrefixGuard(tbl, validTags) {
  const w = tbl.maxWidth;
  if (w <= 1) return null;
  for (let pLen = 1; pLen < w; pLen++) {
    const shift = w - pLen;
    for (let pCode = 0; pCode < (1 << pLen); pCode++) {
      let exact = true;
      let matched = 0;
      for (let raw = 0; raw < (1 << w); raw++) {
        const hasPrefix = (raw >>> shift) === pCode;
        const ent = tbl.decodeTable[raw];
        const isValid = Boolean(ent && validTags.has(ent.tag));
        if (hasPrefix !== isValid) {
          exact = false;
          break;
        }
        if (hasPrefix) matched++;
      }
      if (exact && matched === validTags.size) {
        return { prefixBits: pLen, prefixCode: pCode };
      }
    }
  }
  return null;
}

export class BitChunkCompilerV4 {
  constructor(compilerV3, bitCodec, { maxKeyBits = 12, maxFsmChunkStates = 16 } = {}) {
    this.compilerV3 = compilerV3;
    this.codec = bitCodec;
    this.maxKeyBits = maxKeyBits;
    this.maxFsmChunkStates = maxFsmChunkStates;
    this.cache = new Map(); // relHash -> ChunkTable | null
    this.stats = {
      loop1Compiled: 0,
      loop2Compiled: 0,
      fsmCompressedCompiled: 0,
      fsmHeterogeneousCompiled: 0,
      totalTableEntries: 0
    };
  }

  getChunkTable(relHash) {
    if (this.cache.has(relHash)) return this.cache.get(relHash);
    const compiled = this.compilerV3.getCompiled(relHash);
    let tbl = null;
    if (compiled) {
      tbl = compiled.isLoop
        ? this._trySynthesizeLoop(compiled)
        : this._trySynthesizeFsm(compiled);
    }
    this.cache.set(relHash, tbl);
    if (tbl) {
      if (tbl.kind === "loop") {
        if (tbl.arity === 1) this.stats.loop1Compiled++;
        else this.stats.loop2Compiled++;
      } else if (tbl.fsmMode === "dont-care") {
        this.stats.fsmCompressedCompiled++;
      } else {
        this.stats.fsmHeterogeneousCompiled++;
      }
      this.stats.totalTableEntries += tbl.tableSize;
    }
    return tbl;
  }

  // =========================================================================
  // 1. LOOP Variable-Width Bit-Chunk Compiler (with Don't-Care Key Packing)
  // =========================================================================

  _trySynthesizeLoop(compiled) {
    const bp = this.compilerV3.registry.getBlueprint(compiled.relHash);
    const P = compiled.inCount;
    const regSet = new Set(compiled.registerPorts);

    if (compiled.registerPorts.length > 1) return null;
    const regPort = compiled.registerPorts.length === 1 ? compiled.registerPorts[0] : -1;

    let regTags = [null];
    const regTagToIdx = new Map();
    if (regPort >= 0) {
      const rLeaf = compiled.inLeaves[regPort];
      const rNode = bp.inPlist[rLeaf.nodeId];
      if (!rNode || (rNode[0] !== "closed-union" && rNode[0] !== "open-union")) return null;
      regTags = rNode[1].map(([t]) => t);
      if (regTags.length > 4) return null;
      regTags.forEach((t, i) => regTagToIdx.set(t, i));
    }
    const R = regTags.length;

    const peekedSet = new Set();
    const shiftedSet = new Set();
    const accSet = new Set();
    const loopNodes = [];
    const seen = new Set();
    const walk = (n) => {
      if (!n || seen.has(n.id)) return;
      seen.add(n.id);
      if (n.kind === "peek" && !regSet.has(n.p)) peekedSet.add(n.p);
      if (n.kind === "shift" && !regSet.has(n.p)) { peekedSet.add(n.p); shiftedSet.add(n.p); }
      if (n.kind === "loop") {
        loopNodes.push(n);
        for (let p = 0; p < P; p++) {
          const e = n.nextExprs[p];
          if (e.kind === "splice" && e.newPrefix && e.newPrefix.length > 0) accSet.add(p);
        }
      }
      if (n.cases) for (const c of Object.values(n.cases)) walk(c);
    };
    walk(compiled.root);

    // Peek-guarded accumulators (e.g. `x` in `lsb_shl`: peeked at depth 0, 0 net consumption)
    const guardAccPorts = [];
    for (const p of accSet) {
      if (peekedSet.has(p) && !shiftedSet.has(p)) {
        const zeroNet =
          loopNodes.length > 0 &&
          loopNodes.every((n) => {
            const e = n.nextExprs[p];
            return e.kind === "splice" && e.p === p && e.consumeCount === (e.unconsumed?.length || 0);
          });
        if (zeroNet) guardAccPorts.push(p);
      }
    }
    const guardAccSet = new Set(guardAccPorts);
    const streamPorts = [...peekedSet].filter((p) => !guardAccSet.has(p)).sort((a, b) => a - b);
    const accPorts = [...accSet].filter((p) => !peekedSet.has(p) || guardAccSet.has(p)).sort((a, b) => a - b);

    if (streamPorts.length < 1 || streamPorts.length > 2) return null;
    if (accPorts.length > 1) return null;
    const guardAccPort = guardAccPorts.length === 1 && accPorts[0] === guardAccPorts[0] ? guardAccPorts[0] : -1;

    const streamSpecs = streamPorts.map((p) => {
      const leaf = compiled.inLeaves[p];
      const tbl = this.codec.getNodeTable(bp.inPlist, leaf.nodeId);
      if (!tbl || tbl.maxWidth === 0) return null;
      const unitMask = analyzePortUnitMask(compiled, bp, tbl, leaf.nodeId, p, true);
      const maskedTbl = buildMaskedTokenTable(tbl, bp.inPlist, leaf.nodeId, unitMask);
      return { p, leaf, tbl, unitMask, maskedTbl };
    });
    if (streamSpecs.some((x) => !x)) return null;

    let accSpec = null;
    if (accPorts.length === 1) {
      const p = accPorts[0];
      const leaf = compiled.inLeaves[p];
      const tbl = this.codec.getNodeTable(bp.inPlist, leaf.nodeId);
      if (!tbl || tbl.maxWidth === 0) return null;
      accSpec = { p, leaf, tbl };
    }

    // Choose token-aligned raw window widths `W_raw = numTokens * w` so that total
    // compressed key bits stay <= `this.maxKeyBits` (and `W_raw <= 16`)!
    let extractors;
    if (streamSpecs.length === 1) {
      const s0 = streamSpecs[0];
      const k0 = s0.maskedTbl.kBits;
      // Keep 1-stream compressed tables small and L1-friendly:
      //   - k0=1 (don't-care compressed, e.g. `lsb_shl`): 8 tokens -> W_raw=16b, key=8b (256 entries!)
      //   - k0=2 (full 2b tags, e.g. `_rev_bits`, `trim_bits`): 6 tokens -> W_raw=12b, key=12b (4,096 entries!)
      const maxToksByRaw = Math.floor(16 / s0.tbl.maxWidth);
      const maxToksByKey = Math.floor((k0 === 1 ? Math.min(8, this.maxKeyBits) : this.maxKeyBits) / k0);
      const numToks = Math.max(1, Math.min(maxToksByRaw, maxToksByKey));
      extractors = [buildBitExtractor(s0.tbl.maxWidth, s0.unitMask, numToks)];
    } else {
      const [s0, s1] = streamSpecs;
      const k0 = s0.maskedTbl.kBits;
      const k1 = s1.maskedTbl.kBits;
      // Both streams advance in lockstep (equal token counts maximize paired iterations!)
      const maxToksByKey = Math.floor(this.maxKeyBits / (k0 + k1));
      const maxToksByRaw = Math.min(Math.floor(16 / s0.tbl.maxWidth), Math.floor(16 / s1.tbl.maxWidth));
      const numToks = Math.max(1, Math.min(maxToksByKey, maxToksByRaw));
      extractors = [
        buildBitExtractor(s0.tbl.maxWidth, s0.unitMask, numToks),
        buildBitExtractor(s1.tbl.maxWidth, s1.unitMask, numToks)
      ];
    }

    // Helper: decode token `tokIdx` from compressed key `key` of stream `si`
    const decodeFromCompressedKey = (key, tokIdx, si) => {
      const ext = extractors[si];
      if (tokIdx >= ext.numTokens) return null;
      const kBits = ext.kBitsPerTok;
      const shift = (ext.numTokens - 1 - tokIdx) * kBits;
      const mk = (key >>> shift) & ((1 << kBits) - 1);
      return streamSpecs[si].maskedTbl.classRep[mk]; // non-null iff ALL completions are valid self-tags!
    };

    const runCompressedSim = (initRegIdx, keys, initGuardTag = null) => {
      let regIdx = initRegIdx;
      let curGuardTag = initGuardTag;
      const tokPos = keys.map(() => 0);
      const emitTokens = [];
      let emitBitsTotal = 0;
      let iters = 0;

      while (iters < 16) {
        const localTokPos = tokPos.slice();
        const peeked = streamSpecs.map(() => []);
        let cur = compiled.root;
        let ok = true;

        while (cur.kind === "peek" || cur.kind === "shift") {
          let tok = null;
          if (cur.p === regPort) {
            tok = regTags[regIdx];
          } else if (cur.p === guardAccPort) {
            if (cur.kind === "peek" && cur.depth === 0 && curGuardTag !== null) {
              tok = curGuardTag;
            } else {
              ok = false;
              break;
            }
          } else {
            const si = streamPorts.indexOf(cur.p);
            if (si < 0) { ok = false; break; }
            if (cur.kind === "shift") {
              if (peeked[si].length > 0) {
                tok = peeked[si].shift();
              } else {
                const ent = decodeFromCompressedKey(keys[si], localTokPos[si], si);
                if (!ent) { ok = false; break; }
                localTokPos[si]++;
                tok = ent.tag;
              }
            } else {
              while (peeked[si].length <= cur.depth) {
                const ent = decodeFromCompressedKey(keys[si], localTokPos[si], si);
                if (!ent) { ok = false; break; }
                localTokPos[si]++;
                peeked[si].push(ent.tag);
              }
              if (!ok) break;
              tok = peeked[si][cur.depth];
            }
          }
          const next = cur.cases[tok];
          if (!next) { ok = false; break; }
          cur = next;
        }

        if (!ok || cur.kind !== "loop") break;

        let cleanLoop = cur.drainOncePorts.length === 0;
        for (let si = 0; si < streamPorts.length && cleanLoop; si++) {
          const p = streamPorts[si];
          const ne = cur.nextExprs[p];
          if (ne.kind !== "splice" || (ne.newPrefix && ne.newPrefix.length > 0) || (ne.unconsumed && ne.unconsumed.length > 0)) {
            cleanLoop = false;
          }
        }
        if (!cleanLoop) break;

        let nextRegIdx = regIdx;
        if (regPort >= 0) {
          const re = cur.nextExprs[regPort];
          if (re.kind === "const" && re.tokens.length === 1) {
            nextRegIdx = regTagToIdx.get(re.tokens[0]);
            if (nextRegIdx === undefined) break;
          } else if (
            re.kind === "splice" &&
            re.p === regPort &&
            re.consumeCount === 0 &&
            (!re.newPrefix || re.newPrefix.length === 0)
          ) {
            nextRegIdx = regIdx;
          } else {
            break;
          }
        }

        const iterEmitEntries = [];
        let iterBits = 0;
        let nextGuardTag = curGuardTag;
        if (accSpec) {
          const ae = cur.nextExprs[accSpec.p];
          if (ae.kind !== "splice" || ae.consumeCount !== (ae.unconsumed?.length || 0)) break;
          if (ae.newPrefix) {
            for (const t of ae.newPrefix) {
              const ent = accSpec.tbl.byTag.get(t);
              if (!ent || ent.target !== accSpec.leaf.nodeId) { cleanLoop = false; break; }
              iterEmitEntries.push(ent);
              iterBits += ent.width;
            }
            if (guardAccPort >= 0 && ae.newPrefix.length > 0) {
              nextGuardTag = ae.newPrefix[0];
            }
          }
        }
        if (!cleanLoop || emitBitsTotal + iterBits > 24) break;

        for (let si = 0; si < streamPorts.length; si++) tokPos[si] = localTokPos[si];
        regIdx = nextRegIdx;
        curGuardTag = nextGuardTag;
        for (let i = iterEmitEntries.length - 1; i >= 0; i--) emitTokens.push(iterEmitEntries[i]);
        emitBitsTotal += iterBits;
        iters++;

        if (tokPos.every((v) => v === 0)) break;
      }

      let emitCode = 0;
      for (let i = emitTokens.length - 1; i >= 0; i--) {
        const ent = emitTokens[i];
        emitCode = ((emitCode << ent.width) | ent.code) >>> 0;
      }

      return {
        iters,
        consumeBits: tokPos.map((nTok, si) => nTok * streamSpecs[si].tbl.maxWidth),
        emitCode,
        emitBits: emitBitsTotal,
        nextReg: regIdx,
        finalGuardTag: curGuardTag
      };
    };

    // Guard discovery for peek-guarded accumulators + sub-token prefix guard!
    let guardValidTags = null;
    let guardPrefix = null;
    let repGuardTag = null;
    if (guardAccPort >= 0) {
      if (streamPorts.length !== 1) return null;
      const candidateTags = [];
      for (const [tag, ent] of accSpec.tbl.byTag.entries()) {
        if (ent.target === accSpec.leaf.nodeId) candidateTags.push(tag);
      }
      if (candidateTags.length === 0) return null;

      const valid = [];
      let refSig = null;
      const producedGuardTags = new Set();
      const kSpan = 1 << extractors[0].keyBits;
      for (const tag of candidateTags) {
        let anyActive = false;
        const sigParts = [];
        for (let r = 0; r < R; r++) {
          for (let k0 = 0; k0 < kSpan; k0++) {
            const s = runCompressedSim(r, [k0], tag);
            if (s.iters > 0) {
              anyActive = true;
              producedGuardTags.add(s.finalGuardTag);
            }
            sigParts.push(`${s.iters}:${s.consumeBits[0]}:${s.emitBits}:${s.emitCode}:${s.nextReg}`);
          }
        }
        if (!anyActive) continue;
        const sig = sigParts.join("|");
        if (refSig === null) { refSig = sig; valid.push(tag); }
        else if (sig === refSig) valid.push(tag);
      }
      if (valid.length === 0) return null;
      const validSet = new Set(valid);
      for (const pt of producedGuardTags) if (!validSet.has(pt)) return null;
      guardValidTags = validSet;
      guardPrefix = findSubTokenPrefixGuard(accSpec.tbl, validSet);
      repGuardTag = valid[0];
    }

    if (streamPorts.length === 1) {
      const ext0 = extractors[0];
      const keyBits0 = ext0.keyBits;
      const tableSize = R << keyBits0;
      const tblIters = new Uint8Array(tableSize);
      const tblConsume0 = new Uint8Array(tableSize);
      const tblEmitBits = new Uint8Array(tableSize);
      const tblEmitCode = new Uint32Array(tableSize);
      const tblNextReg = new Uint8Array(tableSize);

      let activeEntries = 0;
      let sumIters = 0;
      let maxIters = 0;
      let maxConsumeBits = 0;
      for (let r = 0; r < R; r++) {
        for (let k0 = 0; k0 < (1 << keyBits0); k0++) {
          const idx = (r << keyBits0) | k0;
          const sim = runCompressedSim(r, [k0], repGuardTag);
          tblIters[idx] = sim.iters;
          tblConsume0[idx] = sim.consumeBits[0];
          tblEmitBits[idx] = sim.emitBits;
          tblEmitCode[idx] = sim.emitCode;
          tblNextReg[idx] = sim.nextReg;
          if (sim.iters > 0) {
            activeEntries++;
            sumIters += sim.iters;
            if (sim.iters > maxIters) maxIters = sim.iters;
            if (sim.consumeBits[0] > maxConsumeBits) maxConsumeBits = sim.consumeBits[0];
          }
        }
      }
      if (maxIters === 0) return null;

      return {
        kind: "loop",
        arity: 1,
        name: compiled.name,
        W_raw0: ext0.W_raw,
        keyBits0,
        unitMask0: ext0.unitMask,
        kBitsPerTok0: ext0.kBitsPerTok,
        rawBitsPerTok0: ext0.w,
        extract0: ext0.extract,
        canPadTail0: streamSpecs[0].tbl.hasInvalidAllOnes,
        R,
        tableSize,
        activeEntries,
        avgIters: sumIters / activeEntries,
        maxIters,
        maxConsumeBits,
        regPort,
        regTags,
        regTagToIdx,
        streamPort0: streamPorts[0],
        accPort: accSpec ? accSpec.p : -1,
        guardValidTags,
        guardPrefix,
        tblIters,
        tblConsume0,
        tblEmitBits,
        tblEmitCode,
        tblNextReg
      };
    } else {
      const [ext0, ext1] = extractors;
      const keyBits0 = ext0.keyBits;
      const keyBits1 = ext1.keyBits;
      const totalKeyBits = keyBits0 + keyBits1;
      const tableSize = R << totalKeyBits;
      const tblIters = new Uint8Array(tableSize);
      const tblConsume0 = new Uint8Array(tableSize);
      const tblConsume1 = new Uint8Array(tableSize);
      const tblEmitBits = new Uint8Array(tableSize);
      const tblEmitCode = new Uint32Array(tableSize);
      const tblNextReg = new Uint8Array(tableSize);

      let activeEntries = 0;
      let sumIters = 0;
      let maxIters = 0;
      let maxConsumeBits = 0;
      for (let r = 0; r < R; r++) {
        for (let k0 = 0; k0 < (1 << keyBits0); k0++) {
          for (let k1 = 0; k1 < (1 << keyBits1); k1++) {
            const idx = (r << totalKeyBits) | (k0 << keyBits1) | k1;
            const sim = runCompressedSim(r, [k0, k1], repGuardTag);
            tblIters[idx] = sim.iters;
            tblConsume0[idx] = sim.consumeBits[0];
            tblConsume1[idx] = sim.consumeBits[1];
            tblEmitBits[idx] = sim.emitBits;
            tblEmitCode[idx] = sim.emitCode;
            tblNextReg[idx] = sim.nextReg;
            if (sim.iters > 0) {
              activeEntries++;
              sumIters += sim.iters;
              if (sim.iters > maxIters) maxIters = sim.iters;
              const totC = sim.consumeBits[0] + sim.consumeBits[1];
              if (totC > maxConsumeBits) maxConsumeBits = totC;
            }
          }
        }
      }
      if (maxIters === 0) return null;

      return {
        kind: "loop",
        arity: 2,
        name: compiled.name,
        W_raw0: ext0.W_raw,
        W_raw1: ext1.W_raw,
        keyBits0,
        keyBits1,
        totalKeyBits,
        unitMask0: ext0.unitMask,
        unitMask1: ext1.unitMask,
        kBitsPerTok0: ext0.kBitsPerTok,
        kBitsPerTok1: ext1.kBitsPerTok,
        rawBitsPerTok0: ext0.w,
        rawBitsPerTok1: ext1.w,
        extract0: ext0.extract,
        extract1: ext1.extract,
        canPadTail0: streamSpecs[0].tbl.hasInvalidAllOnes,
        canPadTail1: streamSpecs[1].tbl.hasInvalidAllOnes,
        R,
        tableSize,
        activeEntries,
        avgIters: sumIters / activeEntries,
        maxIters,
        maxConsumeBits,
        regPort,
        regTags,
        regTagToIdx,
        streamPort0: streamPorts[0],
        streamPort1: streamPorts[1],
        accPort: accSpec ? accSpec.p : -1,
        guardValidTags,
        guardPrefix,
        tblIters,
        tblConsume0,
        tblConsume1,
        tblEmitBits,
        tblEmitCode,
        tblNextReg
      };
    }
  }

  // =========================================================================
  // 2. FSM Variable-Width Bit-Chunk Compiler
  //    (Mode A: Don't-Care Compressed Chains; Mode B: Heterogeneous Multi-Schema)
  // =========================================================================

  _trySynthesizeFsm(compiled) {
    if (compiled.inCount !== 1) return null;
    if (!compiled.root || compiled.root.kind !== "shift" || compiled.root.p !== 0) return null;

    const bp = this.compilerV3.registry.getBlueprint(compiled.relHash);
    const leaf0 = compiled.inLeaves[0];
    const rootNodeId = leaf0.nodeId;
    const rootTbl = this.codec.getNodeTable(bp.inPlist, rootNodeId);
    if (!rootTbl || rootTbl.maxWidth === 0) return null;

    // Require at least depth >= 2 `shift` steps on port 0 (otherwise a 1-tag shift is already optimal!)
    let hasDepth2 = false;
    for (const child of Object.values(compiled.root.cases)) {
      if (child && child.kind === "shift" && child.p === 0) {
        hasDepth2 = true;
        break;
      }
    }
    if (!hasDepth2) return null;

    // --- Mode A: Homogeneous Don't-Care Compressed FSM Chain (e.g. `_classify_bits`, `_drop16`, `_drop4`, `_drop2`) ---
    const unitMask = analyzePortUnitMask(compiled, bp, rootTbl, rootNodeId, 0, false);
    if (unitMask < (1 << rootTbl.maxWidth)) {
      const res = this._synthesizeCompressedFsm(compiled, bp, rootNodeId, rootTbl, unitMask);
      if (res) return res;
    }

    // --- Mode B: General Heterogeneous Multi-Schema Raw `k-wire` Bit-Chunk FSM (e.g. `1b + 2b×k`, `3b + 7×1b = 10b`!) ---
    return this._synthesizeHeterogeneousFsm(compiled, bp, rootNodeId);
  }

  _synthesizeCompressedFsm(compiled, bp, selfNodeId, tbl, unitMask) {
    const maskedTbl = buildMaskedTokenTable(tbl, bp.inPlist, selfNodeId, unitMask);
    const w = tbl.maxWidth;

    // Find max consecutive `shift(0)` depth along self-recursive edges from `root`
    const depthMemo = new Map();
    const maxShiftDepth = (d) => {
      if (!d || d.kind !== "shift" || d.p !== 0) return 0;
      if (depthMemo.has(d.id)) return depthMemo.get(d.id);
      let best = 0;
      for (let mk = 0; mk < maskedTbl.classRep.length; mk++) {
        const rep = maskedTbl.classRep[mk];
        if (!rep) continue;
        const c = d.cases[rep.tag];
        const sub = 1 + maxShiftDepth(c);
        if (sub > best) best = sub;
      }
      depthMemo.set(d.id, best);
      return best;
    };
    const chainDepth = maxShiftDepth(compiled.root);
    if (chainDepth < 2) return null;

    const maxToksByRaw = Math.floor(16 / w);
    const maxToksByKey = Math.floor(Math.min(8, this.maxKeyBits) / maskedTbl.kBits);
    const numTokens = Math.max(2, Math.min(chainDepth, maxToksByRaw, maxToksByKey));
    const ext = buildBitExtractor(w, unitMask, numTokens);
    const keySpan = 1 << ext.keyBits;

    // BFS over reachable chunk-entry `dnode`s
    const entryStates = [];
    const dnodeToEntryIdx = new Map();
    const enqueue = (d) => {
      if (!d || d.kind !== "shift" || d.p !== 0) return;
      if (dnodeToEntryIdx.has(d.id)) return;
      if (entryStates.length >= this.maxFsmChunkStates) return;
      dnodeToEntryIdx.set(d.id, entryStates.length);
      entryStates.push(d);
    };
    enqueue(compiled.root);

    const perStateTables = [];
    let maxConsumeBits = 0;
    let maxTokensPerStep = 0;

    for (let si = 0; si < entryStates.length; si++) {
      const startD = entryStates[si];
      const tblConsume = new Uint8Array(keySpan);
      const tblTokens = new Uint8Array(keySpan);
      const tblNextDNode = new Array(keySpan);

      for (let key = 0; key < keySpan; key++) {
        let curD = startD;
        let toks = 0;
        for (let j = 0; j < numTokens; j++) {
          if (!curD || curD.kind !== "shift" || curD.p !== 0) break;
          const shift = (numTokens - 1 - j) * ext.kBitsPerTok;
          const mk = (key >>> shift) & ((1 << ext.kBitsPerTok) - 1);
          const rep = maskedTbl.classRep[mk];
          if (!rep) break;
          const nextD = curD.cases[rep.tag];
          if (!nextD) break;
          curD = nextD;
          toks++;
        }
        const cBits = toks * w;
        tblConsume[key] = cBits;
        tblTokens[key] = toks;
        tblNextDNode[key] = curD;
        if (cBits > maxConsumeBits) maxConsumeBits = cBits;
        if (toks > maxTokensPerStep) maxTokensPerStep = toks;
        // Enqueue continuation state if we consumed a full chunk and still have >= 2 shifts left!
        if (toks === numTokens && curD && curD.kind === "shift" && curD.p === 0 && maxShiftDepth(curD) >= 2) {
          enqueue(curD);
        }
      }
      perStateTables.push({ startD, tblConsume, tblTokens, tblNextDNode });
    }

    if (maxTokensPerStep < 2) return null;

    const stateByDNodeId = new Map();
    for (let i = 0; i < perStateTables.length; i++) {
      stateByDNodeId.set(perStateTables[i].startD.id, perStateTables[i]);
    }

    return {
      kind: "fsm",
      fsmMode: "dont-care",
      name: compiled.name,
      W_raw0: ext.W_raw,
      keyBits0: ext.keyBits,
      unitMask0: ext.unitMask,
      kBitsPerTok0: ext.kBitsPerTok,
      rawBitsPerTok0: w,
      extract0: ext.extract,
      canPadTail0: tbl.hasInvalidAllOnes,
      numChunkStates: perStateTables.length,
      tableSize: perStateTables.length * keySpan,
      maxTokensPerStep,
      maxConsumeBits,
      stateByDNodeId
    };
  }

  _synthesizeHeterogeneousFsm(compiled, bp, rootNodeId) {
    const W_raw = 8; // 8-bit raw `k-wire` chunk (256 entries per reachable `(dnode, schemaNode)` state)
    const keySpan = 1 << W_raw;

    const entryStates = [];
    const keyToEntryIdx = new Map();
    const enqueue = (d, u) => {
      if (!d || d.kind !== "shift" || d.p !== 0) return;
      const k = `${d.id}:${u}`;
      if (keyToEntryIdx.has(k)) return;
      if (entryStates.length >= this.maxFsmChunkStates) return;
      keyToEntryIdx.set(k, entryStates.length);
      entryStates.push({ d, u, key: k });
    };
    enqueue(compiled.root, rootNodeId);

    const perStateTables = [];
    let maxTokensPerStep = 0;
    let maxConsumeBits = 0;
    const distinctWidths = new Set();

    for (let si = 0; si < entryStates.length; si++) {
      const { d: startD, u: startU } = entryStates[si];
      const tblConsume = new Uint8Array(keySpan);
      const tblTokens = new Uint8Array(keySpan);
      const tblNextDNode = new Array(keySpan);
      const tblNextSchema = new Int32Array(keySpan);

      for (let win = 0; win < keySpan; win++) {
        let curD = startD;
        let curU = startU;
        let bitPos = 0;
        let toks = 0;
        const stack = [startU]; // handle nested closed-product fields automatically!

        // Drain any closed-product wrappers on `stack` to reach the next union schema node
        const advanceToUnion = () => {
          while (stack.length > 0) {
            const top = stack[stack.length - 1];
            const node = bp.inPlist[top];
            if (!node) return -1;
            if (node[0] === "closed-product") {
              stack.pop();
              const edges = node[1];
              for (let i = edges.length - 1; i >= 0; i--) stack.push(edges[i][1]);
            } else {
              return top;
            }
          }
          return -1;
        };

        while (curD && curD.kind === "shift" && curD.p === 0) {
          const uNode = advanceToUnion();
          if (uNode < 0) break;
          const tbl = this.codec.getNodeTable(bp.inPlist, uNode);
          if (!tbl || tbl.maxWidth === 0) break;
          if (bitPos + tbl.maxWidth > W_raw) break; // stops cleanly at variable bitPos ∈ 1..W_raw!
          const code = (win >>> (W_raw - bitPos - tbl.maxWidth)) & ((1 << tbl.maxWidth) - 1);
          const ent = tbl.decodeTable[code];
          if (!ent) break;
          const nextD = curD.cases[ent.tag];
          if (!nextD) break;
          stack.pop();
          stack.push(ent.target);
          bitPos += ent.width;
          curD = nextD;
          toks++;
          curU = advanceToUnion();
        }

        tblConsume[win] = bitPos;
        tblTokens[win] = toks;
        tblNextDNode[win] = curD;
        tblNextSchema[win] = curU;
        if (bitPos > 0) distinctWidths.add(bitPos);
        if (bitPos > maxConsumeBits) maxConsumeBits = bitPos;
        if (toks > maxTokensPerStep) maxTokensPerStep = toks;
        if (bitPos > 0 && curD && curD.kind === "shift" && curD.p === 0 && curU >= 0 && stack.length <= 1) {
          enqueue(curD, curU);
        }
      }

      perStateTables.push({ startD, startU, tblConsume, tblTokens, tblNextDNode, tblNextSchema });
    }

    if (maxTokensPerStep < 2) return null;

    const stateByDNodeId = new Map();
    for (const st of perStateTables) {
      // Key by `d.id` (for tree/product schemas where each `d.id` has unique schema)
      if (!stateByDNodeId.has(st.startD.id)) stateByDNodeId.set(st.startD.id, st);
    }

    return {
      kind: "fsm",
      fsmMode: "heterogeneous",
      name: compiled.name,
      W_raw0: W_raw,
      keyBits0: W_raw,
      unitMask0: 0xff,
      extract0: (v) => v,
      canPadTail0: false,
      numChunkStates: perStateTables.length,
      tableSize: perStateTables.length * keySpan,
      maxTokensPerStep,
      maxConsumeBits,
      distinctWidths: [...distinctWidths].sort((a, b) => a - b),
      stateByDNodeId
    };
  }

  // =========================================================================
  // 3. MWTR Speed Evaluation & Memory-Budgeted Symbol-Size Selection
  //    (Directly applying `DOCS/speed-eval.pdf` Section 2-3 + Howard's MWTR!)
  // =========================================================================

  /**
   * Exact typed-array memory footprint (in bytes) of a synthesized chunk table.
   */
  getTableMemoryBytes(tbl) {
    if (!tbl) return 0;
    if (tbl.kind === "loop") {
      // 1-stream: tblIters(1) + tblConsume0(1) + tblEmitBits(1) + tblEmitCode(4) + tblNextReg(1) = 8 B/entry
      // 2-stream: + tblConsume1(1) = 9 B/entry
      const bytesPerEntry = tbl.arity === 1 ? 8 : 9;
      return tbl.tableSize * bytesPerEntry;
    }
    // FSM chunk table: tblConsume(1) + tblTokens(1) + nextStateIdx(2) [+ nextSchema(2)]
    const bytesPerEntry = tbl.fsmMode === "heterogeneous" ? 6 : 4;
    return tbl.tableSize * bytesPerEntry;
  }

  /**
   * Build the exact weighted directed graph G = (V, E, w, t) from `DOCS/speed-eval.pdf`
   * for a compiled transducer at either:
   *   - `chunkTbl === null` (base V3 1-token DAG), OR
   *   - any synthesized `chunkTbl` (`kind === "loop"` or `kind === "fsm"`).
   *
   * Returns BOTH:
   *   - `rhoStream`: exact worst-case throughput (k-wire bits / lookup) over streaming
   *     loops (for `LOOP`s) or full input paths (for acyclic `FSM`s), and
   *   - `rhoAll`: exact worst-case throughput WITH the `(v_f -> v_s, 0, 0)` feedback edge
   *     from Section 3 of `speed-eval.pdf` (including shortest exit/empty-input paths!).
   */
  evaluateThroughput(compiled, chunkTbl = null) {
    const bp = this.compilerV3.registry.getBlueprint(compiled.relHash);

    if (!chunkTbl) {
      // --- Base V3 1-token DAG graph ---
      const idToIdx = new Map();
      const idxToLabel = [];
      const getIdx = (key, label) => {
        if (!idToIdx.has(key)) {
          idToIdx.set(key, idxToLabel.length);
          idxToLabel.push(label);
        }
        return idToIdx.get(key);
      };

      const startIdx = getIdx(`D${compiled.root.id}`, `root`);
      const finalIdx = getIdx("FINAL", "v_f");
      const edges = [];
      const seen = new Set();
      const regSet = new Set(compiled.registerPorts);

      const walk = (d, peekConsumed) => {
        const key = `${d.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        const u = getIdx(`D${d.id}`, `${d.kind}(${d.id})`);
        if (d.kind === "fail") return;

        if (d.kind === "loop") {
          // Account for any net tokens consumed via PEEK (e.g., `lsb_shl`, `_half_max_tally`)
          let peekBits = 0;
          for (let p = 0; p < compiled.inCount; p++) {
            const ne = d.nextExprs[p];
            if (ne.kind === "splice") {
              const netToks = ne.consumeCount - (ne.unconsumed?.length || 0);
              if (netToks > 0 && peekConsumed[p]) {
                const leaf = compiled.inLeaves[p];
                const tbl = this.codec.getNodeTable(bp.inPlist, leaf.nodeId);
                if (tbl) peekBits += netToks * tbl.maxWidth;
              }
            }
          }
          edges.push({ from: u, to: startIdx, w: peekBits, t: 0, label: "loop_back" });
          return;
        }

        if (d.kind === "emit") {
          let peekBits = 0;
          for (let p = 0; p < compiled.inCount; p++) {
            if (peekConsumed[p]) {
              const leaf = compiled.inLeaves[p];
              const tbl = this.codec.getNodeTable(bp.inPlist, leaf.nodeId);
              if (tbl) peekBits += peekConsumed[p] * tbl.maxWidth;
            }
          }
          edges.push({ from: u, to: finalIdx, w: peekBits, t: 0, label: "exit" });
          return;
        }

        if (d.kind === "shift" || d.kind === "peek") {
          const leaf = compiled.inLeaves[d.p];
          const tbl = this.codec.getNodeTable(bp.inPlist, leaf.nodeId);
          const bitW = tbl ? tbl.maxWidth : 0;
          const isReg = regSet.has(d.p);
          for (const [tag, child] of Object.entries(d.cases)) {
            if (!child || child.kind === "fail") continue;
            const v = getIdx(`D${child.id}`, `${child.kind}(${child.id})`);
            const wEdge = d.kind === "shift" && !isReg ? bitW : 0;
            const tEdge = isReg ? 0 : 1; // 1 memory access per input stream read (registers are in-CPU!)
            edges.push({ from: u, to: v, w: wEdge, t: tEdge, label: `${d.kind}(p${d.p}=${tag})` });
            const nextPeek = peekConsumed.slice();
            if (d.kind === "peek" && !isReg) nextPeek[d.p] = Math.max(nextPeek[d.p], d.depth + 1);
            walk(child, nextPeek);
          }
        }
      };

      walk(compiled.root, new Array(compiled.inCount).fill(0));
      const numNodes = idxToLabel.length;
      const streamRes = compiled.isLoop
        ? computeMWTR(numNodes, edges)
        : computeMWTR(numNodes, [...edges, { from: finalIdx, to: startIdx, w: 0, t: 0, label: "vf->vs" }]);
      const allRes = computeMWTR(numNodes, [...edges, { from: finalIdx, to: startIdx, w: 0, t: 0, label: "vf->vs" }]);
      return {
        rhoStream: streamRes.rho,
        rhoAll: allRes.rho,
        memoryBytes: 0,
        streamCycle: streamRes.cycleNodes.map((i) => idxToLabel[i]),
        howardIters: allRes.iterations
      };
    }

    if (chunkTbl.kind === "loop") {
      // --- Chunk-Compiled LOOP graph: vertices = register states `0..R-1`, plus `v_f = R` ---
      const R = chunkTbl.R;
      const finalIdx = R;
      const edges = [];
      const dedup = new Set();
      const addEdge = (from, to, w, t, label) => {
        const k = `${from}:${to}:${w}:${t}`;
        if (dedup.has(k)) return;
        dedup.add(k);
        edges.push({ from, to, w, t, label });
      };

      if (chunkTbl.arity === 1) {
        const kSpan = 1 << chunkTbl.keyBits0;
        const maxKey = kSpan - 1;
        // Identify full-continuing keys (where all `numTokens` tokens were self-recursive -> full chunk!)
        // In our table, full-chunk transitions are those with `tblConsume0[idx] === maxConsumeBits`
        // (and any other continuing key whose window wasn't truncated by a terminator!)
        // Wait: in `speed-eval.pdf`, an adversarial streaming input can stay inside ANY full-chunk
        // transition indefinitely! A key that stops early ONLY happens when `"_"` appears (which exits to `v_f`!).
        for (let r = 0; r < R; r++) {
          for (let k0 = 0; k0 < kSpan; k0++) {
            const idx = (r << chunkTbl.keyBits0) | k0;
            const c0 = chunkTbl.tblConsume0[idx];
            if (c0 === 0) {
              // Terminator at position 0 -> exit path to `v_f` (1 lookup, consumes 1 token)
              addEdge(r, finalIdx, chunkTbl.rawBitsPerTok0, 1, "exit0");
            } else if (c0 === chunkTbl.W_raw0) {
              // Full-window continuing chunk -> stays in streaming loop!
              addEdge(r, chunkTbl.tblNextReg[idx], c0, 1, `chunk(${c0}b)`);
            } else {
              // Partial chunk before terminator -> consumes `c0` in 1 lookup, then 1 exit lookup!
              addEdge(r, finalIdx, c0 + chunkTbl.rawBitsPerTok0, 2, `tail(${c0}b)+exit`);
            }
          }
        }
      } else {
        const k0Span = 1 << chunkTbl.keyBits0;
        const k1Span = 1 << chunkTbl.keyBits1;
        for (let r = 0; r < R; r++) {
          for (let k0 = 0; k0 < k0Span; k0++) {
            for (let k1 = 0; k1 < k1Span; k1++) {
              const idx = (r << chunkTbl.totalKeyBits) | (k0 << chunkTbl.keyBits1) | k1;
              const c0 = chunkTbl.tblConsume0[idx];
              const c1 = chunkTbl.tblConsume1[idx];
              const cTot = c0 + c1;
              if (cTot === 0) {
                addEdge(r, finalIdx, chunkTbl.rawBitsPerTok0 + chunkTbl.rawBitsPerTok1, 2, "exit0");
              } else if (c0 === chunkTbl.W_raw0 && c1 === chunkTbl.W_raw1) {
                addEdge(r, chunkTbl.tblNextReg[idx], cTot, 1, `chunk(${c0}+${c1}b)`);
              } else if (cTot === chunkTbl.maxConsumeBits) {
                // E.g. `_half_max_tally` (2 tokens/iter * 3 iters = 12b + 12b = 24b, full window!)
                addEdge(r, chunkTbl.tblNextReg[idx], cTot, 1, `chunk(${c0}+${c1}b)`);
              } else {
                addEdge(r, finalIdx, cTot + chunkTbl.rawBitsPerTok0, 2, `tail(${cTot}b)+exit`);
              }
            }
          }
        }
      }

      const numNodes = R + 1;
      const streamRes = computeMWTR(numNodes, edges);
      const allEdges = [...edges, { from: finalIdx, to: 0, w: 0, t: 0, label: "vf->vs" }];
      const allRes = computeMWTR(numNodes, allEdges);
      return {
        rhoStream: streamRes.rho,
        rhoAll: allRes.rho,
        memoryBytes: this.getTableMemoryBytes(chunkTbl),
        streamCycle: streamRes.cycleNodes.map((i) => (i < R ? `r=${chunkTbl.regTags[i] ?? 0}` : "v_f")),
        howardIters: streamRes.iterations
      };
    }

    // --- Chunk-Compiled FSM graph ---
    const idToIdx = new Map();
    const idxToLabel = [];
    const getIdx = (key, label) => {
      if (!idToIdx.has(key)) {
        idToIdx.set(key, idxToLabel.length);
        idxToLabel.push(label);
      }
      return idToIdx.get(key);
    };
    const startIdx = getIdx(`D${compiled.root.id}`, "root");
    const finalIdx = getIdx("FINAL", "v_f");
    const edges = [];
    const dedup = new Set();
    const addEdge = (from, to, w, t, label) => {
      const k = `${from}:${to}:${w}:${t}`;
      if (dedup.has(k)) return;
      dedup.add(k);
      edges.push({ from, to, w, t, label });
    };

    const visitedD = new Set();
    const walkFsm = (d) => {
      if (!d || visitedD.has(d.id)) return;
      visitedD.add(d.id);
      const u = getIdx(`D${d.id}`, `D${d.id}`);
      if (d.kind === "fail") return;
      if (d.kind === "emit") {
        addEdge(u, finalIdx, 0, 0, "emit");
        return;
      }
      const chunkSt = chunkTbl.stateByDNodeId.get(d.id);
      if (chunkSt) {
        const keySpan = 1 << chunkTbl.keyBits0;
        let hasZeroFallback = false;
        for (let k = 0; k < keySpan; k++) {
          const c = chunkSt.tblConsume[k];
          const nxt = chunkSt.tblNextDNode[k];
          if (c > 0 && nxt && nxt.kind !== "fail") {
            const v = getIdx(`D${nxt.id}`, `D${nxt.id}`);
            addEdge(u, v, c, 1, `chunk(${c}b)`);
            walkFsm(nxt);
          } else if (c === 0) {
            hasZeroFallback = true;
          }
        }
        if (hasZeroFallback && d.cases) {
          const tbl = this.codec.getNodeTable(bp.inPlist, compiled.inLeaves[0].nodeId);
          const bitW = tbl ? tbl.maxWidth : 2;
          for (const [tag, child] of Object.entries(d.cases)) {
            if (!child || child.kind === "fail") continue;
            if (child.kind === "emit") {
              const v = getIdx(`D${child.id}`, `D${child.id}`);
              addEdge(u, v, bitW, 1, `exit(${tag})`);
              walkFsm(child);
            }
          }
        }
      } else if (d.kind === "shift" || d.kind === "peek") {
        const tbl = this.codec.getNodeTable(bp.inPlist, compiled.inLeaves[d.p].nodeId);
        const bitW = tbl ? tbl.maxWidth : 2;
        for (const [tag, child] of Object.entries(d.cases)) {
          if (!child || child.kind === "fail") continue;
          const v = getIdx(`D${child.id}`, `D${child.id}`);
          addEdge(u, v, d.kind === "shift" ? bitW : 0, 1, `${d.kind}(${tag})`);
          walkFsm(child);
        }
      }
    };
    walkFsm(compiled.root);

    // Measure BOTH full-length chunk throughput (excluding immediate early-exit edges on short inputs,
    // matching `speed-eval.pdf` p. 4 minimum packet length filtering) AND global `rhoAll`!
    const allEdges = [...edges, { from: finalIdx, to: startIdx, w: 0, t: 0, label: "vf->vs" }];
    const allRes = computeMWTR(idxToLabel.length, allEdges);

    // Build full-depth subgraph: keep only maximal-chunk transitions from chunk states (so `_classify_bits`
    // evaluates its full 18-token path `16b + 16b + 4b = 36b / 3 reads = 12.0 b/rd`!)
    const fullEdges = [];
    const maxWByFrom = new Map();
    for (const e of edges) {
      if (e.label.startsWith("chunk(")) {
        const prev = maxWByFrom.get(e.from) || 0;
        if (e.w > prev) maxWByFrom.set(e.from, e.w);
      }
    }
    for (const e of edges) {
      if (e.label.startsWith("exit(")) continue;
      if (e.label.startsWith("chunk(") && e.w < maxWByFrom.get(e.from)) continue;
      fullEdges.push(e);
    }
    const fullRes = computeMWTR(idxToLabel.length, [...fullEdges, { from: finalIdx, to: startIdx, w: 0, t: 0, label: "vf->vs" }]);
    return {
      rhoStream: Number.isFinite(fullRes.rho) ? fullRes.rho : allRes.rho,
      rhoAll: allRes.rho,
      memoryBytes: this.getTableMemoryBytes(chunkTbl),
      streamCycle: fullRes.cycleNodes.map((i) => idxToLabel[i]),
      howardIters: allRes.iterations
    };
  }

  /**
   * Synthesize a chunk table at an explicit `maxKeyBits` cap (used to sweep candidate
   * symbol sizes along the Memory vs. Worst-Case Throughput Pareto frontier!).
   */
  synthesizeWithKeyCap(relHash, keyCap) {
    const compiled = this.compilerV3.getCompiled(relHash);
    if (!compiled) return null;
    if (keyCap === 0) return null;
    const saved = this.maxKeyBits;
    this.maxKeyBits = keyCap;
    try {
      return compiled.isLoop
        ? this._trySynthesizeLoop(compiled)
        : this._trySynthesizeFsm(compiled);
    } finally {
      this.maxKeyBits = saved;
    }
  }

  /**
   * MWTR-Guided Symbol-Size Selection under a Global Table Memory Budget `budgetBytes`.
   *
   * Directly implements the read-count vs. memory-footprint trade-off motivated by
   * `DOCS/speed-eval.pdf`:
   *   1. Starts every compiled transducer at base V3 (0 table bytes).
   *   2. Repeatedly identifies the transducer with the LOWEST current worst-case
   *      streaming throughput `rhoStream` (computed via Howard's MWTR algorithm!)
   *      and widens its `k-wire` chunk size to the next Pareto-improving level that
   *      fits in the remaining memory budget (breaking ties by highest `deltaRho / deltaBytes`).
   *   3. Installs the chosen optimal chunk tables into `this.cache` and returns a
   *      complete summary of the resulting Pareto point!
   */
  optimizeForMemoryBudget(relHashes, budgetBytes) {
    const entries = [];
    for (const relHash of relHashes) {
      const compiled = this.compilerV3.getCompiled(relHash);
      if (!compiled) continue;
      // Enumerate distinct Pareto-improving symbol-size candidates for this transducer
      const baseEval = this.evaluateThroughput(compiled, null);
      const candidates = [{ keyCap: 0, tbl: null, eval: baseEval }];
      const seenSigs = new Set([`0:${baseEval.rhoStream.toFixed(4)}`]);

      for (const cap of [2, 3, 4, 6, 8, 9, 10, 12]) {
        const tbl = this.synthesizeWithKeyCap(relHash, cap);
        if (!tbl) continue;
        const ev = this.evaluateThroughput(compiled, tbl);
        const sig = `${ev.memoryBytes}:${ev.rhoStream.toFixed(4)}`;
        if (seenSigs.has(sig)) continue;
        seenSigs.add(sig);
        // Keep strictly Pareto-improving candidates (higher rhoStream than previous!)
        const last = candidates[candidates.length - 1];
        if (ev.rhoStream > last.eval.rhoStream + 1e-6) {
          candidates.push({ keyCap: cap, tbl, eval: ev });
        }
      }

      if (candidates.length > 1) {
        entries.push({ relHash, compiled, candidates, chosenIdx: 0 });
      }
    }

    let usedBytes = 0;
    while (true) {
      // Find the lowest-throughput transducer(s) that still have an affordable upgrade
      let minRho = Infinity;
      for (const e of entries) {
        if (e.chosenIdx + 1 >= e.candidates.length) continue;
        const nextC = e.candidates[e.chosenIdx + 1];
        const curC = e.candidates[e.chosenIdx];
        const deltaBytes = nextC.eval.memoryBytes - curC.eval.memoryBytes;
        if (usedBytes + deltaBytes > budgetBytes) continue;
        const r = curC.eval.rhoStream;
        if (r < minRho) minRho = r;
      }
      if (!Number.isFinite(minRho)) break;

      // Among transducers tied at `minRho`, pick the one with highest `deltaRho / deltaBytes`!
      let bestEntry = null;
      let bestEfficiency = -1;
      for (const e of entries) {
        if (e.chosenIdx + 1 >= e.candidates.length) continue;
        const curC = e.candidates[e.chosenIdx];
        const nextC = e.candidates[e.chosenIdx + 1];
        const deltaBytes = nextC.eval.memoryBytes - curC.eval.memoryBytes;
        if (usedBytes + deltaBytes > budgetBytes) continue;
        if (Math.abs(curC.eval.rhoStream - minRho) > 1e-6) continue;
        const eff = (nextC.eval.rhoStream - curC.eval.rhoStream) / Math.max(1, deltaBytes);
        if (eff > bestEfficiency) {
          bestEfficiency = eff;
          bestEntry = e;
        }
      }
      if (!bestEntry) break;

      const curBytes = bestEntry.candidates[bestEntry.chosenIdx].eval.memoryBytes;
      bestEntry.chosenIdx++;
      const nextBytes = bestEntry.candidates[bestEntry.chosenIdx].eval.memoryBytes;
      usedBytes += nextBytes - curBytes;
    }

    // Install selected tables into cache
    for (const e of entries) {
      this.cache.set(e.relHash, e.candidates[e.chosenIdx].tbl);
    }

    const loopEntries = entries.filter((e) => e.compiled.isLoop);
    const worstLoopRho = loopEntries.length
      ? Math.min(...loopEntries.map((e) => e.candidates[e.chosenIdx].eval.rhoStream))
      : 0;
    const worstRho = Math.min(...entries.map((e) => e.candidates[e.chosenIdx].eval.rhoStream));
    const avgRho = entries.reduce((acc, e) => acc + e.candidates[e.chosenIdx].eval.rhoStream, 0) / entries.length;

    return {
      budgetBytes,
      usedBytes,
      worstLoopRho,
      worstRho,
      avgRho,
      selections: entries.map((e) => {
        const c = e.candidates[e.chosenIdx];
        return {
          name: e.compiled.name,
          kind: e.compiled.isLoop ? "LOOP" : "FSM",
          W_raw: c.tbl ? (c.tbl.arity === 2 ? `${c.tbl.W_raw0}b×${c.tbl.W_raw1}b` : `${c.tbl.W_raw0}b`) : "base",
          memoryBytes: c.eval.memoryBytes,
          rhoStream: c.eval.rhoStream,
          rhoAll: c.eval.rhoAll
        };
      })
    };
  }
}
