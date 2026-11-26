/**
 * KIR-P -> kTVM-P / concrete kTVM Lowering Compiler.
 *
 * Implements Milestone 2 (DOCS/KTVM_SPEC.md §11.1):
 *   - Consumes canonical `KIR-P` (`objectToKIRP(obj)`) or a `k-object` directly.
 *   - Lowers all 11 KIR-P expression ops (`identity`, `empty`, `filter`, `code`,
 *     `dot`, `div`, `vid`, `ref`, `comp`, `product`, `union`) plus identity
 *     intrinsics (`_log!`).
 *   - Performs:
 *       * Exact `KIR-P` pattern-graph unification against concrete closed `k-wire`
 *         envelopes (with `KTVMSchemaError` on structural contradiction and clean
 *         fallback signaling for non-converged recursive relations).
 *       * Product `demux`-hoisting & common leading `match /tag`-hoisting so
 *         K's let-free `{ .xs /cons .cdr ..., .xs /cons .car ... }` compiles into
 *         single-pass zero-tee streaming `kTVM` networks.
 *       * Leading-guard prefix-disjoint analysis routing disjoint `union`s to
 *         zero-buffering `switch` and overlapping/backtracking `union`s to `spec`.
 *       * Static `isBranchingRecursive` SCC analysis inserting `after %tok`
 *         sequential sibling settlement on branching tree recursion.
 *       * Static validation via `validateModule` (always-on).
 */

import codes from "../codes.mjs";
import { isIdentityIntrinsic, isIntrinsic, unsupportedIntrinsic } from "../intrinsics.mjs";
import { objectToKIRP, relationPatternPropertyList, retypeObjectRelationForBackend } from "../kir.mjs";
import { KTVMSchemaError, S, createModule } from "./ast.mjs";
import {
  canonicalizePlistOrder,
  compareLabels,
  isClosedPlist,
  mooreKey,
  mooreMinimize,
  plistToSchemaAst,
  productFieldInfo,
  productFields,
  schemasEquivalent,
  subPlist,
  unionTagInfo
} from "./schema.mjs";
import { validateModule } from "./validator.mjs";
import { executeKTVM, executeKTVMWire } from "./vm.mjs";
import { splitEnvelopedWire } from "./wire.mjs";

const UNIT_PLIST = [["closed-product", []]];

function sanitizeIdent(raw, fallback = "r") {
  const s = String(raw || "")
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+/, "");
  if (!s) return fallback;
  return /^[A-Za-z_]/.test(s) ? s.slice(0, 32) : `r_${s.slice(0, 30)}`;
}

function normalizeKIR(kirOrObject) {
  if (!kirOrObject || typeof kirOrObject !== "object") {
    throw new Error("kTVM lowering requires a KIR-P or k-object");
  }
  if (kirOrObject.format === "k-ir" && kirOrObject.layer === "KIR-P") {
    return { kir: kirOrObject, sourceObject: null };
  }
  if (kirOrObject.format === "k-object") {
    return { kir: objectToKIRP(kirOrObject), sourceObject: kirOrObject };
  }
  throw new Error(`Unsupported input format for kTVM lowering: '${kirOrObject.format}'`);
}

function makeCodeLookup(kir) {
  const table = kir.codes || {};
  return (hash) => {
    let cur = table[hash] || codes.find(hash);
    const seen = new Set([hash]);
    while (cur && cur.code === "ref" && cur.ref) {
      if (seen.has(cur.ref)) break;
      seen.add(cur.ref);
      cur = table[cur.ref] || codes.find(cur.ref);
    }
    return cur || null;
  };
}

function resolveRelHash(kir, name) {
  if (!name) return null;
  if (kir.rels?.[name]) return name;
  const alias = kir.relAlias?.[name];
  if (alias && kir.rels?.[alias]) return alias;
  if (alias) {
    for (const k of Object.keys(kir.rels || {})) {
      if (kir.relAlias?.[k] === alias) return k;
    }
  }
  return null;
}

function buildDisplayNameMap(kir) {
  const map = new Map();
  for (const [alias, hash] of Object.entries(kir.relAlias || {})) {
    if (!map.has(hash)) map.set(hash, alias);
  }
  return map;
}

// --- Code Hash -> Closed Property-List Graph ---

function codeHashToPlist(codeHash, findCode) {
  const nodes = [];
  const memo = new Map();

  function visit(h) {
    let def = findCode(h);
    if (!def) {
      throw new KTVMSchemaError(`Unknown K code hash '${h}'`);
    }
    if (memo.has(h)) return memo.get(h);
    const id = nodes.length;
    memo.set(h, id);
    const slot = [def.code === "product" ? "closed-product" : "closed-union", []];
    nodes.push(slot);
    const edgeObj = def[def.code] || {};
    const labels = Object.keys(edgeObj).sort(compareLabels);
    slot[1] = labels.map((l) => [l, visit(edgeObj[l])]);
    return id;
  }

  visit(codeHash);
  return mooreMinimize(canonicalizePlistOrder(nodes, 0), 0).plist;
}

// --- Mutable Local Pattern Graph for KIR-P Relation Unification ---

class LocalPatternGraph {
  constructor(kirPatternGraph, findCode) {
    this.findCode = findCode;
    this.nodes = []; // { kind, edges: Map<label, targetId> }
    this.parent = []; // union-find parent (-1 if root)
    this.kirIdToLocal = new Map();
    this.codeMemo = new Map();

    const kirNodes = kirPatternGraph?.nodes || [];
    for (const kn of kirNodes) {
      const id = this._newNode("any");
      this.kirIdToLocal.set(kn.id, id);
    }

    for (const kn of kirNodes) {
      const id = this.kirIdToLocal.get(kn.id);
      const node = this.nodes[id];
      if (kn.kind === "type") {
        const def = findCode(kn.code);
        if (!def) {
          throw new KTVMSchemaError(`KIR type node '${kn.code}' missing code definition`);
        }
        node.kind = def.code === "product" ? "closed-product" : "closed-union";
        if (kn.edges && kn.edges.length > 0) {
          for (const e of kn.edges) {
            node.edges.set(e.label, this.kirIdToLocal.get(e.target));
          }
        } else {
          // Expand edges directly from code definition
          this.codeMemo.set(kn.code, id);
          const edgeObj = def[def.code] || {};
          for (const l of Object.keys(edgeObj).sort(compareLabels)) {
            node.edges.set(l, this._importCode(edgeObj[l]));
          }
        }
      } else {
        node.kind = kn.kind;
        for (const e of kn.edges || []) {
          node.edges.set(e.label, this.kirIdToLocal.get(e.target));
        }
      }
    }
  }

  _newNode(kind) {
    const id = this.nodes.length;
    this.nodes.push({ kind, edges: new Map() });
    this.parent.push(-1);
    return id;
  }

  _importCode(codeHash) {
    if (this.codeMemo.has(codeHash)) return this.codeMemo.get(codeHash);
    const def = this.findCode(codeHash);
    if (!def) throw new KTVMSchemaError(`Unknown code hash '${codeHash}'`);
    const kind = def.code === "product" ? "closed-product" : "closed-union";
    const id = this._newNode(kind);
    this.codeMemo.set(codeHash, id);
    const edgeObj = def[def.code] || {};
    for (const l of Object.keys(edgeObj).sort(compareLabels)) {
      this.nodes[id].edges.set(l, this._importCode(edgeObj[l]));
    }
    return id;
  }

  importConcretePlist(plist, rootId = 0) {
    const idMap = new Map();
    const visit = (oldId) => {
      if (idMap.has(oldId)) return idMap.get(oldId);
      const [kind, edges] = plist[oldId];
      const newId = this._newNode(kind);
      idMap.set(oldId, newId);
      for (const [label, target] of edges) {
        this.nodes[newId].edges.set(label, visit(target));
      }
      return newId;
    };
    return visit(rootId);
  }

  find(id) {
    let cur = id;
    while (this.parent[cur] !== -1) cur = this.parent[cur];
    let x = id;
    while (this.parent[x] !== -1) {
      const p = this.parent[x];
      this.parent[x] = cur;
      x = p;
    }
    return cur;
  }

  nodeOf(id) {
    return this.nodes[this.find(id)];
  }

