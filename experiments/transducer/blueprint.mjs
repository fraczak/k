/**
 * Blueprint compiler: translates converged, closed monomorphic K relations
 * (from `loadLibrary(compileLibrary(...))`) into symbolic transducer blueprints.
 *
 * Every `ref` (relation call) compiles to a black-hole `STUB` blueprint node
 * that will only be expanded lazily at runtime if tokens reach it.
 */

import { exportPatternGraph, patternToPropertyList } from "../../backend-api.mjs";

function assertClosedPlist(plist, context) {
  for (let i = 0; i < plist.length; i++) {
    const [kind] = plist[i];
    if (kind !== "closed-product" && kind !== "closed-union") {
      throw new Error(`Blueprint compiler requires closed patterns; found '${kind}' in ${context}`);
    }
  }
  return plist;
}

function plistEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Check if a union's branches are deterministically disambiguated by a single
 * leading `/tag` (`div`) on a `closed-union` input root.
 */
function extractDeterministicPrefixMap(branches, inPlist) {
  const [kind] = inPlist[0];
  if (kind !== "closed-union") return null;
  const tagMap = new Map();
  for (const branch of branches) {
    let leadTag = null;
    if (branch.op === "div") {
      leadTag = branch.div;
    } else if (branch.op === "comp" && branch.comp.length > 0 && branch.comp[0].op === "div") {
      leadTag = branch.comp[0].div;
    } else {
      return null;
    }
    if (tagMap.has(leadTag)) {
      // Duplicate leading tag -> needs speculative union
      return null;
    }
    tagMap.set(leadTag, branch);
  }
  return tagMap;
}

export class BlueprintRegistry {
  constructor(library) {
    this.library = library;
    this.nameByHash = new Map();
    for (const [alias, hash] of Object.entries(library.relAlias || {})) {
      if (!this.nameByHash.has(hash)) {
        this.nameByHash.set(hash, alias);
      }
    }
    this.blueprints = new Map();
    this.plistCache = new Map();
  }

  displayName(hash) {
    return this.nameByHash.get(hash) || hash.slice(0, 10);
  }

  _getPlist(typePatternGraph, patternId, context) {
    const rep = typePatternGraph.find(patternId);
    const key = `${typePatternGraph.id || ""}:${rep}`;
    // Note: each relation has its own TypePatternGraph, so cache per-graph via WeakMap or inline
    const raw = patternToPropertyList(exportPatternGraph(typePatternGraph, rep));
    return assertClosedPlist(raw, context);
  }

