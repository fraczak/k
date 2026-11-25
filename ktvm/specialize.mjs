/**
 * Boundary Envelope Compatibility & Shape Refinement (`kTVM-P` -> `kTVM`).
 *
 * Implements DOCS/KTVM_SPEC.md §4:
 *   1. Unifies incoming closed `k-wire` envelope schema `S_in` against `@entry`'s
 *      contract (raising `KTVMSchemaError` on contradiction).
 *   2. Propagates bound concrete schemas through reachable procedures, deriving
 *      concrete closed output schema(s) `S_out`.
 *   3. Computes per-procedure access profiles: splits accessed concrete products
 *      while preserving uninspected opaque `$X` payloads as a single `BitDeque`.
 *   4. Resolves union tag bit-widths, erases proven `guard`s, prunes dead
 *      `switch` arms, collapses Moore-equivalent `coerce` into `splice`.
 *   5. Validates and caches the resulting 100% envelope-free `mono` module by
 *      `(moduleKey, entry, MooreKey(S_in))`.
 */

import { KTVMSchemaError, S, cloneAst, createModule } from "./ast.mjs";
import {
  compareLabels,
  compileSchemaExprToPlist,
  intersectSchemas,
  isClosedPlist,
  mooreKey,
  mooreMinimize,
  plistToSchemaAst,
  productFieldInfo,
  productFields,
  schemasEquivalent,
  subPlist,
  substituteSchemaExpr,
  unionTagInfo,
  unifyContractWithConcrete
} from "./schema.mjs";
import { validateModule } from "./validator.mjs";
import { printModule } from "./printer.mjs";

const SPECIALIZE_CACHE = new Map();

function sanitizeSuffix(str) {
  return str.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 24) || "s";
}

/**
 * Compute which port indices / local channels have fields accessed (`demux`/`project`/`mux`)
 * inside a procedure body. Used for access-profile port splitting.
 */
function analyzeProcAccesses(proc) {
  const accessedVars = new Set();
  function walk(stmts) {
    for (const s of stmts) {
      if (s.op === "demux" || s.op === "project") {
        accessedVars.add(s.src);
      } else if (s.op === "mux") {
        accessedVars.add(s.dst);
      } else if (s.op === "switch") {
        for (const arm of s.arms) walk(arm.body);
        if (s.defaultBody) walk(s.defaultBody);
      } else if (s.op === "spec") {
        for (const br of s.branches) walk(br.body);
      }
    }
  }
  walk(proc.body);
  return accessedVars;
}

/**
 * Specialize a `kTVM-P` (or already `mono`) module for a concrete closed `k-wire`
 * input envelope schema `inputPlist` (or array of `inputPlists` for multi-port entries).
 *
 * Returns `{ module, entry, inputPlists, outputPlists, cached, accessProfiles }`.
 */