  /**
   * Unify pattern node `patId` against concrete closed `plist` at `cRoot`,
   * mutating `this` in-place so shared `any` / open nodes become concrete.
   */
  unifyWithConcrete(patId, concretePlist, cRoot = 0, { strictClosedUnion = false } = {}) {
    const visited = new Set();

    const step = (pid, cid) => {
      const rep = this.find(pid);
      const key = `${rep}@${cid}`;
      if (visited.has(key)) return;
      visited.add(key);

      const node = this.nodes[rep];
      const [cKind, cEdges] = concretePlist[cid];
      const cMap = new Map(cEdges);

      if (node.kind === "any") {
        // Bind `any` to concrete subgraph!
        const imported = this.importConcretePlist(concretePlist, cid);
        this.parent[rep] = imported;
        return;
      }

      if (node.kind === "closed-product") {
        if (cKind !== "closed-product") {
          throw new KTVMSchemaError(`Expected closed-product, got ${cKind}`);
        }
        if (node.edges.size !== cEdges.length) {
          throw new KTVMSchemaError(
            `Closed product field mismatch: expected [${[...node.edges.keys()].join(", ")}], got [${cEdges.map(([l]) => l).join(", ")}]`
          );
        }
        for (const [label, tId] of node.edges.entries()) {
          if (!cMap.has(label)) {
            throw new KTVMSchemaError(`Closed product missing field '${label}'`);
          }
          step(tId, cMap.get(label));
        }
        return;
      }

      if (node.kind === "open-product") {
        if (cKind !== "closed-product") {
          throw new KTVMSchemaError(`Expected product for open-product, got ${cKind}`);
        }
        for (const [label, tId] of node.edges.entries()) {
          if (!cMap.has(label)) {
            throw new KTVMSchemaError(`Input product missing required field '${label}'`);
          }
          step(tId, cMap.get(label));
        }
        // Close to concrete product, adding extra fields from concrete envelope
        node.kind = "closed-product";
        for (const [label, cTarget] of cEdges) {
          if (!node.edges.has(label)) {
            node.edges.set(label, this.importConcretePlist(concretePlist, cTarget));
          }
        }
        return;
      }

      if (node.kind === "closed-union" || node.kind === "open-union") {
        if (cKind !== "closed-union") {
          throw new KTVMSchemaError(`Expected union, got ${cKind}`);
        }
        let sharedCount = 0;
        const unhandled = [];
        for (const [label] of cEdges) {
          if (node.edges.has(label)) sharedCount++;
          else unhandled.push(label);
        }
        if (node.kind === "closed-union") {
          if (strictClosedUnion && unhandled.length > 0) {
            throw new KTVMSchemaError(
              `Input union carries unhandled tag(s): ${unhandled.join(", ")}`
            );
          }
          if (node.edges.size > 0 && sharedCount === 0) {
            throw new KTVMSchemaError(
              `Disjoint closed-union tags: contract [${[...node.edges.keys()].join(", ")}] vs input [${cEdges.map(([l]) => l).join(", ")}]`
            );
          }
        } else {
          // open-union
          if (node.edges.size > 0 && sharedCount === 0) {
            throw new KTVMSchemaError(
              `Disjoint open-union tags: contract [${[...node.edges.keys()].join(", ")}] vs input [${cEdges.map(([l]) => l).join(", ")}]`
            );
          }
        }

        // Unify every shared tag payload
        for (const [label, cTarget] of cEdges) {
          if (node.edges.has(label)) {
            step(node.edges.get(label), cTarget);
          }
        }
        // For `closed-union`, keep its contract tag set intact so a value-derived
        // subtype at one field (e.g. `den = <_>`) never deletes valid tags (`0`, `1`)
        // needed by another field sharing the same closed-union node (`num = <1:<_>>`)!
        if (node.kind === "closed-union") {
          return;
        }
        // For `open-union`: refine/merge with concrete tags
        if (node.concreteUnified) {
          for (const [label, cTarget] of cEdges) {
            if (!node.edges.has(label)) {
              node.edges.set(label, this.importConcretePlist(concretePlist, cTarget));
            }
          }
          return;
        }
        const newEdges = new Map();
        for (const [label, cTarget] of cEdges) {
          if (node.edges.has(label)) {
            newEdges.set(label, node.edges.get(label));
          } else {
            newEdges.set(label, this.importConcretePlist(concretePlist, cTarget));
          }
        }
        node.kind = "closed-union";
        node.edges = newEdges;
        node.concreteUnified = true;
        return;
      }

      throw new KTVMSchemaError(`Unsupported pattern kind '${node.kind}'`);
    };

    step(patId, cRoot);
  }

  /**
   * Extract a property-list graph rooted at `patId`.
   * If `closeOpenUnions = true`, converts remaining `open-union` nodes (e.g.
   * unannotated variant outputs like `_classify_bits`) into `closed-union`.
   */
  extractPlist(patId, { closeOpenUnions = false } = {}) {
    const remap = new Map();
    const out = [];

    const dfs = (id) => {
      const rep = this.find(id);
      if (remap.has(rep)) return remap.get(rep);
      const node = this.nodes[rep];
      let kind = node.kind;
      if (closeOpenUnions && kind === "open-union") kind = "closed-union";
      const newId = out.length;
      remap.set(rep, newId);
      const slot = [kind, []];
      out.push(slot);
      const labels = [...node.edges.keys()].sort(compareLabels);
      slot[1] = labels.map((l) => [l, dfs(node.edges.get(l))]);
      return newId;
    };

    dfs(patId);
    const canon = canonicalizePlistOrder(out, 0);
    return isClosedPlist(canon) ? mooreMinimize(canon, 0).plist : canon;
  }
}

// --- Closed Schema Combinators (Join, Product, Singleton Union, Filter) ---

function composeClosedProductPlist(fieldEntries) {
  // fieldEntries: [{ label, plist }]
  const sorted = [...fieldEntries].sort((a, b) => compareLabels(a.label, b.label));
  if (sorted.length === 0) return UNIT_PLIST;
  const nodes = [["closed-product", []]];
  for (const { label, plist } of sorted) {
    const base = nodes.length;
    for (const [kind, edges] of plist) {
      nodes.push([kind, edges.map(([l, t]) => [l, t + base])]);
    }
    nodes[0][1].push([label, base]);
  }
  return mooreMinimize(canonicalizePlistOrder(nodes, 0), 0).plist;
}

function composeSingletonUnionPlist(tag, payloadPlist) {
  const nodes = [["closed-union", [[tag, 1]]]];
  for (const [kind, edges] of payloadPlist) {
    nodes.push([kind, edges.map(([l, t]) => [l, t + 1])]);
  }
  return mooreMinimize(canonicalizePlistOrder(nodes, 0), 0).plist;
}

/**
 * Least upper bound (structural join) of two closed k-wire property-list graphs.
 */
function joinTwoClosedPlists(pA, pB) {
  if (schemasEquivalent(pA, 0, pB, 0)) return pA;
  const nodes = [];
  const pairMemo = new Map();
  const singleMemoA = new Map();
  const singleMemoB = new Map();

  function copyOnly(pl, id, memo) {
    if (memo.has(id)) return memo.get(id);
    const nid = nodes.length;
    memo.set(id, nid);
    const [kind, edges] = pl[id];
    const slot = [kind, []];
    nodes.push(slot);
    slot[1] = edges.map(([l, t]) => [l, copyOnly(pl, t, memo)]);
    return nid;
  }

  function joinNodes(iA, iB) {
    const key = `${iA}|${iB}`;
    if (pairMemo.has(key)) return pairMemo.get(key);
    const [kA, eA] = pA[iA];
    const [kB, eB] = pB[iB];
    if (kA !== kB) {
      throw new KTVMSchemaError(`Incompatible branch output schemas: ${kA} vs ${kB}`);
    }
    const mapA = new Map(eA);
    const mapB = new Map(eB);

    if (kA === "closed-product") {
      if (mapA.size !== mapB.size) {
        throw new KTVMSchemaError(
          `Incompatible product branch outputs: [${[...mapA.keys()].join(",")}] vs [${[...mapB.keys()].join(",")}]`
        );
      }
      const nid = nodes.length;
      pairMemo.set(key, nid);
      const slot = ["closed-product", []];
      nodes.push(slot);
      const labels = [...mapA.keys()].sort(compareLabels);
      for (const l of labels) {
        if (!mapB.has(l)) {
          throw new KTVMSchemaError(`Incompatible product branch outputs: missing '${l}'`);
        }
        slot[1].push([l, joinNodes(mapA.get(l), mapB.get(l))]);
      }
      return nid;
    }

    // closed-union: union of tags, joining shared tag payloads
    const nid = nodes.length;
    pairMemo.set(key, nid);
    const slot = ["closed-union", []];
    nodes.push(slot);
    const allLabels = [...new Set([...mapA.keys(), ...mapB.keys()])].sort(compareLabels);
    for (const l of allLabels) {
      if (mapA.has(l) && mapB.has(l)) {
        slot[1].push([l, joinNodes(mapA.get(l), mapB.get(l))]);
      } else if (mapA.has(l)) {
        slot[1].push([l, copyOnly(pA, mapA.get(l), singleMemoA)]);
      } else {
        slot[1].push([l, copyOnly(pB, mapB.get(l), singleMemoB)]);
      }
    }
    return nid;
  }

  joinNodes(0, 0);
  return mooreMinimize(canonicalizePlistOrder(nodes, 0), 0).plist;
}

function joinClosedPlists(plists) {
  if (plists.length === 0) return UNIT_PLIST;
  let acc = plists[0];
  for (let i = 1; i < plists.length; i++) {
    acc = joinTwoClosedPlists(acc, plists[i]);
  }
  return acc;
}

/**
 * Intersect a concrete closed `inPlist` with a (possibly open) `filterPlist`.
 * Returns `{ status: "ALWAYS_TRUE" | "ALWAYS_FALSE" | "RUNTIME_FILTER", plist }`.
 */
function intersectConcreteWithFilter(inPlist, filterPlist) {
  const nodes = [];
  const memo = new Map();
  const copyMemo = new Map();
  let empty = false;

  function copyConcrete(cId) {
    if (copyMemo.has(cId)) return copyMemo.get(cId);
    const nid = nodes.length;
    copyMemo.set(cId, nid);
    const [k, e] = inPlist[cId];
    const slot = [k, []];
    nodes.push(slot);
    slot[1] = e.map(([l, t]) => [l, copyConcrete(t)]);
    return nid;
  }

  function intersect(cId, fId) {
    const key = `${cId}|${fId}`;
    if (memo.has(key)) return memo.get(key);
    const [cKind, cEdges] = inPlist[cId];
    const [fKind, fEdges] = filterPlist[fId];
    const cMap = new Map(cEdges);
    const fMap = new Map(fEdges);

    if (fKind === "any") {
      return copyConcrete(cId);
    }

    if (fKind === "closed-product" || fKind === "open-product") {
      if (cKind !== "closed-product") return -1;
      if (fKind === "closed-product" && cEdges.length !== fEdges.length) return -1;
      for (const [l] of fEdges) {
        if (!cMap.has(l)) return -1;
      }
      const nid = nodes.length;
      memo.set(key, nid);
      const slot = ["closed-product", []];
      nodes.push(slot);
      for (const [l, cT] of cEdges) {
        const child = fMap.has(l) ? intersect(cT, fMap.get(l)) : copyConcrete(cT);
        if (child < 0) return -1;
        slot[1].push([l, child]);
      }
      return nid;
    }

    if (fKind === "closed-union" || fKind === "open-union") {
      if (cKind !== "closed-union") return -1;
      const nid = nodes.length;
      memo.set(key, nid);
      const slot = ["closed-union", []];
      nodes.push(slot);
      for (const [l, cT] of cEdges) {
        if (fMap.has(l)) {
          const child = intersect(cT, fMap.get(l));
          if (child >= 0) slot[1].push([l, child]);
        } else if (fKind === "open-union") {
          slot[1].push([l, copyConcrete(cT)]);
        }
      }
      if (slot[1].length === 0) return -1;
      return nid;
    }

    return -1;
  }

  const root = intersect(0, 0);
  if (root < 0 || empty) return { status: "ALWAYS_FALSE", plist: null };
  const narrowed = mooreMinimize(canonicalizePlistOrder(nodes, root), 0).plist;
  if (schemasEquivalent(inPlist, 0, narrowed, 0)) {
    return { status: "ALWAYS_TRUE", plist: inPlist };
  }
  return { status: "RUNTIME_FILTER", plist: narrowed };
}