  getBlueprint(relHash) {
    if (this.blueprints.has(relHash)) {
      return this.blueprints.get(relHash);
    }
    const rel = this.library.rels[relHash];
    if (!rel) {
      throw new Error(`Unknown relation hash: ${relHash}`);
    }
    const name = this.displayName(relHash);
    const g = rel.typePatternGraph;
    const localCache = new Map();
    const plistOf = (pid, ctx) => {
      const rep = g.find(pid);
      if (!localCache.has(rep)) {
        localCache.set(rep, assertClosedPlist(patternToPropertyList(exportPatternGraph(g, rep)), `${name}:${ctx}`));
      }
      return localCache.get(rep);
    };

    const compileNode = (ast) => {
      const inPlist = plistOf(ast.patterns[0], `${ast.op}.in`);
      const outPlist = plistOf(ast.patterns[1], `${ast.op}.out`);
      const samePattern = plistEquals(inPlist, outPlist);

      switch (ast.op) {
        case "identity":
          return {
            kind: "identity",
            inPlist,
            outPlist,
            samePattern
          };

        case "div": {
          const [rootKind, edges] = inPlist[0];
          if (rootKind !== "closed-union") {
            throw new Error(`${name}: div '${ast.div}' on non-union`);
          }
          const edge = edges.find(([t]) => t === ast.div);
          if (!edge) {
            throw new Error(`${name}: div tag '${ast.div}' not in closed-union`);
          }
          // Check whether payload pattern at target edge equals outPlist
          const targetSubPlist = this._subPlist(inPlist, edge[1]);
          return {
            kind: "div",
            tag: ast.div,
            targetNodeId: edge[1],
            inPlist,
            outPlist,
            payloadSamePattern: plistEquals(targetSubPlist, outPlist)
          };
        }

        case "vid": {
          const [rootKind, edges] = outPlist[0];
          if (rootKind !== "closed-union") {
            throw new Error(`${name}: vid '${ast.vid}' on non-union`);
          }
          const edge = edges.find(([t]) => t === ast.vid);
          if (!edge) {
            throw new Error(`${name}: vid tag '${ast.vid}' not in closed-union`);
          }
          const targetSubPlist = this._subPlist(outPlist, edge[1]);
          return {
            kind: "vid",
            tag: ast.vid,
            targetNodeId: edge[1],
            inPlist,
            outPlist,
            payloadSamePattern: plistEquals(inPlist, targetSubPlist)
          };
        }

        case "dot": {
          const [rootKind, edges] = inPlist[0];
          if (rootKind !== "closed-product") {
            throw new Error(`${name}: dot '${ast.dot}' on non-product`);
          }
          const idx = edges.findIndex(([l]) => l === ast.dot);
          if (idx === -1) {
            throw new Error(`${name}: dot field '${ast.dot}' not found`);
          }
          return {
            kind: "dot",
            field: ast.dot,
            beforeNodes: edges.slice(0, idx).map(([, target]) => target),
            targetNodeId: edges[idx][1],
            afterNodes: edges.slice(idx + 1).map(([, target]) => target),
            inPlist,
            outPlist
          };
        }

        case "product": {
          if (ast.product.length === 0) {
            return {
              kind: "unit",
              inPlist,
              outPlist
            };
          }
          const [rootKind, outEdges] = outPlist[0];
          if (rootKind !== "closed-product") {
            throw new Error(`${name}: product output is not closed-product`);
          }
          const byLabel = new Map(ast.product.map((f) => [f.label, f.exp]));
          const fields = outEdges.map(([label]) => {
            const exp = byLabel.get(label);
            if (!exp) {
              throw new Error(`${name}: product missing field '${label}'`);
            }
            return { label, blueprint: compileNode(exp) };
          });
          return {
            kind: "product",
            fields,
            inPlist,
            outPlist
          };
        }

        case "comp": {
          const steps = ast.comp.map(compileNode);
          if (steps.length === 1) return steps[0];
          return {
            kind: "comp",
            steps,
            inPlist,
            outPlist
          };
        }

        case "union": {
          const detMap = extractDeterministicPrefixMap(ast.union, inPlist);
          if (detMap) {
            const cases = new Map();
            for (const [tag, branchAst] of detMap.entries()) {
              cases.set(tag, compileNode(branchAst));
            }
            return {
              kind: "prefix-switch",
              cases,
              inPlist,
              outPlist
            };
          }
          return {
            kind: "spec-switch",
            branches: ast.union.map(compileNode),
            inPlist,
            outPlist
          };
        }

        case "ref":
          return {
            kind: "stub",
            relHash: ast.ref,
            relName: this.displayName(ast.ref),
            inPlist,
            outPlist
          };

        default:
          throw new Error(`${name}: unsupported AST op '${ast.op}'`);
      }
    };

    const root = compileNode(rel.def);
    const bp = {
      relHash,
      name,
      inPlist: root.inPlist,
      outPlist: root.outPlist,
      root
    };
    this.blueprints.set(relHash, bp);
    return bp;
  }

  /**
   * Extract a normalized sub-property-list rooted at `startNode` for structural
   * pattern equality checks (used to decide when copy vs coerce is needed).
   */
  _subPlist(plist, startNode) {
    const remap = new Map();
    const out = [];
    const visit = (nid) => {
      if (remap.has(nid)) return remap.get(nid);
      const newId = out.length;
      remap.set(nid, newId);
      const [kind, edges] = plist[nid];
      const entry = [kind, []];
      out.push(entry);
      entry[1] = edges.map(([label, target]) => [label, visit(target)]);
      return newId;
    };
    visit(startNode);
    return out;
  }
}
