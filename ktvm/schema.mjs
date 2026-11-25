/**
 * kTVM Schema & Wire Type System.
 *
 * Compiles kTVM schema AST expressions to canonical k-wire property-list graphs
 * (`plist`), computes Moore minimal bisimulation quotients for zero-copy splice
 * equivalence (`S1 ≡ S2`), derives prefix derivatives, and unifies polymorphic
 * `kTVM-P` contracts against concrete `k-wire` envelopes using K's
 * `intersectPropertyListPatterns`.
 */

import { intersectPropertyListPatterns } from "../codecs/runtime/codec.mjs";
import { choiceWidth } from "../codecs/runtime/prefix-codec.mjs";
import { KTVMSchemaError, S } from "./ast.mjs";

export function compareLabels(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isClosedSchemaKind(kind) {
  return kind === "closed-product" || kind === "closed-union";
}

export function isClosedPlist(plist) {
  if (!Array.isArray(plist) || plist.length === 0) return false;
  for (const node of plist) {
    if (!Array.isArray(node) || node.length !== 2) return false;
    if (!isClosedSchemaKind(node[0])) return false;
  }
  return true;
}

/**
 * Substitute schema parameters `$X -> schemaExpr` inside a schema AST expression.
 */
export function substituteSchemaExpr(expr, env) {
  if (!expr) return expr;
  switch (expr.kind) {
    case "unit":
    case "any":
      return expr;
    case "ref": {
      if ((!expr.args || expr.args.length === 0) && env.has(expr.name)) {
        return env.get(expr.name);
      }
      return S.ref(expr.name, (expr.args || []).map((a) => substituteSchemaExpr(a, env)));
    }
    case "product":
      return S.product(expr.fields.map((f) => ({ label: f.label, schema: substituteSchemaExpr(f.schema, env) })));
    case "open_product":
      return S.openProduct(expr.fields.map((f) => ({ label: f.label, schema: substituteSchemaExpr(f.schema, env) })));
    case "union":
      return S.union(expr.fields.map((f) => ({ label: f.label, schema: substituteSchemaExpr(f.schema, env) })));
    case "open_union":
      return S.openUnion(expr.fields.map((f) => ({ label: f.label, schema: substituteSchemaExpr(f.schema, env) })));
    default:
      throw new Error(`Unknown schema expr kind: ${expr.kind}`);
  }
}

function exprStructuralKey(expr) {
  switch (expr.kind) {
    case "unit": return "U";
    case "any": return "A";
    case "ref":
      return expr.args && expr.args.length > 0
        ? `R(${expr.name}[${expr.args.map(exprStructuralKey).join(",")}])`
        : `R(${expr.name})`;
    case "product":
    case "open_product":
    case "union":
    case "open_union": {
      const sorted = [...expr.fields].sort((a, b) => compareLabels(a.label, b.label));
      return `${expr.kind}(${sorted.map((f) => `${JSON.stringify(f.label)}:${exprStructuralKey(f.schema)}`).join(",")})`;
    }
    default:
      throw new Error(`Unknown schema expr kind: ${expr.kind}`);
  }
}

/**
 * Compile a closed (or open, if allowOpen=true) kTVM schema expression against
 * a map of schema declarations into a canonical k-wire property-list graph.
 */
export function compileSchemaExprToPlist(expr, schemaDecls, { paramBindings = new Map(), allowOpen = false } = {}) {
  const declMap = schemaDecls instanceof Map
    ? schemaDecls
    : new Map((schemaDecls || []).map((d) => [d.name, d]));

  const nodes = [];
  const memo = new Map();

  function visit(curExpr, env, expandingRefs = new Set()) {
    const resolved = substituteSchemaExpr(curExpr, env);
    if (resolved.kind === "ref") {
      const decl = declMap.get(resolved.name);
      if (!decl) {
        if (allowOpen) {
          const id = nodes.length;
          nodes.push(["any", []]);
          return id;
        }
        throw new KTVMSchemaError(`Unresolved schema reference '${resolved.name}'`);
      }
      const args = resolved.args || [];
      if (args.length !== (decl.params || []).length) {
        throw new KTVMSchemaError(
          `Schema '${resolved.name}' expects ${(decl.params || []).length} args, got ${args.length}`
        );
      }
      const key = `${resolved.name}[${args.map(exprStructuralKey).join(",")}]`;
      if (memo.has(key)) return memo.get(key);
      if (expandingRefs.has(key)) {
        throw new KTVMSchemaError(`Unguarded direct schema cycle on '${resolved.name}'`);
      }
      const nextEnv = new Map();
      for (let i = 0; i < args.length; i++) {
        nextEnv.set(decl.params[i], args[i]);
      }
      const nextExpanding = new Set(expandingRefs);
      nextExpanding.add(key);

      // Peek body kind; reserve node slot BEFORE descending into edges to tie recursive knots.
      const body = substituteSchemaExpr(decl.expr, nextEnv);
      if (body.kind === "ref") {
        const id = visit(body, nextEnv, nextExpanding);
        memo.set(key, id);
        return id;
      }
      const id = nodes.length;
      memo.set(key, id);
      nodes.push(null);
      nodes[id] = buildComposite(body, nextEnv);
      return id;
    }

    const id = nodes.length;
    nodes.push(null);
    nodes[id] = buildComposite(resolved, env);
    return id;
  }

  function buildComposite(resolved, env) {
    switch (resolved.kind) {
      case "unit":
        return ["closed-product", []];
      case "any":
        if (!allowOpen) throw new KTVMSchemaError("Schema 'any' is not allowed in concrete mono kTVM");
        return ["any", []];
      case "product":
      case "union": {
        const kind = resolved.kind === "product" ? "closed-product" : "closed-union";
        const sorted = [...resolved.fields].sort((a, b) => compareLabels(a.label, b.label));
        const edges = sorted.map((f) => [f.label, visit(f.schema, env)]);
        return [kind, edges];
      }
      case "open_product":
      case "open_union": {
        if (!allowOpen) {
          throw new KTVMSchemaError(`Open schema '${resolved.kind}' is not allowed in concrete mono kTVM`);
        }
        const kind = resolved.kind === "open_product" ? "open-product" : "open-union";
        const sorted = [...resolved.fields].sort((a, b) => compareLabels(a.label, b.label));
        const edges = sorted.map((f) => [f.label, visit(f.schema, env)]);
        return [kind, edges];
      }
      default:
        throw new KTVMSchemaError(`Unsupported schema kind '${resolved.kind}'`);
    }
  }

  visit(expr, paramBindings);
  return canonicalizePlistOrder(nodes, 0);
}

/**
 * Re-index a property-list graph in canonical DFS discovery order from `rootId`
 * with edges sorted in canonical label order.
 */
export function canonicalizePlistOrder(plist, rootId = 0) {
  const idMap = new Map();
  const out = [];

  function dfs(oldId) {
    if (idMap.has(oldId)) return idMap.get(oldId);
    const newId = out.length;
    idMap.set(oldId, newId);
    const [kind, edges] = plist[oldId];
    const sortedEdges = [...edges].sort((a, b) => compareLabels(a[0], b[0]));
    const slot = [kind, []];
    out.push(slot);
    slot[1] = sortedEdges.map(([label, target]) => [label, dfs(target)]);
    return newId;
  }

  dfs(rootId);
  return out;
}

/**
 * Extract the reachable subgraph rooted at `rootId` as a standalone property-list.
 */
export function subPlist(plist, rootId = 0) {
  return canonicalizePlistOrder(plist, rootId);
}

/**
 * Compute the Moore minimal bisimulation quotient of a property-list graph
 * rooted at `rootId`, returning both the minimized plist and a unique canonical
 * string key (`S1 ≡ S2  <=>  mooreKey(S1) === mooreKey(S2)`).
 */
export function mooreMinimize(plist, rootId = 0) {
  const sub = canonicalizePlistOrder(plist, rootId);
  const n = sub.length;

  // Initial partition by (kind, ordered label list)
  let cls = new Int32Array(n);
  const initSigs = new Map();
  let numClasses = 0;
  for (let i = 0; i < n; i++) {
    const [kind, edges] = sub[i];
    const sig = `${kind}|${edges.map(([l]) => JSON.stringify(l)).join(",")}`;
    let c = initSigs.get(sig);
    if (c === undefined) {
      c = numClasses++;
      initSigs.set(sig, c);
    }
    cls[i] = c;
  }

  // Refine partition to fixed point
  while (true) {
    const nextCls = new Int32Array(n);
    const sigMap = new Map();
    let nextNum = 0;
    for (let i = 0; i < n; i++) {
      const edges = sub[i][1];
      const sig = `${cls[i]}:${edges.map(([, t]) => cls[t]).join(",")}`;
      let c = sigMap.get(sig);
      if (c === undefined) {
        c = nextNum++;
        sigMap.set(sig, c);
      }
      nextCls[i] = c;
    }
    cls = nextCls;
    if (nextNum === numClasses) break;
    numClasses = nextNum;
  }

  // Build representative graph over classes and re-order canonically from root's class
  const repOfClass = new Int32Array(numClasses).fill(-1);
  for (let i = 0; i < n; i++) {
    if (repOfClass[cls[i]] === -1) repOfClass[cls[i]] = i;
  }
  const quotient = [];
  for (let c = 0; c < numClasses; c++) {
    const [kind, edges] = sub[repOfClass[c]];
    quotient.push([kind, edges.map(([l, t]) => [l, cls[t]])]);
  }
  const canonical = canonicalizePlistOrder(quotient, cls[0]);
  return { plist: canonical, key: JSON.stringify(canonical) };
}

const MOORE_KEY_CACHE = new WeakMap();

export function mooreKey(plist, rootId = 0) {
  let byRoot = MOORE_KEY_CACHE.get(plist);
  if (!byRoot) {
    byRoot = new Map();
    MOORE_KEY_CACHE.set(plist, byRoot);
  }
  let key = byRoot.get(rootId);
  if (key === undefined) {
    key = mooreMinimize(plist, rootId).key;
    byRoot.set(rootId, key);
  }
  return key;
}

export function schemasEquivalent(p1, r1, p2, r2) {
  if (p1 === p2 && r1 === r2) return true;
  return mooreKey(p1, r1) === mooreKey(p2, r2);
}

// --- Wire Layout Helpers ---

export function isUnitSchema(plist, nodeId = 0) {
  const node = plist[nodeId];
  return node[0] === "closed-product" && node[1].length === 0;
}

export function unionTagInfo(plist, nodeId, label) {
  const node = plist[nodeId];
  if (!node || (node[0] !== "closed-union" && node[0] !== "open-union")) return null;
  const edges = node[1];
  const ordinal = edges.findIndex(([l]) => l === label);
  if (ordinal < 0) return null;
  return {
    ordinal,
    width: choiceWidth(edges.length),
    targetId: edges[ordinal][1],
    tagCount: edges.length
  };
}

export function unionOrdinalInfo(plist, nodeId, ordinal) {
  const node = plist[nodeId];
  if (!node || (node[0] !== "closed-union" && node[0] !== "open-union")) return null;
  const edges = node[1];
  if (ordinal < 0 || ordinal >= edges.length) return null;
  return {
    label: edges[ordinal][0],
    targetId: edges[ordinal][1],
    width: choiceWidth(edges.length),
    tagCount: edges.length
  };
}

export function productFields(plist, nodeId = 0) {
  const node = plist[nodeId];
  if (!node || (node[0] !== "closed-product" && node[0] !== "open-product")) return null;
  return node[1].map(([label, targetId]) => ({ label, targetId }));
}

export function productFieldInfo(plist, nodeId, label) {
  const fields = productFields(plist, nodeId);
  if (!fields) return null;
  const idx = fields.findIndex((f) => f.label === label);
  if (idx < 0) return null;
  return { index: idx, label, targetId: fields[idx].targetId, fields };
}

/**
 * Convert a concrete closed property-list graph back into clean kTVM schema
 * declarations (`$prefix_0`, ...) plus a root schema expression.
 */
export function plistToSchemaAst(plist, namePrefix = "$S") {
  const min = mooreMinimize(plist, 0).plist;
  // Detect which nodes are referenced recursively (or multiple times) so we emit clean named decls.
  const inDegree = new Int32Array(min.length);
  const isCycleTarget = new Uint8Array(min.length);
  const state = new Int8Array(min.length);

  function mark(u) {
    state[u] = 1;
    for (const [, v] of min[u][1]) {
      inDegree[v]++;
      if (state[v] === 1) isCycleTarget[v] = 1;
      else if (state[v] === 0) mark(v);
    }
    state[u] = 2;
  }
  mark(0);

  const decls = [];
  const nameOf = new Map();
  let seq = 0;
  for (let i = 0; i < min.length; i++) {
    const [kind, edges] = min[i];
    if (kind === "closed-product" && edges.length === 0) continue; // inline `unit`
    if (isCycleTarget[i] || inDegree[i] > 1 || i === 0) {
      nameOf.set(i, seq === 0 ? namePrefix : `${namePrefix}_${seq}`);
      seq++;
    }
  }

  function buildExpr(i, inlineSelf) {
    const [kind, edges] = min[i];
    if (kind === "closed-product" && edges.length === 0) return S.unit();
    if (!inlineSelf && nameOf.has(i)) return S.ref(nameOf.get(i));
    const fields = edges.map(([label, t]) => ({ label, schema: buildExpr(t, false) }));
    if (kind === "closed-product") return S.product(fields);
    if (kind === "closed-union") return S.union(fields);
    if (kind === "open-product") return S.openProduct(fields);
    if (kind === "open-union") return S.openUnion(fields);
    return S.any();
  }

  for (const [nodeId, name] of nameOf.entries()) {
    decls.push({ name, params: [], expr: buildExpr(nodeId, true) });
  }
  const rootExpr = nameOf.has(0) ? S.ref(nameOf.get(0)) : buildExpr(0, true);
  return { decls, rootExpr, plist: min };
}

/**
 * Unify a polymorphic kTVM-P contract expression against a concrete closed
 * k-wire property-list graph `concretePlist`.
 *
 * Returns `Map<paramName, concreteSubPlist>` binding every schema parameter
 * `$X` in `paramSet`, or throws `KTVMSchemaError` on any structural contradiction.
 */
export function unifyContractWithConcrete(contractExpr, schemaDecls, paramNames, concretePlist, concreteRootId = 0) {
  if (!isClosedPlist(concretePlist)) {
    throw new KTVMSchemaError("Input envelope schema must be a closed concrete k-wire pattern graph");
  }
  const declMap = schemaDecls instanceof Map
    ? schemaDecls
    : new Map((schemaDecls || []).map((d) => [d.name, d]));
  const paramSet = new Set(paramNames || []);
  const bindings = new Map(); // $X -> minimized concrete subPlist
  const visited = new Set();

  function unify(cExpr, localEnv, nodeId) {
    const resolved = substituteSchemaExpr(cExpr, localEnv);
    const cNode = concretePlist[nodeId];
    if (!cNode) throw new KTVMSchemaError(`Invalid concrete schema node ${nodeId}`);
    const [cKind, cEdges] = cNode;

    // Schema parameter `$X`
    if (resolved.kind === "ref" && (!resolved.args || resolved.args.length === 0) && paramSet.has(resolved.name)) {
      const candidate = mooreMinimize(concretePlist, nodeId).plist;
      if (bindings.has(resolved.name)) {
        const prev = bindings.get(resolved.name);
        // Verify compatibility via K's pattern intersection and Moore equivalence
        try {
          const inter = intersectPropertyListPatterns(prev, candidate);
          const mPrev = mooreKey(prev, 0);
          const mCand = mooreKey(candidate, 0);
          const mInter = mooreKey(inter, 0);
          if (mPrev !== mCand || mInter !== mPrev) {
            throw new KTVMSchemaError(
              `Conflicting bindings for schema parameter '${resolved.name}'`
            );
          }
        } catch (err) {
          if (err instanceof KTVMSchemaError) throw err;
          throw new KTVMSchemaError(
            `Incompatible bindings for schema parameter '${resolved.name}': ${err.message}`
          );
        }
      } else {
        bindings.set(resolved.name, candidate);
      }
      return;
    }

    if (resolved.kind === "any") {
      return;
    }

    if (resolved.kind === "unit") {
      if (cKind !== "closed-product" || cEdges.length !== 0) {
        throw new KTVMSchemaError(`Expected 'unit', got '${cKind}' with ${cEdges.length} edges`);
      }
      return;
    }

    // Named schema reference (possibly recursive & parameterized)
    if (resolved.kind === "ref") {
      const decl = declMap.get(resolved.name);
      if (!decl) {
        throw new KTVMSchemaError(`Unknown schema '${resolved.name}'`);
      }
      const args = resolved.args || [];
      if (args.length !== (decl.params || []).length) {
        throw new KTVMSchemaError(
          `Schema '${resolved.name}' expects ${(decl.params || []).length} args, got ${args.length}`
        );
      }
      const visitKey = `${exprStructuralKey(resolved)}@${nodeId}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const nextEnv = new Map();
      for (let i = 0; i < args.length; i++) {
        nextEnv.set(decl.params[i], args[i]);
      }
      unify(decl.expr, nextEnv, nodeId);
      return;
    }

    // Products
    if (resolved.kind === "product" || resolved.kind === "open_product") {
      if (cKind !== "closed-product") {
        throw new KTVMSchemaError(`Expected product schema, got '${cKind}'`);
      }
      const cMap = new Map(cEdges);
      const reqFields = resolved.fields || [];
      if (resolved.kind === "product" && reqFields.length !== cEdges.length) {
        throw new KTVMSchemaError(
          `Closed product arity mismatch: contract has ${reqFields.length} fields, input has ${cEdges.length}`
        );
      }
      for (const f of reqFields) {
        if (!cMap.has(f.label)) {
          throw new KTVMSchemaError(`Input product is missing required field '${f.label}'`);
        }
        unify(f.schema, localEnv, cMap.get(f.label));
      }
      return;
    }

    // Unions
    if (resolved.kind === "union" || resolved.kind === "open_union") {
      if (cKind !== "closed-union") {
        throw new KTVMSchemaError(`Expected union schema, got '${cKind}'`);
      }
      const cMap = new Map(cEdges);
      const contractMap = new Map((resolved.fields || []).map((f) => [f.label, f.schema]));
      if (resolved.kind === "union") {
        // Every tag in input must be accepted by closed union contract; for exact closed-union
        // contract, check exact tag set match (consistent with k-wire closed union).
        for (const [label] of cEdges) {
          if (!contractMap.has(label)) {
            throw new KTVMSchemaError(`Input union carries unhandled tag '${label}'`);
          }
        }
        if (contractMap.size !== cEdges.length) {
          throw new KTVMSchemaError(
            `Closed union tag set mismatch: contract expects [${[...contractMap.keys()].join(", ")}], input has [${cEdges.map(([l]) => l).join(", ")}]`
          );
        }
      } else {
        // open_union: contract tags present in input must unify; intersection must be non-empty
        // if contract has tags, at least compatible kinds.
      }
      for (const [label, targetId] of cEdges) {
        if (contractMap.has(label)) {
          unify(contractMap.get(label), localEnv, targetId);
        }
      }
      return;
    }

    throw new KTVMSchemaError(`Unsupported contract kind '${resolved.kind}'`);
  }

  unify(contractExpr, new Map(), concreteRootId);
  return bindings;
}

/**
 * Intersect two concrete or open property-list patterns using K's canonical
 * `intersectPropertyListPatterns`, converting errors into `KTVMSchemaError`.
 */
export function intersectSchemas(leftPlist, rightPlist) {
  try {
    return canonicalizePlistOrder(intersectPropertyListPatterns(leftPlist, rightPlist), 0);
  } catch (err) {
    throw new KTVMSchemaError(err.message);
  }
}