// --- Static Analysis Helpers (Used Paths, Leading Guards, Branching SCC) ---

function ignoresInput(exp) {
  if (!exp) return false;
  switch (exp.op) {
    case "product":
      if (exp.fields.length === 0) return true;
      return exp.fields.every((f) => ignoresInput(f.expr));
    case "comp":
      return exp.items.length > 0 && ignoresInput(exp.items[0]);
    default:
      return false;
  }
}

/**
 * Compute which top-level fields of `inScope` an expression reads:
 *   - `null`   => ignores input completely (constant `{}` / `{} |nil`)
 *   - `"ALL"`  => reads the whole input (cannot demux into individual fields)
 *   - `Set<label>` => ONLY reads those specific top-level `.label` fields!
 */
function analyzeFieldUses(exp) {
  if (!exp) return "ALL";
  switch (exp.op) {
    case "identity":
    case "div":
    case "vid":
    case "ref":
    case "filter":
    case "code":
      return "ALL";
    case "empty":
      return "ALL";
    case "dot":
      return new Set([exp.label]);
    case "comp": {
      if (exp.items.length === 0) return "ALL";
      const first = exp.items[0];
      if (first.op === "identity") {
        return exp.items.length === 1 ? "ALL" : analyzeFieldUses({ op: "comp", items: exp.items.slice(1) });
      }
      return analyzeFieldUses(first);
    }
    case "product": {
      if (exp.fields.length === 0) return null;
      const merged = new Set();
      let anyUsed = false;
      for (const f of exp.fields) {
        const sub = analyzeFieldUses(f.expr);
        if (sub === "ALL") return "ALL";
        if (sub !== null) {
          anyUsed = true;
          for (const l of sub) merged.add(l);
        }
      }
      return anyUsed ? merged : null;
    }
    case "union": {
      if (exp.items.length === 0) return "ALL";
      const merged = new Set();
      let anyUsed = false;
      for (const br of exp.items) {
        const sub = analyzeFieldUses(br);
        if (sub === "ALL") return "ALL";
        if (sub !== null) {
          anyUsed = true;
          for (const l of sub) merged.add(l);
        }
      }
      return anyUsed ? merged : null;
    }
    default:
      return "ALL";
  }
}

/**
 * Check if every use of top-level field `fieldLabel` inside `exp` begins with
 * `.fieldLabel /tag` (for the SAME `tag`). Returns `tag` or `null`.
 */
function findCommonLeadingTagOnField(exp, fieldLabel) {
  let foundTag = undefined; // undefined = unused so far, null = conflict/non-div
  function visit(e) {
    if (foundTag === null || !e) return;
    switch (e.op) {
      case "dot":
        if (e.label === fieldLabel) foundTag = null;
        return;
      case "comp": {
        if (e.items.length === 0) return;
        const [first, ...rest] = e.items;
        if (first.op === "identity") {
          visit({ op: "comp", items: rest });
          return;
        }
        if (first.op === "dot") {
          if (first.label !== fieldLabel) return;
          // Look at next step in `rest` (skipping leading identities)
          let idx = 0;
          while (idx < rest.length && rest[idx].op === "identity") idx++;
          const next = rest[idx];
          if (next && next.op === "div") {
            if (foundTag === undefined) foundTag = next.tag;
            else if (foundTag !== next.tag) foundTag = null;
          } else {
            foundTag = null;
          }
          return;
        }
        visit(first);
        return;
      }
      case "product":
        for (const f of e.fields) visit(f.expr);
        return;
      case "union":
        for (const b of e.items) visit(b);
        return;
      default:
        return;
    }
  }
  visit(exp);
  return typeof foundTag === "string" ? foundTag : null;
}

/**
 * Rewrite every `.fieldLabel /tag ...` occurrence inside `exp` (at top-level
 * input position) into `.fieldLabel ...` once `/tag` has been hoisted!
 */
function peelLeadingTagOnField(exp, fieldLabel, tag) {
  if (!exp) return exp;
  switch (exp.op) {
    case "comp": {
      if (exp.items.length === 0) return exp;
      const [first, ...rest] = exp.items;
      if (first.op === "identity") {
        return { ...exp, items: [first, ...peelLeadingTagOnField({ op: "comp", items: rest }, fieldLabel, tag).items] };
      }
      if (first.op === "dot" && first.label === fieldLabel) {
        let idx = 0;
        while (idx < rest.length && rest[idx].op === "identity") idx++;
        if (rest[idx] && rest[idx].op === "div" && rest[idx].tag === tag) {
          const remaining = rest.slice(idx + 1);
          if (remaining.length === 0) return first;
          return { ...exp, items: [first, ...remaining] };
        }
      }
      return { ...exp, items: [peelLeadingTagOnField(first, fieldLabel, tag), ...rest] };
    }
    case "product":
      return {
        ...exp,
        fields: exp.fields.map((f) => ({ ...f, expr: peelLeadingTagOnField(f.expr, fieldLabel, tag) }))
      };
    case "union":
      return {
        ...exp,
        items: exp.items.map((b) => peelLeadingTagOnField(b, fieldLabel, tag))
      };
    default:
      return exp;
  }
}

/**
 * Compute sound leading head-tag guards `Map<key, Set<tag>> | "DEAD"`
 * where `key` is `""` for root input or `label` for top-level field `.label`.
 */
function computeLeadingGuards(exp) {
  if (!exp) return new Map();
  switch (exp.op) {
    case "empty":
      return "DEAD";
    case "div": {
      const m = new Map();
      m.set("", new Set([exp.tag]));
      return m;
    }
    case "identity":
    case "dot":
    case "vid":
    case "ref":
    case "filter":
    case "code":
      return new Map();
    case "comp": {
      if (exp.items.length === 0) return new Map();
      const [first, ...rest] = exp.items;
      if (first.op === "identity") {
        return computeLeadingGuards({ op: "comp", items: rest });
      }
      if (first.op === "dot") {
        const sub = computeLeadingGuards({ op: "comp", items: rest });
        if (sub === "DEAD") return "DEAD";
        const shifted = new Map();
        if (sub.has("")) shifted.set(first.label, new Set(sub.get("")));
        return shifted;
      }
      return computeLeadingGuards(first);
    }
    case "product": {
      const merged = new Map();
      for (const f of exp.fields) {
        const sub = computeLeadingGuards(f.expr);
        if (sub === "DEAD") return "DEAD";
        for (const [k, tags] of sub.entries()) {
          if (!merged.has(k)) {
            merged.set(k, new Set(tags));
          } else {
            const inter = new Set([...merged.get(k)].filter((t) => tags.has(t)));
            if (inter.size === 0) return "DEAD";
            merged.set(k, inter);
          }
        }
      }
      return merged;
    }
    case "union": {
      const liveSubs = [];
      for (const b of exp.items) {
        const sub = computeLeadingGuards(b);
        if (sub !== "DEAD") liveSubs.push(sub);
      }
      if (liveSubs.length === 0) return "DEAD";
      const common = new Map();
      for (const [k, tags] of liveSubs[0].entries()) {
        let inAll = true;
        const unionSet = new Set(tags);
        for (let i = 1; i < liveSubs.length; i++) {
          const other = liveSubs[i].get(k);
          if (!other) {
            inAll = false;
            break;
          }
          for (const t of other) unionSet.add(t);
        }
        if (inAll) common.set(k, unionSet);
      }
      return common;
    }
    default:
      return new Map();
  }
}

/**
 * Compute strongly connected component & branching-recursion status for a relation
 * in `kir.rels` (matches `BlueprintRegistryV2.isBranchingRecursive`).
 */
function analyzeBranchingSCC(kir, relHash) {
  const directRefs = (h) => {
    const rel = kir.rels?.[h];
    const refs = new Set();
    if (!rel) return refs;
    const walk = (e) => {
      if (!e) return;
      if (e.op === "ref") {
        const target = resolveRelHash(kir, e.ref);
        if (target) refs.add(target);
      } else if (e.items) e.items.forEach(walk);
      else if (e.fields) e.fields.forEach((f) => walk(f.expr));
    };
    walk(rel.body);
    return refs;
  };

  const reachable = new Set();
  const q = [...directRefs(relHash)];
  for (let i = 0; i < q.length; i++) {
    const h = q[i];
    if (reachable.has(h)) continue;
    reachable.add(h);
    for (const nxt of directRefs(h)) {
      if (!reachable.has(nxt)) q.push(nxt);
    }
  }
  if (!reachable.has(relHash)) return { scc: new Set(), isBranching: false };

  const scc = new Set([relHash]);
  for (const h of reachable) {
    if (h === relHash) continue;
    const seen = new Set();
    const stack = [...directRefs(h)];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === relHash) {
        scc.add(h);
        break;
      }
      if (seen.has(cur) || !reachable.has(cur)) continue;
      seen.add(cur);
      for (const nxt of directRefs(cur)) stack.push(nxt);
    }
  }

  const maxCalls = (e) => {
    if (!e) return 0;
    if (e.op === "ref") {
      const t = resolveRelHash(kir, e.ref);
      return t && scc.has(t) ? 1 : 0;
    }
    if (e.op === "comp") return e.items.reduce((a, c) => a + maxCalls(c), 0);
    if (e.op === "product") return e.fields.reduce((a, f) => a + maxCalls(f.expr), 0);
    if (e.op === "union") return Math.max(0, ...e.items.map(maxCalls));
    return 0;
  };

  let isBranching = false;
  for (const h of scc) {
    if (maxCalls(kir.rels[h]?.body) >= 2) {
      isBranching = true;
      break;
    }
  }
  return { scc, isBranching };
}