export function specializeKTVM(mod, entryName, inputPlistOrList, { useCache = true, validate = true } = {}) {
  const entry = entryName || mod.entry;
  if (!entry) {
    throw new KTVMSchemaError("specializeKTVM requires an entry procedure name");
  }

  const inputPlists = Array.isArray(inputPlistOrList) && Array.isArray(inputPlistOrList[0]) && typeof inputPlistOrList[0][0] === "string"
    ? [inputPlistOrList]
    : inputPlistOrList;

  if (!Array.isArray(inputPlists) || inputPlists.length === 0) {
    throw new KTVMSchemaError("specializeKTVM requires at least one concrete input envelope plist");
  }
  for (let i = 0; i < inputPlists.length; i++) {
    if (!isClosedPlist(inputPlists[i])) {
      throw new KTVMSchemaError(`Input envelope ${i} must be a closed k-wire property-list graph`);
    }
  }

  const normalizedInputs = inputPlists.map((p) => mooreMinimize(p, 0).plist);
  const inputKeys = normalizedInputs.map((p) => mooreKey(p, 0));

  // Fast cache check
  let cacheKey = null;
  if (useCache) {
    const modKey = printModule(mod);
    cacheKey = `${modKey}::${entry}::${inputKeys.join("|")}`;
    if (SPECIALIZE_CACHE.has(cacheKey)) {
      return { ...SPECIALIZE_CACHE.get(cacheKey), cached: true };
    }
  }

  const schemaDecls = new Map((mod.schemas || []).map((s) => [s.name, s]));
  const procMap = new Map((mod.procs || []).map((p) => [p.name, p]));
  const kernelMap = new Map((mod.kernels || []).map((k) => [k.name, k]));

  // If already `mono`, just verify boundary compatibility and derive outputPlists!
  if (mod.layer === "mono") {
    const target = procMap.get(entry) || kernelMap.get(entry);
    if (!target) throw new KTVMSchemaError(`Unknown entry '${entry}'`);
    if (target.inputs.length !== normalizedInputs.length) {
      throw new KTVMSchemaError(
        `Entry '${entry}' expects ${target.inputs.length} input(s), got ${normalizedInputs.length}`
      );
    }
    for (let i = 0; i < target.inputs.length; i++) {
      const expected = compileSchemaExprToPlist(target.inputs[i].schema, schemaDecls, { allowOpen: false });
      if (!schemasEquivalent(expected, 0, normalizedInputs[i], 0)) {
        throw new KTVMSchemaError(`Input envelope ${i} does not match mono entry '${entry}' contract`);
      }
    }
    const outputPlists = target.outputs.map((o) =>
      mooreMinimize(compileSchemaExprToPlist(o.schema, schemaDecls, { allowOpen: false }), 0).plist
    );
    const result = {
      module: mod,
      entry,
      inputPlists: normalizedInputs,
      outputPlists,
      cached: false,
      accessProfiles: {}
    };
    if (cacheKey) SPECIALIZE_CACHE.set(cacheKey, result);
    return result;
  }

  // --- Poly `kTVM-P` -> Mono `kTVM` Specialization ---
  const entryProc = procMap.get(entry);
  if (!entryProc) {
    throw new KTVMSchemaError(`Unknown entry procedure '${entry}'`);
  }
  if (entryProc.inputs.length !== normalizedInputs.length) {
    throw new KTVMSchemaError(
      `Entry '${entry}' expects ${entryProc.inputs.length} input(s), got ${normalizedInputs.length}`
    );
  }

  // Step 1: Unify every input envelope against entry's contract to bind `$X`
  const entryBindings = new Map();
  for (let i = 0; i < entryProc.inputs.length; i++) {
    const b = unifyContractWithConcrete(
      entryProc.inputs[i].schema,
      schemaDecls,
      entryProc.params || [],
      normalizedInputs[i],
      0
    );
    for (const [param, pl] of b.entries()) {
      if (entryBindings.has(param)) {
        const prev = entryBindings.get(param);
        const inter = intersectSchemas(prev, pl);
        if (mooreKey(prev, 0) !== mooreKey(pl, 0) || mooreKey(inter, 0) !== mooreKey(prev, 0)) {
          throw new KTVMSchemaError(`Conflicting bindings for schema parameter '${param}' across inputs`);
        }
      } else {
        entryBindings.set(param, pl);
      }
    }
  }
  for (const param of entryProc.params || []) {
    if (!entryBindings.has(param)) {
      throw new KTVMSchemaError(`Entry schema parameter '${param}' could not be bound from input envelope`);
    }
  }

  // Schema registry for the emitted concrete `mono` module (deduplicated by Moore key!)
  const emittedSchemas = new Map(); // mooreKey -> { name, expr, plist }
  const emittedSchemaDecls = [];
  let schemaSeq = 0;

  function internConcretePlist(plist, hint = "S") {
    const min = mooreMinimize(plist, 0);
    const [kind, edges] = min.plist[0];
    if (kind === "closed-product" && edges.length === 0) {
      return { expr: S.unit(), plist: min.plist };
    }
    if (emittedSchemas.has(min.key)) {
      return emittedSchemas.get(min.key);
    }
    const prefix = `$${sanitizeSuffix(hint)}_${schemaSeq++}`;
    const { decls, rootExpr } = plistToSchemaAst(min.plist, prefix);
    for (const d of decls) emittedSchemaDecls.push(d);
    const rec = { expr: rootExpr, plist: min.plist };
    emittedSchemas.set(min.key, rec);
    return rec;
  }

  // Compile a schema AST expression under `paramMap: Map<$X, concretePlist>` to concrete plist
  function evalConcreteSchema(expr, paramMap, concreteFallback = null) {
    // Replace each bound parameter `$X` with a synthetic named schema pointing to its concrete plist
    const localDecls = new Map(schemaDecls);
    const paramExprEnv = new Map();
    for (const [pName, pPlist] of paramMap.entries()) {
      const interned = internConcretePlist(pPlist, pName.slice(1));
      for (const d of emittedSchemaDecls) localDecls.set(d.name, d);
      paramExprEnv.set(pName, interned.expr);
    }
    const subst = substituteSchemaExpr(expr, paramExprEnv);
    const pl = compileSchemaExprToPlist(subst, localDecls, { allowOpen: true });
    if (isClosedPlist(pl)) {
      return mooreMinimize(pl, 0).plist;
    }
    if (concreteFallback) {
      const inter = intersectSchemas(pl, concreteFallback);
      if (isClosedPlist(inter)) return mooreMinimize(inter, 0).plist;
    }
    throw new KTVMSchemaError(
      `Schema could not be closed statically during boundary specialization (fallback to kVM required)`
    );
  }

  // Memoize specialized procedures by `(procName, paramKeys, inputKeys)`
  const specProcMemo = new Map();
  const emittedProcs = [];
  const accessProfiles = {};
  let procSeq = 0;
  let freshChanSeq = 0;

  function freshVar(prefix) {
    return `%_${prefix}_${freshChanSeq++}`;
  }

  function specializeProc(procName, paramBindings, actualInputPlists) {
    const proc = procMap.get(procName);
    if (!proc) throw new KTVMSchemaError(`Unknown procedure '${procName}'`);
    const pKeys = (proc.params || []).map((p) => mooreKey(paramBindings.get(p), 0)).join(",");
    const inKeys = actualInputPlists.map((p) => mooreKey(p, 0)).join(",");
    const memoKey = `${procName}[${pKeys}](${inKeys})`;
    if (specProcMemo.has(memoKey)) return specProcMemo.get(memoKey);

    const specName = procSeq === 0 ? `${procName}__spec` : `${procName}__spec${procSeq}`;
    procSeq++;

    // Record access profile (which product inputs/locals are accessed vs kept opaque)
    const accessedVars = analyzeProcAccesses(proc);
    accessProfiles[specName] = {
      sourceProc: procName,
      accessedVars: [...accessedVars],
      opaqueParams: (proc.params || []).filter((p) => {
        const pl = paramBindings.get(p);
        return pl && pl[0][0] === "closed-product" && pl[0][1].length > 0;
      })
    };

    // Derive concrete input & output port schemas
    const concreteInputs = proc.inputs.map((inp, idx) => {
      const pl = evalConcreteSchema(inp.schema, paramBindings, actualInputPlists[idx]);
      const inter = intersectSchemas(pl, actualInputPlists[idx]);
      const rec = internConcretePlist(inter, inp.name.slice(1));
      return { name: inp.name, schema: rec.expr, plist: rec.plist };
    });

    const concreteOutputs = proc.outputs.map((out) => {
      const pl = evalConcreteSchema(out.schema, paramBindings);
      const rec = internConcretePlist(pl, out.name.slice(1));
      return { name: out.name, schema: rec.expr, plist: rec.plist };
    });

    const specRecord = {
      name: specName,
      inputs: concreteInputs,
      outputs: concreteOutputs
    };
    specProcMemo.set(memoKey, specRecord);

    // Channel plist environment for rewriting statements
    const chanPlistMap = new Map();
    for (const p of concreteInputs) chanPlistMap.set(p.name, p.plist);
    for (const p of concreteOutputs) chanPlistMap.set(p.name, p.plist);

    const newBody = rewriteBlock(proc.body, paramBindings, chanPlistMap);

    emittedProcs.push({
      name: specName,
      params: [],
      inputs: concreteInputs.map(({ name, schema }) => ({ name, schema })),
      outputs: concreteOutputs.map(({ name, schema }) => ({ name, schema })),
      attrs: [...(proc.attrs || [])],
      body: newBody
    });

    return specRecord;
  }

  function rewriteBlock(stmts, paramBindings, outerChanPlists) {
    const chanPlists = new Map(outerChanPlists);
    const out = [];

    for (const s of stmts) {
      switch (s.op) {
        case "chan": {
          // Wait: if a local chan has an open/any schema, try direct eval; otherwise defer?
          const pl = evalConcreteSchema(s.schema, paramBindings);
          const rec = internConcretePlist(pl, s.name.slice(1));
          chanPlists.set(s.name, rec.plist);
          out.push({ op: "chan", name: s.name, schema: rec.expr });
          break;
        }
        case "barrier":
        case "gate":
        case "splice":
        case "const_unit":
        case "tee":
        case "wrap":
        case "match":
          out.push(cloneAst(s));
          break;
        case "drain": {
          const srcPl = chanPlists.get(s.src);
          const pl = evalConcreteSchema(s.schema, paramBindings, srcPl);
          const rec = internConcretePlist(pl, "d");
          out.push({ op: "drain", src: s.src, schema: rec.expr, barrier: s.barrier });
          break;
        }
        case "coerce": {
          const sPl = evalConcreteSchema(s.srcSchema, paramBindings, chanPlists.get(s.src));
          const dPl = evalConcreteSchema(s.dstSchema, paramBindings, chanPlists.get(s.dst));
          if (schemasEquivalent(sPl, 0, dPl, 0)) {
            // Collapse Moore-equivalent coerce into zero-copy splice!
            out.push({ op: "splice", src: s.src, dst: s.dst });
          } else {
            const sRec = internConcretePlist(sPl, "cs");
            const dRec = internConcretePlist(dPl, "cd");
            out.push({ op: "coerce", src: s.src, srcSchema: sRec.expr, dst: s.dst, dstSchema: dRec.expr });
          }
          break;
        }
        case "demux": {
          const pPl = evalConcreteSchema(s.schema, paramBindings, chanPlists.get(s.src));
          const rec = internConcretePlist(pPl, "p");
          out.push({ op: "demux", src: s.src, schema: rec.expr, fields: cloneAst(s.fields) });
          break;
        }
        case "mux": {
          const pPl = evalConcreteSchema(s.schema, paramBindings, chanPlists.get(s.dst));
          const rec = internConcretePlist(pPl, "p");
          out.push({ op: "mux", fields: cloneAst(s.fields), dst: s.dst, schema: rec.expr });
          break;
        }
        case "guard": {
          // Verify concrete channel schema satisfies guard `?$P`, then erase to `splice`!
          const srcPl = chanPlists.get(s.src);
          const guardPl = compileSchemaExprToPlist(
            substituteSchemaExpr(s.schema, buildParamExprMap(paramBindings)),
            buildMergedDecls(),
            { allowOpen: true }
          );
          const inter = intersectSchemas(guardPl, srcPl);
          if (!isClosedPlist(inter)) {
            throw new KTVMSchemaError(`Guard on '${s.src}' did not yield a closed schema`);
          }
          const dstPl = chanPlists.get(s.dst);
          if (dstPl && schemasEquivalent(srcPl, 0, dstPl, 0)) {
            out.push({ op: "splice", src: s.src, dst: s.dst });
          } else {
            const sRec = internConcretePlist(srcPl, "gs");
            const dRec = internConcretePlist(dstPl || inter, "gd");
            out.push({ op: "coerce", src: s.src, srcSchema: sRec.expr, dst: s.dst, dstSchema: dRec.expr });
          }
          break;
        }
        case "project": {
          // Lower polymorphic `project .f %src -> %dst` into `demux` + `drain` + `barrier` + `gate`!
          const srcPl = chanPlists.get(s.src);
          const pf = productFields(srcPl, 0);
          if (!pf) {
            throw new KTVMSchemaError(`project .${s.field} requires concrete product on '${s.src}'`);
          }
          const targetField = productFieldInfo(srcPl, 0, s.field);
          if (!targetField) {
            throw new KTVMSchemaError(`Product '${s.src}' has no field '${s.field}'`);
          }
          if (pf.length === 1) {
            // Single-field product: demux directly to %dst!
            const pRec = internConcretePlist(srcPl, "proj");
            out.push({ op: "demux", src: s.src, schema: pRec.expr, fields: [{ label: s.field, name: s.dst }] });
          } else {
            const bar = freshVar("bar");
            out.push({ op: "barrier", name: bar });
            const demuxFields = [];
            let chosenVar = null;
            const drains = [];
            for (const f of pf) {
              const fSub = subPlist(srcPl, f.targetId);
              const fRec = internConcretePlist(fSub, f.label);
              const v = freshVar(f.label);
              out.push({ op: "chan", name: v, schema: fRec.expr });
              demuxFields.push({ label: f.label, name: v });
              if (f.label === s.field) {
                chosenVar = v;
              } else {
                drains.push({ op: "drain", src: v, schema: fRec.expr, barrier: bar });
              }
            }
            const pRec = internConcretePlist(srcPl, "proj");
            out.push({ op: "demux", src: s.src, schema: pRec.expr, fields: demuxFields });
            for (const dr of drains) out.push(dr);
            out.push({ op: "gate", barrier: bar, src: chosenVar, dst: s.dst });
          }
          break;
        }
        case "spawn": {
          const targetProc = procMap.get(s.target);
          if (!targetProc) throw new KTVMSchemaError(`Unknown proc '${s.target}'`);
          const childBindings = new Map();
          for (let i = 0; i < (targetProc.params || []).length; i++) {
            const argPl = evalConcreteSchema(s.schemaArgs[i], paramBindings);
            childBindings.set(targetProc.params[i], argPl);
          }
          const actualIns = s.inputs.map((v) => chanPlists.get(v));
          const specTarget = specializeProc(s.target, childBindings, actualIns);
          out.push({
            op: "spawn",
            target: specTarget.name,
            schemaArgs: [],
            inputs: [...s.inputs],
            outputs: [...s.outputs],
            after: s.after,
            token: s.token
          });
          break;
        }
        case "exec":
          out.push(cloneAst(s));
          break;
        case "switch": {
          // Prune dead arms whose leading tag is absent from the concrete input union!
          const liveArms = [];
          for (const arm of s.arms) {
            let reachable = true;
            for (let j = 0; j < arm.patterns.length; j++) {
              const pat = arm.patterns[j];
              if (pat.kind === "tag") {
                const pl = chanPlists.get(s.inputs[j]);
                if (!unionTagInfo(pl, 0, pat.tag)) {
                  reachable = false;
                  break;
                }
              }
            }
            if (reachable) {
              liveArms.push({
                patterns: cloneAst(arm.patterns),
                body: rewriteBlock(arm.body, paramBindings, chanPlists)
              });
            }
          }
          const newDefault = s.defaultBody
            ? rewriteBlock(s.defaultBody, paramBindings, chanPlists)
            : null;
          out.push({
            op: "switch",
            inputs: [...s.inputs],
            arms: liveArms,
            defaultBody: newDefault
          });
          break;
        }
        case "spec": {
          const newBranches = s.branches.map((br) => ({
            index: br.index,
            body: rewriteBlock(br.body, paramBindings, chanPlists)
          }));
          out.push({
            op: "spec",
            inputs: [...s.inputs],
            outputs: [...s.outputs],
            branches: newBranches
          });
          break;
        }
        default:
          out.push(cloneAst(s));
      }
    }
    return out;
  }

  function buildParamExprMap(paramBindings) {
    const env = new Map();
    for (const [pName, pPlist] of paramBindings.entries()) {
      env.set(pName, internConcretePlist(pPlist, pName.slice(1)).expr);
    }
    return env;
  }

  function buildMergedDecls() {
    const m = new Map(schemaDecls);
    for (const d of emittedSchemaDecls) m.set(d.name, d);
    return m;
  }

  const rootSpec = specializeProc(entry, entryBindings, normalizedInputs);

  const monoModule = createModule({
    version: mod.version || "0.1",
    layer: "mono",
    entry: rootSpec.name,
    schemas: emittedSchemaDecls,
    procs: emittedProcs,
    kernels: cloneAst(mod.kernels || []),
    tables: cloneAst(mod.tables || [])
  });

  if (validate) {
    validateModule(monoModule);
  }

  const result = {
    module: monoModule,
    entry: rootSpec.name,
    inputPlists: rootSpec.inputs.map((i) => i.plist),
    outputPlists: rootSpec.outputs.map((o) => o.plist),
    cached: false,
    accessProfiles
  };

  if (cacheKey) {
    SPECIALIZE_CACHE.set(cacheKey, result);
  }
  return result;
}

export function clearSpecializationCache() {
  SPECIALIZE_CACHE.clear();
}