// --- Monomorphizing Compiler: KIR-P + S_in -> Concrete Validated `mono` kTVM ---

const COMPILE_CACHE = new WeakMap();

export function compileKIRToKTVM(
  kirOrObject,
  entryName,
  concreteInputPlist,
  { validate = true, verifyTables = true, allowRetypeFallback = true, useCache = true } = {}
) {
  const { kir, sourceObject } = normalizeKIR(kirOrObject);
  const resolvedEntry = resolveRelHash(kir, entryName || kir.main);
  if (!resolvedEntry) {
    throw new KTVMSchemaError(`Unknown entry relation '${entryName || kir.main}'`);
  }
  if (!Array.isArray(concreteInputPlist) || concreteInputPlist.length === 0) {
    throw new KTVMSchemaError("compileKIRToKTVM requires a closed concrete k-wire input pattern");
  }
  const closedInput = concreteInputPlist.map(([kind, edges]) => {
    if (kind === "open-union") return ["closed-union", edges];
    if (kind === "open-product") return ["closed-product", edges];
    return [kind, edges];
  });
  if (!isClosedPlist(closedInput)) {
    throw new KTVMSchemaError("compileKIRToKTVM requires a closed concrete k-wire input pattern");
  }

  const normalizedIn = mooreMinimize(closedInput, 0).plist;
  const inKey = mooreKey(normalizedIn, 0);

  if (useCache) {
    let byKir = COMPILE_CACHE.get(kirOrObject);
    if (byKir && byKir.has(`${resolvedEntry}::${inKey}`)) {
      return { ...byKir.get(`${resolvedEntry}::${inKey}`), cached: true };
    }
  }

  try {
    const res = compileKIRInternal(kir, resolvedEntry, normalizedIn, { validate, verifyTables });
    if (useCache) {
      let byKir = COMPILE_CACHE.get(kirOrObject);
      if (!byKir) {
        byKir = new Map();
        COMPILE_CACHE.set(kirOrObject, byKir);
      }
      byKir.set(`${resolvedEntry}::${inKey}`, res);
    }
    return { ...res, cached: false };
  } catch (err) {
    // Optional fallback for non-converged `.ko` relations via retypeObjectRelationForBackend
    if (allowRetypeFallback && sourceObject && !(err instanceof KTVMSchemaError)) {
      const retyped = retypeObjectRelationForBackend(sourceObject, resolvedEntry, normalizedIn);
      const res = compileKIRInternal(retyped.kir, retyped.entryName, normalizedIn, { validate, verifyTables });
      return { ...res, cached: false, retyped: true };
    }
    throw err;
  }
}

function compileKIRInternal(kir, entryHash, entryInPlist, { validate, verifyTables }) {
  const findCode = makeCodeLookup(kir);
  const displayNames = buildDisplayNameMap(kir);

  // Deduplicated concrete schemas for emitted `mono` module
  const schemaByMoore = new Map();
  const emittedSchemas = [];
  let schemaSeq = 0;

  function internSchema(plist, hint = "S") {
    const min = mooreMinimize(plist, 0);
    if (min.plist[0][0] === "closed-product" && min.plist[0][1].length === 0) {
      return { expr: S.unit(), plist: min.plist };
    }
    if (schemaByMoore.has(min.key)) return schemaByMoore.get(min.key);
    const prefix = `$${sanitizeIdent(hint, "S")}_${schemaSeq++}`;
    const { decls, rootExpr } = plistToSchemaAst(min.plist, prefix);
    for (const d of decls) emittedSchemas.push(d);
    const rec = { expr: rootExpr, plist: min.plist };
    schemaByMoore.set(min.key, rec);
    return rec;
  }

  const sccCache = new Map();
  function getSccInfo(h) {
    if (!sccCache.has(h)) sccCache.set(h, analyzeBranchingSCC(kir, h));
    return sccCache.get(h);
  }

  const specMemo = new Map(); // `${relHash}::${mooreKey(inPlist)}` -> { procName, inPlist, outPlist }
  const emittedProcs = [];
  let procSeq = 0;

  function specializeRel(relHash, inPlist, isEntry = false, callerDesiredOut = null) {
    const inMin = mooreMinimize(inPlist, 0);
    const outHintMin = callerDesiredOut ? mooreMinimize(callerDesiredOut, 0) : null;
    const memoKey = `${relHash}::${inMin.key}::${outHintMin ? outHintMin.key : "*"}`;
    if (specMemo.has(memoKey)) return specMemo.get(memoKey);

    const rel = kir.rels[relHash];
    if (!rel) throw new KTVMSchemaError(`Unknown KIR relation '${relHash}'`);

    const niceName = sanitizeIdent(displayNames.get(relHash) || relHash, "rel");
    const procName = `@${niceName}_${procSeq++}`;

    // Build local pattern graph and unify `inputPattern` with concrete `inPlist`
    const lpg = new LocalPatternGraph(rel.patternGraph, findCode);
    const localInId = lpg.kirIdToLocal.get(rel.inputPattern);
    const localOutId = lpg.kirIdToLocal.get(rel.outputPattern);

    if (localInId != null) {
      lpg.unifyWithConcrete(localInId, inMin.plist, 0, { strictClosedUnion: isEntry });
    }
    // If caller supplies a concrete expected return schema (binding output-only
    // type parameters like `nil = {} |nil : list[X]`), unify `outputPattern` too!
    if (outHintMin && localOutId != null) {
      try {
        lpg.unifyWithConcrete(localOutId, outHintMin.plist, 0, { strictClosedUnion: false });
      } catch {
        // Ignore if caller expects a supertype/coercion; coerce at call site handles it!
      }
    }

    // Try predicting closed output schema before lowering body (essential for recursion!)
    let predictedOut = null;
    if (localOutId != null) {
      const candidate = lpg.extractPlist(localOutId, { closeOpenUnions: true });
      if (isClosedPlist(candidate)) {
        predictedOut = mooreMinimize(candidate, 0).plist;
      }
    }
    if (!predictedOut && outHintMin) {
      predictedOut = outHintMin.plist;
    }

    const lpgClosedOut = (exp) => {
      const patId = exp?.patterns?.[1];
      if (patId == null || !lpg.kirIdToLocal.has(patId)) return null;
      const cand = lpg.extractPlist(lpg.kirIdToLocal.get(patId), { closeOpenUnions: true });
      return isClosedPlist(cand) ? cand : null;
    };

    const sccInfo = getSccInfo(relHash);
    const isRecursive = sccInfo.scc.size > 0;

    if (isRecursive && !predictedOut) {
      throw new KTVMSchemaError(
        `Non-converged recursive relation '${niceName}' could not close output schema statically`
      );
    }

    const specRec = {
      procName,
      inPlist: inMin.plist,
      outPlist: predictedOut
    };
    if (predictedOut) {
      specMemo.set(memoKey, specRec);
    }

    // Lower relation body into network statements
    let varSeq = 0;
    const freshVar = (p = "v") => `%${sanitizeIdent(p, "v")}_${varSeq++}`;

    const emitChan = (stmts, plist, hint = "v") => {
      const name = freshVar(hint);
      const sRec = internSchema(plist, hint);
      stmts.push({ op: "chan", name, schema: sRec.expr });
      return name;
    };

    const emitBarrier = (stmts) => {
      const name = freshVar("bar");
      stmts.push({ op: "barrier", name });
      return name;
    };

    const emitCoerceOrSplice = (stmts, srcVar, srcPlist, dstVar, dstPlist) => {
      if (schemasEquivalent(srcPlist, 0, dstPlist, 0)) {
        stmts.push({ op: "splice", src: srcVar, dst: dstVar });
      } else {
        const sRec = internSchema(srcPlist, "cs");
        const dRec = internSchema(dstPlist, "cd");
        stmts.push({
          op: "coerce",
          src: srcVar,
          srcSchema: sRec.expr,
          dst: dstVar,
          dstSchema: dRec.expr
        });
      }
    };

    function liveChansOf(scope) {
      if (scope.kind === "none") return [];
      if (scope.kind === "single") return [{ varName: scope.varName, plist: scope.plist }];
      return [...scope.fields.values()];
    }

    function drainScope(scope, stmts) {
      const live = liveChansOf(scope);
      if (live.length === 0) return null;
      const bar = emitBarrier(stmts);
      for (const { varName, plist } of live) {
        const sRec = internSchema(plist, "dr");
        stmts.push({ op: "drain", src: varName, schema: sRec.expr, barrier: bar });
      }
      return bar;
    }

    function failScope(scope, desiredOut, stmts) {
      const outPl = desiredOut || UNIT_PLIST;
      const outVar = emitChan(stmts, outPl, "fail");
      const live = liveChansOf(scope).map((x) => x.varName);
      stmts.push({ op: "spec", inputs: live, outputs: [outVar], branches: [] });
      return { outVar, outPlist: outPl, alwaysFails: true };
    }

    function materializeSingle(scope, stmts) {
      if (scope.kind === "single") return { varName: scope.varName, plist: scope.plist };
      if (scope.kind === "none") {
        const u = emitChan(stmts, UNIT_PLIST, "u");
        stmts.push({ op: "const_unit", dst: u });
        return { varName: u, plist: UNIT_PLIST };
      }
      const entries = [...scope.fields.entries()].sort(([a], [b]) => compareLabels(a, b));
      if (entries.length === 0) {
        const u = emitChan(stmts, UNIT_PLIST, "u");
        stmts.push({ op: "const_unit", dst: u });
        return { varName: u, plist: UNIT_PLIST };
      }
      const prodPl = composeClosedProductPlist(entries.map(([label, f]) => ({ label, plist: f.plist })));
      const outVar = emitChan(stmts, prodPl, "mat");
      const sRec = internSchema(prodPl, "mat");
      stmts.push({
        op: "mux",
        fields: entries.map(([label, f]) => ({ label, name: f.varName })),
        dst: outVar,
        schema: sRec.expr
      });
      return { varName: outVar, plist: prodPl };
    }

    function maybeDemuxScope(scope, exprUses, stmts) {
      if (scope.kind !== "single") return scope;
      if (scope.plist[0][0] !== "closed-product") return scope;
      const pf = productFields(scope.plist, 0);
      if (!pf || pf.length === 0) return scope;
      if (exprUses === "ALL" || exprUses === null) return scope;

      const fields = new Map();
      const demuxFields = [];
      for (const f of pf) {
        const fPl = subPlist(scope.plist, f.targetId);
        const v = emitChan(stmts, fPl, f.label);
        fields.set(f.label, { varName: v, plist: fPl });
        demuxFields.push({ label: f.label, name: v });
      }
      const sRec = internSchema(scope.plist, "dm");
      stmts.push({ op: "demux", src: scope.varName, schema: sRec.expr, fields: demuxFields });
      return { kind: "fields", plist: scope.plist, fields };
    }

    /**
     * Lower `exp` consuming every live channel in `scope` exactly once and
     * returning `{ outVar, outPlist, lastSccToken? }`.
     */
    function lowerExp(exp, scope, desiredOut, stmts, afterToken = null) {
      switch (exp.op) {
        case "identity": {
          const single = materializeSingle(scope, stmts);
          return { outVar: single.varName, outPlist: single.plist };
        }

        case "empty": {
          return failScope(scope, desiredOut, stmts);
        }

        case "dot": {
          if (scope.kind === "fields") {
            if (!scope.fields.has(exp.label)) {
              return failScope(scope, desiredOut, stmts);
            }
            const chosen = scope.fields.get(exp.label);
            const others = [...scope.fields.entries()].filter(([l]) => l !== exp.label);
            if (others.length === 0) {
              return { outVar: chosen.varName, outPlist: chosen.plist };
            }
            const bar = emitBarrier(stmts);
            for (const [, f] of others) {
              stmts.push({ op: "drain", src: f.varName, schema: internSchema(f.plist, "dr").expr, barrier: bar });
            }
            const gated = emitChan(stmts, chosen.plist, exp.label);
            stmts.push({ op: "gate", barrier: bar, src: chosen.varName, dst: gated });
            return { outVar: gated, outPlist: chosen.plist };
          }

          const single = materializeSingle(scope, stmts);
          const pf = productFields(single.plist, 0);
          const fInfo = productFieldInfo(single.plist, 0, exp.label);
          if (!pf || !fInfo) {
            return failScope({ kind: "single", ...single }, desiredOut, stmts);
          }
          const targetPl = subPlist(single.plist, fInfo.targetId);
          if (pf.length === 1) {
            const outVar = emitChan(stmts, targetPl, exp.label);
            stmts.push({
              op: "demux",
              src: single.varName,
              schema: internSchema(single.plist, "dm").expr,
              fields: [{ label: exp.label, name: outVar }]
            });
            return { outVar, outPlist: targetPl };
          }
          const bar = emitBarrier(stmts);
          const demuxFields = [];
          let chosenVar = null;
          const drains = [];
          for (const f of pf) {
            const fPl = subPlist(single.plist, f.targetId);
            const v = emitChan(stmts, fPl, f.label);
            demuxFields.push({ label: f.label, name: v });
            if (f.label === exp.label) chosenVar = v;
            else drains.push({ src: v, plist: fPl });
          }
          stmts.push({
            op: "demux",
            src: single.varName,
            schema: internSchema(single.plist, "dm").expr,
            fields: demuxFields
          });
          for (const d of drains) {
            stmts.push({ op: "drain", src: d.src, schema: internSchema(d.plist, "dr").expr, barrier: bar });
          }
          const outVar = emitChan(stmts, targetPl, exp.label);
          stmts.push({ op: "gate", barrier: bar, src: chosenVar, dst: outVar });
          return { outVar, outPlist: targetPl };
        }

        case "div": {
          const single = materializeSingle(scope, stmts);
          const info = unionTagInfo(single.plist, 0, exp.tag);
          if (!info) {
            return failScope({ kind: "single", ...single }, desiredOut, stmts);
          }
          const targetPl = subPlist(single.plist, info.targetId);
          const outVar = emitChan(stmts, targetPl, "m");
          stmts.push({ op: "match", tag: exp.tag, src: single.varName, dst: outVar });
          return { outVar, outPlist: targetPl };
        }

        case "vid": {
          const single = materializeSingle(scope, stmts);
          // Determine target union schema: prefer `desiredOut` if compatible!
          let outPl = null;
          if (desiredOut) {
            const info = unionTagInfo(desiredOut, 0, exp.tag);
            if (info) {
              outPl = desiredOut;
            }
          }
          if (!outPl) {
            // Check if KIR-P outPattern already closed to a concrete union containing `exp.tag`
            const outPatId = exp.patterns?.[1];
            const localId = outPatId != null ? lpg.kirIdToLocal.get(outPatId) : null;
            if (localId != null) {
              const cand = lpg.extractPlist(localId, { closeOpenUnions: true });
              if (isClosedPlist(cand)) {
                const info = unionTagInfo(cand, 0, exp.tag);
                if (info) {
                  const targetSub = subPlist(cand, info.targetId);
                  if (schemasEquivalent(single.plist, 0, targetSub, 0)) {
                    outPl = cand;
                  }
                }
              }
            }
          }
          if (!outPl) {
            outPl = composeSingletonUnionPlist(exp.tag, single.plist);
          }
          const info = unionTagInfo(outPl, 0, exp.tag);
          const expectedPayload = subPlist(outPl, info.targetId);
          let payloadVar = single.varName;
          if (!schemasEquivalent(single.plist, 0, expectedPayload, 0)) {
            payloadVar = emitChan(stmts, expectedPayload, "wp");
            emitCoerceOrSplice(stmts, single.varName, single.plist, payloadVar, expectedPayload);
          }
          const outVar = emitChan(stmts, outPl, "w");
          stmts.push({ op: "wrap", tag: exp.tag, src: payloadVar, dst: outVar });
          return { outVar, outPlist: outPl };
        }

        case "filter":
        case "code": {
          const single = materializeSingle(scope, stmts);
          let filterPlist = null;
          if (exp.op === "code") {
            filterPlist = codeHashToPlist(exp.code, findCode);
          } else {
            const patId = exp.patterns?.[0];
            const localId = patId != null ? lpg.kirIdToLocal.get(patId) : null;
            if (localId != null) {
              filterPlist = lpg.extractPlist(localId, { closeOpenUnions: false });
            }
          }
          if (!filterPlist) {
            return { outVar: single.varName, outPlist: single.plist };
          }
          const check = intersectConcreteWithFilter(single.plist, filterPlist);
          if (check.status === "ALWAYS_TRUE") {
            return { outVar: single.varName, outPlist: single.plist };
          }
          if (check.status === "ALWAYS_FALSE") {
            return failScope({ kind: "single", ...single }, desiredOut || single.plist, stmts);
          }
          // Runtime partial filter via iterative `dpda_coerce`!
          const outVar = emitChan(stmts, check.plist, "flt");
          emitCoerceOrSplice(stmts, single.varName, single.plist, outVar, check.plist);
          return { outVar, outPlist: check.plist };
        }

        case "ref": {
          const single = materializeSingle(scope, stmts);
          if (isIntrinsic(exp.ref)) {
            if (isIdentityIntrinsic(exp.ref)) {
              return { outVar: single.varName, outPlist: single.plist };
            }
            throw unsupportedIntrinsic("kTVM", exp.ref);
          }
          const targetHash = resolveRelHash(kir, exp.ref);
          if (!targetHash) {
            throw new KTVMSchemaError(`Unresolved relation ref '${exp.ref}'`);
          }
          const callDesiredOut = desiredOut || lpgClosedOut(exp);
          let childSpec;
          try {
            childSpec = specializeRel(targetHash, single.plist, false, callDesiredOut);
          } catch (err) {
            if (err instanceof KTVMSchemaError) {
              // Internal call whose concrete argument is disjoint from callee's
              // partial input contract cannot match at runtime -> always fails.
              return failScope({ kind: "single", ...single }, callDesiredOut || desiredOut, stmts);
            }
            throw err;
          }
          const outVar = emitChan(stmts, childSpec.outPlist, "call");
          const isSameScc = sccInfo.isBranching && sccInfo.scc.has(targetHash);
          const token = isSameScc ? freshVar("tok") : null;
          stmts.push({
            op: "spawn",
            target: childSpec.procName,
            schemaArgs: [],
            inputs: [single.varName],
            outputs: [outVar],
            after: isSameScc ? afterToken : null,
            token
          });
          return { outVar, outPlist: childSpec.outPlist, sccToken: token };
        }

        case "comp": {
          if (exp.items.length === 0) {
            const single = materializeSingle(scope, stmts);
            return { outVar: single.varName, outPlist: single.plist };
          }
          let curScope = scope;
          let curAfter = afterToken;
          let lastSccTok = null;
          let lastRes = null;
          for (let i = 0; i < exp.items.length; i++) {
            const isLast = i === exp.items.length - 1;
            const stepDesired = isLast ? (desiredOut || lpgClosedOut(exp.items[i])) : lpgClosedOut(exp.items[i]);
            const res = lowerExp(exp.items[i], curScope, stepDesired, stmts, curAfter);
            if (res.sccToken) {
              lastSccTok = res.sccToken;
              curAfter = res.sccToken;
            }
            lastRes = res;
            if (!isLast) {
              curScope = { kind: "single", varName: res.outVar, plist: res.outPlist };
            }
          }
          return { ...lastRes, sccToken: lastSccTok };
        }

        case "product": {
          // Empty product `{}` -> unit (draining input to enforce strict K partiality!)
          if (exp.fields.length === 0) {
            const bar = drainScope(scope, stmts);
            const u = emitChan(stmts, UNIT_PLIST, "u");
            stmts.push({ op: "const_unit", dst: u });
            if (!bar) return { outVar: u, outPlist: UNIT_PLIST };
            const gated = emitChan(stmts, UNIT_PLIST, "ug");
            stmts.push({ op: "gate", barrier: bar, src: u, dst: gated });
            return { outVar: gated, outPlist: UNIT_PLIST };
          }

          // Canonical field order for `mux`
          let fields = [...exp.fields].sort((a, b) => compareLabels(a.label, b.label));

          // Rule 1: Demux input product ONCE if all branches only project fields!
          const wholeUses = analyzeFieldUses({ op: "product", fields });
          let curScope = maybeDemuxScope(scope, wholeUses, stmts);

          // Rule 2: Common leading `/tag` hoisting on any field used 2+ times with same tag!
          // (Transforms `_reverse`'s `.xs /cons .cdr` + `.xs /cons .car` into ZERO tees!)
          if (curScope.kind === "fields") {
            const fieldUseCounts = new Map();
            for (const f of fields) {
              const u = analyzeFieldUses(f.expr);
              if (u instanceof Set) {
                for (const l of u) fieldUseCounts.set(l, (fieldUseCounts.get(l) || 0) + 1);
              }
            }
            for (const [label, count] of fieldUseCounts.entries()) {
              if (count < 2) continue;
              const chInfo = curScope.fields.get(label);
              if (!chInfo || chInfo.plist[0][0] !== "closed-union") continue;
              const commonTag = findCommonLeadingTagOnField({ op: "product", fields }, label);
              if (!commonTag) continue;
              const tInfo = unionTagInfo(chInfo.plist, 0, commonTag);
              if (!tInfo) {
                return failScope(curScope, desiredOut, stmts);
              }
              const payloadPl = subPlist(chInfo.plist, tInfo.targetId);
              const payloadVar = emitChan(stmts, payloadPl, `${label}_${commonTag}`);
              stmts.push({ op: "match", tag: commonTag, src: chInfo.varName, dst: payloadVar });
              curScope = {
                kind: "fields",
                plist: curScope.plist,
                fields: new Map(curScope.fields)
              };
              curScope.fields.set(label, { varName: payloadVar, plist: payloadPl });
              fields = fields.map((f) => ({
                ...f,
                expr: peelLeadingTagOnField(f.expr, label, commonTag)
              }));

              // And if payload is a product accessed only by nested `.sub`, demux it right here too!
              // Wait: nested `.label .sub` patterns: check if every branch reading `label` immediately does `.sub`!
              if (payloadPl[0][0] === "closed-product") {
                const subPf = productFields(payloadPl, 0);
                if (subPf && subPf.length >= 2) {
                  const subProjectionOk = checkAllUsesAreFieldDot({ op: "product", fields }, label);
                  if (subProjectionOk) {
                    const subDemuxFields = [];
                    const subNames = new Map();
                    for (const sf of subPf) {
                      const sfPl = subPlist(payloadPl, sf.targetId);
                      const sv = emitChan(stmts, sfPl, sf.label);
                      const synthLabel = `__${label}__${sf.label}`;
                      subDemuxFields.push({ label: sf.label, name: sv });
                      subNames.set(sf.label, synthLabel);
                      curScope.fields.set(synthLabel, { varName: sv, plist: sfPl });
                    }
                    stmts.push({
                      op: "demux",
                      src: payloadVar,
                      schema: internSchema(payloadPl, "dm").expr,
                      fields: subDemuxFields
                    });
                    curScope.fields.delete(label);
                    fields = fields.map((f) => ({
                      ...f,
                      expr: rewriteFieldSubDot(f.expr, label, subNames)
                    }));
                  }
                }
              }
            }
          }

          // Compute exact per-branch input scopes & allocate minimal `tee`s / `drain`s
          const branchScopes = fields.map(() => null);
          let unusedBarrier = null;

          if (curScope.kind === "none") {
            for (let i = 0; i < fields.length; i++) branchScopes[i] = { kind: "none" };
          } else if (curScope.kind === "single") {
            const readers = [];
            for (let i = 0; i < fields.length; i++) {
              if (ignoresInput(fields[i].expr)) {
                branchScopes[i] = { kind: "none" };
              } else {
                readers.push(i);
              }
            }
            if (readers.length === 0) {
              unusedBarrier = drainScope(curScope, stmts);
            } else if (readers.length === 1) {
              branchScopes[readers[0]] = curScope;
            } else {
              const copies = readers.map((idx) => emitChan(stmts, curScope.plist, `t${idx}`));
              stmts.push({ op: "tee", src: curScope.varName, dsts: copies });
              readers.forEach((bIdx, k) => {
                branchScopes[bIdx] = { kind: "single", varName: copies[k], plist: curScope.plist };
              });
            }
          } else {
            // curScope.kind === "fields": per-field minimal fan-out!
            const branchFieldMaps = fields.map(() => new Map());
            const perFieldUses = fields.map((f) => analyzeFieldUses(f.expr));
            const unusedFields = [];

            for (const [label, chInfo] of curScope.fields.entries()) {
              const users = [];
              for (let i = 0; i < fields.length; i++) {
                const u = perFieldUses[i];
                if (u === "ALL" || (u instanceof Set && u.has(label))) {
                  users.push(i);
                }
              }
              if (users.length === 0) {
                unusedFields.push(chInfo);
              } else if (users.length === 1) {
                branchFieldMaps[users[0]].set(label, chInfo);
              } else {
                const copies = users.map((idx) => emitChan(stmts, chInfo.plist, `${label}_${idx}`));
                stmts.push({ op: "tee", src: chInfo.varName, dsts: copies });
                users.forEach((bIdx, k) => {
                  branchFieldMaps[bIdx].set(label, { varName: copies[k], plist: chInfo.plist });
                });
              }
            }

            if (unusedFields.length > 0) {
              unusedBarrier = emitBarrier(stmts);
              for (const chInfo of unusedFields) {
                stmts.push({
                  op: "drain",
                  src: chInfo.varName,
                  schema: internSchema(chInfo.plist, "dr").expr,
                  barrier: unusedBarrier
                });
              }
            }

            for (let i = 0; i < fields.length; i++) {
              const fm = branchFieldMaps[i];
              if (fm.size === 0) branchScopes[i] = { kind: "none" };
              else branchScopes[i] = { kind: "fields", plist: curScope.plist, fields: fm };
            }
          }

          // Determine desired per-field output schemas from `desiredOut` or `lpg`
          const prodDesired = desiredOut || lpgClosedOut(exp);
          const desiredFieldMap = new Map();
          if (prodDesired && prodDesired[0][0] === "closed-product") {
            for (const f of productFields(prodDesired, 0) || []) {
              desiredFieldMap.set(f.label, subPlist(prodDesired, f.targetId));
            }
          }

          // Lower every field (chaining `after %tok` across branching recursive sibling calls!)
          let curAfter = afterToken;
          let lastSccTok = null;
          const loweredFields = [];
          for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const fDesired = desiredFieldMap.get(f.label) || lpgClosedOut(f.expr);
            const res = lowerExp(
              f.expr,
              branchScopes[i],
              fDesired,
              stmts,
              curAfter
            );
            if (res.sccToken) {
              curAfter = res.sccToken;
              lastSccTok = res.sccToken;
            }
            loweredFields.push({ label: f.label, varName: res.outVar, plist: res.outPlist });
          }

          const prodPl = composeClosedProductPlist(loweredFields.map((f) => ({ label: f.label, plist: f.plist })));
          const muxOut = emitChan(stmts, prodPl, "prod");
          stmts.push({
            op: "mux",
            fields: loweredFields.map((f) => ({ label: f.label, name: f.varName })),
            dst: muxOut,
            schema: internSchema(prodPl, "prod").expr
          });

          if (!unusedBarrier) {
            return { outVar: muxOut, outPlist: prodPl, sccToken: lastSccTok };
          }
          const gated = emitChan(stmts, prodPl, "pg");
          stmts.push({ op: "gate", barrier: unusedBarrier, src: muxOut, dst: gated });
          return { outVar: gated, outPlist: prodPl, sccToken: lastSccTok };
        }

        case "union": {
          if (exp.items.length === 0) {
            return failScope(scope, desiredOut, stmts);
          }

          // Demux product input once upfront if all branches only project fields!
          const wholeUses = analyzeFieldUses(exp);
          const curScope = maybeDemuxScope(scope, wholeUses, stmts);

          // Map key -> { varName, plist } for all inspectable channels in `curScope`
          const scopeMap = new Map();
          if (curScope.kind === "single") {
            scopeMap.set("", { varName: curScope.varName, plist: curScope.plist });
          } else if (curScope.kind === "fields") {
            for (const [label, chInfo] of curScope.fields.entries()) {
              scopeMap.set(label, chInfo);
            }
          }

          // Analyze leading guards & prune statically dead branches!
          const liveBranches = [];
          for (const br of exp.items) {
            const g = computeLeadingGuards(br);
            if (g === "DEAD") continue;
            let dead = false;
            const filteredGuards = new Map();
            for (const [k, tags] of g.entries()) {
              const ch = scopeMap.get(k);
              if (!ch) continue;
              if (ch.plist[0][0] !== "closed-union") {
                dead = true;
                break;
              }
              const avail = new Set(ch.plist[0][1].map(([t]) => t));
              const inter = new Set([...tags].filter((t) => avail.has(t)));
              if (inter.size === 0) {
                dead = true;
                break;
              }
              filteredGuards.set(k, inter);
            }
            if (!dead) {
              liveBranches.push({ exp: br, guards: filteredGuards });
            }
          }

          if (liveBranches.length === 0) {
            return failScope(curScope, desiredOut, stmts);
          }
          if (liveBranches.length === 1) {
            return lowerExp(liveBranches[0].exp, curScope, desiredOut, stmts, afterToken);
          }

          // Check whether prefix-disjoint `switch` is sound!
          const switchPlan = tryBuildDisjointSwitchPlan(liveBranches, scopeMap);

          // Lower each live branch in a fresh statement list to discover exact branch output schemas!
          const loweredBranches = [];
          for (let i = 0; i < liveBranches.length; i++) {
            const bStmts = [];
            const bScope = curScope.kind === "fields"
              ? { kind: "fields", plist: curScope.plist, fields: new Map(curScope.fields) }
              : { ...curScope };
            const bRes = lowerExp(liveBranches[i].exp, bScope, desiredOut, bStmts, null);
            loweredBranches.push({ stmts: bStmts, res: bRes });
          }

          // Compute unified output schema across all non-failing live branches
          const validPlists = loweredBranches
            .filter((b) => !b.res.alwaysFails)
            .map((b) => b.res.outPlist);
          const unionOutPl = desiredOut
            ? desiredOut
            : (validPlists.length > 0 ? joinClosedPlists(validPlists) : UNIT_PLIST);

          const outVar = emitChan(stmts, unionOutPl, "uout");

          // Finalize every branch body to write into `outVar`
          const finalBodies = loweredBranches.map(({ stmts: bStmts, res }) => {
            emitCoerceOrSplice(bStmts, res.outVar, res.outPlist, outVar, unionOutPl);
            return bStmts;
          });

          if (switchPlan) {
            // Emit zero-buffering prefix-disjoint `switch`!
            const arms = switchPlan.arms.map(({ patterns, branchIdx }) => ({
              patterns,
              // Clone AST body if a branch appears in multiple tag arms
              body: structuredClone(finalBodies[branchIdx])
            }));
            stmts.push({
              op: "switch",
              inputs: switchPlan.inspectVars,
              arms,
              defaultBody: null
            });
            return { outVar, outPlist: unionOutPl };
          }

          // Emit ordered speculative `spec`!
          const specIns = liveChansOf(curScope).map((x) => x.varName);
          stmts.push({
            op: "spec",
            inputs: specIns,
            outputs: [outVar],
            branches: finalBodies.map((body, idx) => ({ index: idx, body }))
          });
          return { outVar, outPlist: unionOutPl };
        }

        default:
          throw new Error(`Unsupported KIR-P expression op: '${exp.op}'`);
      }
    }

    // Lower top-level relation body
    const bodyStmts = [];
    const inVar = "%in";
    const outVar = "%out";
    const rootRes = lowerExp(
      rel.body,
      { kind: "single", varName: inVar, plist: inMin.plist },
      predictedOut,
      bodyStmts,
      null
    );

    const finalOutPlist = predictedOut || rootRes.outPlist;
    specRec.outPlist = finalOutPlist;
    specMemo.set(memoKey, specRec);

    emitCoerceOrSplice(bodyStmts, rootRes.outVar, rootRes.outPlist, outVar, finalOutPlist);

    const inSchemaRec = internSchema(inMin.plist, "in");
    const outSchemaRec = internSchema(finalOutPlist, "out");
    const attrs = [];
    if (sccInfo.isBranching) attrs.push("branching");

    emittedProcs.push({
      name: procName,
      params: [],
      inputs: [{ name: inVar, schema: inSchemaRec.expr }],
      outputs: [{ name: outVar, schema: outSchemaRec.expr }],
      attrs,
      body: bodyStmts
    });

    return specRec;
  }

  const rootSpec = specializeRel(entryHash, entryInPlist, true);

  const monoModule = createModule({
    version: "0.1",
    layer: "mono",
    entry: rootSpec.procName,
    schemas: emittedSchemas,
    procs: emittedProcs,
    kernels: [],
    tables: []
  });

  if (validate) {
    validateModule(monoModule, { verifyTables });
  }

  return {
    module: monoModule,
    entry: rootSpec.procName,
    inputPlist: rootSpec.inPlist,
    outputPlist: rootSpec.outPlist
  };
}

// --- Helper: Nested Field-Projection Rewriting for Rule 2 ---

function checkAllUsesAreFieldDot(exp, fieldLabel) {
  let ok = true;
  function visit(e) {
    if (!ok || !e) return;
    switch (e.op) {
      case "dot":
        if (e.label === fieldLabel) ok = false;
        return;
      case "comp": {
        if (e.items.length === 0) return;
        const [first, ...rest] = e.items;
        if (first.op === "identity") {
          visit({ op: "comp", items: rest });
          return;
        }
        if (first.op === "dot" && first.label === fieldLabel) {
          let idx = 0;
          while (idx < rest.length && rest[idx].op === "identity") idx++;
          const next = rest[idx];
          if (!next || next.op !== "dot") ok = false;
          return;
        }
        visit(first);
        return;
      }
      case "product":
        for (const f of e.fields) visit(f.expr);
        return;
      case "union":
        for (const b of e.items) visit(b);
        return;
      default:
        return;
    }
  }
  visit(exp);
  return ok;
}

function rewriteFieldSubDot(exp, fieldLabel, subNames) {
  if (!exp) return exp;
  switch (exp.op) {
    case "comp": {
      if (exp.items.length === 0) return exp;
      const [first, ...rest] = exp.items;
      if (first.op === "identity") {
        return { ...exp, items: [first, ...rewriteFieldSubDot({ op: "comp", items: rest }, fieldLabel, subNames).items] };
      }
      if (first.op === "dot" && first.label === fieldLabel) {
        let idx = 0;
        while (idx < rest.length && rest[idx].op === "identity") idx++;
        const next = rest[idx];
        if (next && next.op === "dot" && subNames.has(next.label)) {
          const synthDot = { op: "dot", label: subNames.get(next.label) };
          const tail = rest.slice(idx + 1);
          return tail.length === 0 ? synthDot : { ...exp, items: [synthDot, ...tail] };
        }
      }
      return { ...exp, items: [rewriteFieldSubDot(first, fieldLabel, subNames), ...rest] };
    }
    case "product":
      return {
        ...exp,
        fields: exp.fields.map((f) => ({ ...f, expr: rewriteFieldSubDot(f.expr, fieldLabel, subNames) }))
      };
    case "union":
      return {
        ...exp,
        items: exp.items.map((b) => rewriteFieldSubDot(b, fieldLabel, subNames))
      };
    default:
      return exp;
  }
}

// --- Helper: Sound Prefix-Disjoint `switch` Planner ---

function tryBuildDisjointSwitchPlan(liveBranches, scopeMap) {
  const keySet = new Set();
  for (const b of liveBranches) {
    for (const k of b.guards.keys()) {
      const ch = scopeMap.get(k);
      if (ch && ch.plist[0][0] === "closed-union") keySet.add(k);
    }
  }
  if (keySet.size === 0 || keySet.size > 3) return null;

  const inspectKeys = [...keySet].sort(compareLabels);
  const inspectVars = inspectKeys.map((k) => scopeMap.get(k).varName);
  const domainTags = inspectKeys.map((k) => scopeMap.get(k).plist[0][1].map(([t]) => t));

  // Fast path: single inspected union channel (scales cleanly even to 128-tag ascii[]!)
  if (inspectKeys.length === 1) {
    const k0 = inspectKeys[0];
    const seenTags = new Set();
    const arms = [];
    let totalArms = 0;
    for (let i = 0; i < liveBranches.length; i++) {
      const g = liveBranches[i].guards.get(k0);
      if (!g || g.size === 0) return null; // wildcard overlaps earlier branches -> use `spec`!
      // Avoid code duplication if a single branch expands to many tags
      if (g.size > 1 && totalArms + g.size > 16) return null;
      for (const t of g) {
        if (seenTags.has(t)) return null; // overlapping tag -> must use `spec`!
        seenTags.add(t);
        arms.push({ patterns: [{ kind: "tag", tag: t }], branchIdx: i });
        totalArms++;
      }
    }
    return { inspectVars, arms };
  }

  // Multi-channel case (2..3 ports): check Cartesian size & pairwise disjointness
  const cartSize = domainTags.reduce((a, ts) => a * ts.length, 1);
  if (cartSize > 64) return null;

  // Verify every concrete tuple matches AT MOST ONE branch
  const arms = [];
  const tuple = new Array(inspectKeys.length);

  function enumerate(dim) {
    if (dim === inspectKeys.length) {
      let matched = -1;
      for (let i = 0; i < liveBranches.length; i++) {
        let ok = true;
        for (let d = 0; d < inspectKeys.length; d++) {
          const g = liveBranches[i].guards.get(inspectKeys[d]);
          if (g && !g.has(tuple[d])) {
            ok = false;
            break;
          }
        }
        if (ok) {
          if (matched !== -1) return false; // Overlap! Must use `spec`
          matched = i;
        }
      }
      if (matched !== -1) {
        arms.push({
          patterns: tuple.map((t) => ({ kind: "tag", tag: t })),
          branchIdx: matched
        });
      }
      return true;
    }
    for (const t of domainTags[dim]) {
      tuple[dim] = t;
      if (!enumerate(dim + 1)) return false;
    }
    return true;
  }

  if (!enumerate(0) || arms.length === 0) return null;
  // Avoid excessive body duplication if a single branch spans many tuples
  const counts = new Map();
  for (const a of arms) counts.set(a.branchIdx, (counts.get(a.branchIdx) || 0) + 1);
  for (const c of counts.values()) {
    if (c > 8) return null;
  }
  return { inspectVars, arms };
}

// --- Polymorphic AOT Lowering: KIR-P -> `kTVM-P` (`layer: "poly"`) ---

/**
 * Lower a `KIR-P` (or `k-object`) into an inspectable polymorphic `kTVM-P`
 * module (`layer: "poly"`) without requiring a concrete input envelope yet.
 */
export function lowerKIRToKTVMP(kirOrObject, { entry = null, validate = true } = {}) {
  const { kir } = normalizeKIR(kirOrObject);
  const findCode = makeCodeLookup(kir);
  const displayNames = buildDisplayNameMap(kir);

  const entryHash = resolveRelHash(kir, entry || kir.main) || Object.keys(kir.rels || {})[0] || null;
  const relNameByHash = new Map();
  let procSeq = 0;
  for (const h of Object.keys(kir.rels || {})) {
    const nice = sanitizeIdent(displayNames.get(h) || h, "rel");
    relNameByHash.set(h, `@${nice}_${procSeq++}`);
  }

  const emittedSchemas = [];
  const emittedProcs = [];
  let schemaSeq = 0;

  for (const [relHash, rel] of Object.entries(kir.rels || {})) {
    const procName = relNameByHash.get(relHash);
    const lpg = new LocalPatternGraph(rel.patternGraph, findCode);
    const sccInfo = getSccInfoStatic(kir, relHash);

    // Build schema expressions for nodes in `lpg`
    const nodeSchemaNames = new Map();
    const inDegree = new Map();
    const cycleTargets = new Set();
    const visitState = new Map();

    const mark = (id) => {
      const r = lpg.find(id);
      visitState.set(r, 1);
      for (const [, t] of lpg.nodes[r].edges.entries()) {
        const rt = lpg.find(t);
        inDegree.set(rt, (inDegree.get(rt) || 0) + 1);
        if (visitState.get(rt) === 1) cycleTargets.add(rt);
        else if (!visitState.has(rt)) mark(rt);
      }
      visitState.set(r, 2);
    };
    for (const id of lpg.kirIdToLocal.values()) {
      if (!visitState.has(lpg.find(id))) mark(id);
    }

    for (const id of new Set([...lpg.kirIdToLocal.values()].map((x) => lpg.find(x)))) {
      const node = lpg.nodes[id];
      if (node.kind === "any") continue;
      if (node.kind === "closed-product" && node.edges.size === 0) continue;
      if (cycleTargets.has(id)) {
        nodeSchemaNames.set(id, `$P_${schemaSeq++}`);
      }
    }

    const toSchemaExpr = (localId, inlineSelf = false) => {
      const r = lpg.find(localId);
      const node = lpg.nodes[r];
      if (node.kind === "any") return S.any();
      if (node.kind === "closed-product" && node.edges.size === 0) return S.unit();
      if (!inlineSelf && nodeSchemaNames.has(r)) return S.ref(nodeSchemaNames.get(r));
      const fields = [...node.edges.entries()]
        .sort(([a], [b]) => compareLabels(a, b))
        .map(([label, t]) => ({ label, schema: toSchemaExpr(t, false) }));
      if (node.kind === "closed-product") return S.product(fields);
      if (node.kind === "open-product") return S.openProduct(fields);
      if (node.kind === "closed-union") return S.union(fields);
      if (node.kind === "open-union") return S.openUnion(fields);
      return S.any();
    };

    for (const [id, sName] of nodeSchemaNames.entries()) {
      emittedSchemas.push({ name: sName, params: [], expr: toSchemaExpr(id, true) });
    }

    const patSchema = (kirPatId) => {
      if (kirPatId == null || !lpg.kirIdToLocal.has(kirPatId)) return S.any();
      return toSchemaExpr(lpg.kirIdToLocal.get(kirPatId), false);
    };

    let vSeq = 0;
    const fVar = (p = "v") => `%${p}_${vSeq++}`;

    const lowerPolyExp = (exp, inVar, stmts) => {
      const inS = patSchema(exp.patterns?.[0]);
      const outS = patSchema(exp.patterns?.[1]);
      switch (exp.op) {
        case "identity":
          return inVar;
        case "empty": {
          const out = fVar("fail");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({ op: "spec", inputs: [inVar], outputs: [out], branches: [] });
          return out;
        }
        case "dot": {
          const out = fVar("dot");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({ op: "project", field: exp.label, src: inVar, srcSchema: inS, dst: out, dstSchema: outS });
          return out;
        }
        case "div": {
          const out = fVar("div");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({ op: "match", tag: exp.tag, src: inVar, dst: out });
          return out;
        }
        case "vid": {
          const out = fVar("vid");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({ op: "wrap", tag: exp.tag, src: inVar, dst: out });
          return out;
        }
        case "filter":
        case "code": {
          const out = fVar("flt");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({ op: "guard", schema: inS, src: inVar, dst: out });
          return out;
        }
        case "ref": {
          if (isIntrinsic(exp.ref)) {
            if (isIdentityIntrinsic(exp.ref)) return inVar;
            throw unsupportedIntrinsic("kTVM-P", exp.ref);
          }
          const tHash = resolveRelHash(kir, exp.ref);
          const out = fVar("call");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({
            op: "spawn",
            target: relNameByHash.get(tHash),
            schemaArgs: [],
            inputs: [inVar],
            outputs: [out],
            after: null,
            token: null
          });
          return out;
        }
        case "comp": {
          let cur = inVar;
          for (const item of exp.items) cur = lowerPolyExp(item, cur, stmts);
          return cur;
        }
        case "product": {
          if (exp.fields.length === 0) {
            const bar = fVar("bar");
            const u = fVar("u");
            const out = fVar("ug");
            stmts.push({ op: "barrier", name: bar });
            stmts.push({ op: "drain", src: inVar, schema: inS, barrier: bar });
            stmts.push({ op: "chan", name: u, schema: S.unit() });
            stmts.push({ op: "const_unit", dst: u });
            stmts.push({ op: "chan", name: out, schema: S.unit() });
            stmts.push({ op: "gate", barrier: bar, src: u, dst: out });
            return out;
          }
          const sorted = [...exp.fields].sort((a, b) => compareLabels(a.label, b.label));
          let branchIns;
          if (sorted.length === 1) {
            branchIns = [inVar];
          } else {
            branchIns = sorted.map((_, idx) => {
              const c = fVar(`t${idx}`);
              stmts.push({ op: "chan", name: c, schema: inS });
              return c;
            });
            stmts.push({ op: "tee", src: inVar, dsts: branchIns });
          }
          const muxFields = sorted.map((f, idx) => ({
            label: f.label,
            name: lowerPolyExp(f.expr, branchIns[idx], stmts)
          }));
          const out = fVar("prod");
          stmts.push({ op: "chan", name: out, schema: outS });
          stmts.push({ op: "mux", fields: muxFields, dst: out, schema: outS });
          return out;
        }
        case "union": {
          const out = fVar("uout");
          stmts.push({ op: "chan", name: out, schema: outS });
          const branches = exp.items.map((br, idx) => {
            const bStmts = [];
            const resVar = lowerPolyExp(br, inVar, bStmts);
            bStmts.push({ op: "splice", src: resVar, dst: out });
            return { index: idx, body: bStmts };
          });
          stmts.push({ op: "spec", inputs: [inVar], outputs: [out], branches });
          return out;
        }
        default:
          throw new Error(`Unsupported KIR-P op '${exp.op}'`);
      }
    };

    const body = [];
    const resVar = lowerPolyExp(rel.body, "%in", body);
    body.push({ op: "splice", src: resVar, dst: "%out" });

    emittedProcs.push({
      name: procName,
      params: [],
      inputs: [{ name: "%in", schema: patSchema(rel.inputPattern) }],
      outputs: [{ name: "%out", schema: patSchema(rel.outputPattern) }],
      attrs: sccInfo.isBranching ? ["branching"] : [],
      body
    });
  }

  const polyMod = createModule({
    version: "0.1",
    layer: "poly",
    entry: entryHash ? relNameByHash.get(entryHash) : null,
    schemas: emittedSchemas,
    procs: emittedProcs,
    kernels: [],
    tables: []
  });

  if (validate) {
    validateModule(polyMod, { verifyTables: false });
  }
  return polyMod;
}

function getSccInfoStatic(kir, h) {
  return analyzeBranchingSCC(kir, h);
}

// --- High-Level Object Artifact & Execution API (Mirroring `kvm.mjs`) ---

export function compileObjectToKTVM(object, relationName = null, inputPlist = null, options = {}) {
  if (!inputPlist) {
    return {
      module: lowerKIRToKTVMP(object, { entry: relationName || object.main, validate: options.validate !== false }),
      layer: "poly",
      isPolymorphic: true
    };
  }
  return compileKIRToKTVM(object, relationName || object.main, inputPlist, options);
}

/**
 * Execute a K `k-object` relation via `kTVM` on either:
 *   - an enveloped `k-wire` `Buffer` / `Uint8Array`, OR
 *   - a K `Value` (with `opts.inputPlist` or inferred pattern from the relation/value).
 */
export function executeObjectWithKTVM(object, relationName, inputValOrWire, opts = {}) {
  const relName = relationName || object.main;

  if (inputValOrWire instanceof Uint8Array) {
    const { plist: inPlist, payloadDeque } = splitEnvelopedWire(inputValOrWire, { quota: opts.quota });
    const compiled = compileKIRToKTVM(object, relName, inPlist, {
      validate: opts.validate !== false,
      verifyTables: opts.verifyTables !== false,
      useCache: opts.useCache !== false
    });
    payloadDeque.release();
    return executeKTVMWire(compiled.module, inputValOrWire, {
      entry: compiled.entry,
      validate: false, // already validated during compileKIRToKTVM
      quota: opts.quota,
      decodeValue: opts.decodeValue
    });
  }

  // In-memory K Value path
  let inPlist = opts.inputPlist || inputValOrWire?.pattern || null;
  if (!inPlist) {
    const relHash = resolveRelHash(object, relName);
    const rel = object.rels?.[relHash];
    if (rel) {
      inPlist = relationPatternPropertyList(rel, 0);
    }
  }
  if (!inPlist || !isClosedPlist(inPlist)) {
    throw new KTVMSchemaError(
      `executeObjectWithKTVM requires a closed input pattern (pass an enveloped k-wire Buffer or opts.inputPlist)`
    );
  }

  const compiled = compileKIRToKTVM(object, relName, inPlist, {
    validate: opts.validate !== false,
    verifyTables: opts.verifyTables !== false,
    useCache: opts.useCache !== false
  });
  return executeKTVM(compiled.module, [inputValOrWire], {
    entry: compiled.entry,
    validate: false,
    quota: opts.quota,
    decodeValues: opts.decodeValues
  });
}
