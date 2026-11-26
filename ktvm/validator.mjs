/**
 * Static validator for kTVM-P (`poly`) and concrete kTVM (`mono`) modules.
 *
 * Enforces all 6 static soundness rules from DOCS/KTVM_SPEC.md §8:
 *   1. Schema well-formedness (no unresolved refs, unique canonically-ordered
 *      labels, no unguarded cycles, zero open/any/param nodes in `mono`).
 *   2. SPSC channel linearity inside every `proc` (and every `switch`/`spec` arm).
 *   3. Local DAG acyclicity of channel + `after %tok` scheduling edges.
 *   4. Dual-schema & alignment typing (exact Moore equivalence `≡` in `mono`).
 *   5. Kernel CFG discipline (valid blocks, registers, stacks, retirement).
 *   6. Always-on static table-to-CFG bisimulation check for `verified_against`
 *      tables (opt-out via `{ verifyTables: false }`).
 */

import { KTVMValidationError, collectSwitchOuterIO } from "./ast.mjs";
import {
  compareLabels,
  compileSchemaExprToPlist,
  isUnitSchema,
  productFields,
  schemasEquivalent,
  subPlist,
  unionTagInfo
} from "./schema.mjs";
import { BitDeque, BitStack } from "./bit-deque.mjs";

export function validateModule(mod, { verifyTables = true, maxVerifyEntries = 65536 } = {}) {
  const errors = [];
  const isMono = mod.layer === "mono";

  if (mod.layer !== "poly" && mod.layer !== "mono") {
    errors.push(`Invalid module layer '${mod.layer}'`);
  }

  // Index declarations & check uniqueness
  const schemaMap = new Map();
  for (const s of mod.schemas || []) {
    if (schemaMap.has(s.name)) errors.push(`Duplicate schema '${s.name}'`);
    else schemaMap.set(s.name, s);
  }

  const procMap = new Map();
  for (const p of mod.procs || []) {
    if (procMap.has(p.name)) errors.push(`Duplicate proc '${p.name}'`);
    else procMap.set(p.name, p);
  }

  const kernelMap = new Map();
  for (const k of mod.kernels || []) {
    if (kernelMap.has(k.name) || procMap.has(k.name)) {
      errors.push(`Duplicate proc/kernel name '${k.name}'`);
    } else {
      kernelMap.set(k.name, k);
    }
  }

  const tableMap = new Map();
  for (const t of mod.tables || []) {
    if (tableMap.has(t.name)) errors.push(`Duplicate table '${t.name}'`);
    else tableMap.set(t.name, t);
  }

  if (mod.entry && !procMap.has(mod.entry) && !kernelMap.has(mod.entry)) {
    errors.push(`Entry '${mod.entry}' does not match any proc or kernel`);
  }

  // --- Rule 1: Schema Well-Formedness ---
  function checkSchemaExpr(expr, inScopeParams, ctx) {
    if (!expr) {
      errors.push(`${ctx}: missing schema expression`);
      return;
    }
    switch (expr.kind) {
      case "unit":
        return;
      case "any":
        if (isMono) errors.push(`${ctx}: 'any' schema is forbidden in mono module`);
        return;
      case "open_product":
      case "open_union":
        if (isMono) errors.push(`${ctx}: '${expr.kind}' is forbidden in mono module`);
        // fall through to check labels
      case "product":
      case "union": {
        let prev = null;
        const seen = new Set();
        for (const f of expr.fields || []) {
          if (seen.has(f.label)) {
            errors.push(`${ctx}: duplicate label '${f.label}' in ${expr.kind}`);
          }
          seen.add(f.label);
          if (prev !== null && compareLabels(prev, f.label) >= 0) {
            errors.push(`${ctx}: labels in ${expr.kind} not in canonical order ('${prev}' before '${f.label}')`);
          }
          prev = f.label;
          checkSchemaExpr(f.schema, inScopeParams, `${ctx}.${f.label}`);
        }
        return;
      }
      case "ref": {
        const args = expr.args || [];
        if (args.length === 0 && inScopeParams.has(expr.name)) {
          if (isMono) errors.push(`${ctx}: unbound schema param '${expr.name}' in mono module`);
          return;
        }
        const decl = schemaMap.get(expr.name);
        if (!decl) {
          errors.push(`${ctx}: unknown schema '${expr.name}'`);
          return;
        }
        if (args.length !== (decl.params || []).length) {
          errors.push(`${ctx}: schema '${expr.name}' expects ${(decl.params || []).length} args, got ${args.length}`);
        }
        for (const a of args) checkSchemaExpr(a, inScopeParams, ctx);
        return;
      }
      default:
        errors.push(`${ctx}: unknown schema kind '${expr.kind}'`);
    }
  }

  for (const s of mod.schemas || []) {
    if (isMono && s.params && s.params.length > 0) {
      errors.push(`schema ${s.name}: schema parameters are forbidden in mono module`);
    }
    const pset = new Set(s.params || []);
    checkSchemaExpr(s.expr, pset, `schema ${s.name}`);
    // Check unguarded direct cycle (e.g. schema $A = $A;)
    if (s.expr.kind === "ref" && !pset.has(s.expr.name)) {
      const seen = new Set([s.name]);
      let cur = s.expr;
      while (cur && cur.kind === "ref" && schemaMap.has(cur.name)) {
        if (seen.has(cur.name)) {
          errors.push(`schema ${s.name}: unguarded direct cycle through '${cur.name}'`);
          break;
        }
        seen.add(cur.name);
        cur = schemaMap.get(cur.name).expr;
      }
    }
  }

  // Helper to resolve a schema expr to plist in mono mode (returns null if invalid/poly)
  const plistCache = new Map();
  function resolveMonoPlist(expr, ctx) {
    if (!isMono) return null;
    try {
      const key = JSON.stringify(expr);
      if (plistCache.has(key)) return plistCache.get(key);
      const pl = compileSchemaExprToPlist(expr, schemaMap, { allowOpen: false });
      plistCache.set(key, pl);
      return pl;
    } catch (err) {
      errors.push(`${ctx}: ${err.message}`);
      return null;
    }
  }

  // --- Rules 2, 3, 4: Procedures ---
  for (const proc of mod.procs || []) {
    if (isMono && proc.params && proc.params.length > 0) {
      errors.push(`proc ${proc.name}: schema parameters are forbidden in mono module`);
    }
    const pset = new Set(proc.params || []);
    const baseChanTypes = new Map();
    const inputNames = new Set();
    const outputNames = new Set();

    for (const p of proc.inputs) {
      if (baseChanTypes.has(p.name)) errors.push(`proc ${proc.name}: duplicate port '${p.name}'`);
      checkSchemaExpr(p.schema, pset, `proc ${proc.name}(${p.name})`);
      baseChanTypes.set(p.name, { expr: p.schema, plist: resolveMonoPlist(p.schema, `proc ${proc.name}(${p.name})`) });
      inputNames.add(p.name);
    }
    for (const p of proc.outputs) {
      if (baseChanTypes.has(p.name)) errors.push(`proc ${proc.name}: duplicate port '${p.name}'`);
      checkSchemaExpr(p.schema, pset, `proc ${proc.name}->(${p.name})`);
      baseChanTypes.set(p.name, { expr: p.schema, plist: resolveMonoPlist(p.schema, `proc ${proc.name}->(${p.name})`) });
      outputNames.add(p.name);
    }

    validateBlock(proc.body, {
      ctx: `proc ${proc.name}`,
      pset,
      outerChans: baseChanTypes,
      requiredConsumes: new Set(inputNames),
      requiredProduces: new Set(outputNames),
      outerBarriers: new Set(),
      outerTokens: new Set()
    });
  }

  function validateBlock(stmts, { ctx, pset, outerChans, requiredConsumes, requiredProduces, outerBarriers, outerTokens }) {
    const chanTypes = new Map(outerChans);
    const localChans = new Set();
    const barriers = new Set(outerBarriers);
    const tokens = new Set(outerTokens);

    const produced = new Map(); // varName -> stmtIndex[]
    const consumed = new Map(); // varName -> stmtIndex[]
    const tokenToStmt = new Map(); // %tok -> stmtIndex

    const markProd = (v, idx) => {
      if (!chanTypes.has(v)) errors.push(`${ctx}: undeclared channel '${v}'`);
      if (!produced.has(v)) produced.set(v, []);
      produced.get(v).push(idx);
    };
    const markCons = (v, idx) => {
      if (!chanTypes.has(v)) errors.push(`${ctx}: undeclared channel '${v}'`);
      if (!consumed.has(v)) consumed.set(v, []);
      consumed.get(v).push(idx);
    };

    // Pass A: collect declarations and producer/consumer counts
    for (let idx = 0; idx < stmts.length; idx++) {
      const s = stmts[idx];
      switch (s.op) {
        case "chan":
          if (chanTypes.has(s.name)) errors.push(`${ctx}: duplicate channel '${s.name}'`);
          checkSchemaExpr(s.schema, pset, `${ctx} chan ${s.name}`);
          chanTypes.set(s.name, { expr: s.schema, plist: resolveMonoPlist(s.schema, `${ctx} chan ${s.name}`) });
          localChans.add(s.name);
          break;
        case "barrier":
          if (barriers.has(s.name)) errors.push(`${ctx}: duplicate barrier '${s.name}'`);
          barriers.add(s.name);
          break;
        case "drain":
          checkSchemaExpr(s.schema, pset, `${ctx} drain ${s.src}`);
          markCons(s.src, idx);
          if (s.barrier && !barriers.has(s.barrier)) {
            errors.push(`${ctx}: drain references undeclared barrier '${s.barrier}'`);
          }
          if (isMono) {
            const cPl = chanTypes.get(s.src)?.plist;
            const dPl = resolveMonoPlist(s.schema, `${ctx} drain ${s.src}`);
            if (cPl && dPl && !schemasEquivalent(cPl, 0, dPl, 0)) {
              errors.push(`${ctx}: drain schema mismatch on '${s.src}'`);
            }
          }
          break;
        case "gate":
          if (!barriers.has(s.barrier)) errors.push(`${ctx}: gate references undeclared barrier '${s.barrier}'`);
          markCons(s.src, idx);
          markProd(s.dst, idx);
          if (isMono) {
            const sPl = chanTypes.get(s.src)?.plist;
            const dPl = chanTypes.get(s.dst)?.plist;
            if (sPl && dPl && !schemasEquivalent(sPl, 0, dPl, 0)) {
              errors.push(`${ctx}: gate schema mismatch '${s.src}' -> '${s.dst}'`);
            }
          }
          break;
        case "splice":
          markCons(s.src, idx);
          markProd(s.dst, idx);
          if (isMono) {
            const sPl = chanTypes.get(s.src)?.plist;
            const dPl = chanTypes.get(s.dst)?.plist;
            if (sPl && dPl && !schemasEquivalent(sPl, 0, dPl, 0)) {
              errors.push(`${ctx}: splice schema mismatch '${s.src}' -> '${s.dst}'`);
            }
          }
          break;
        case "coerce":
          checkSchemaExpr(s.srcSchema, pset, `${ctx} coerce src`);
          checkSchemaExpr(s.dstSchema, pset, `${ctx} coerce dst`);
          markCons(s.src, idx);
          markProd(s.dst, idx);
          break;
        case "const_unit":
          markProd(s.dst, idx);
          if (isMono) {
            const dPl = chanTypes.get(s.dst)?.plist;
            if (dPl && !isUnitSchema(dPl, 0)) {
              errors.push(`${ctx}: const_unit target '${s.dst}' is not 'unit'`);
            }
          }
          break;
        case "tee":
          if (s.dsts.length === 0) errors.push(`${ctx}: tee must have at least one output`);
          markCons(s.src, idx);
          for (const d of s.dsts) {
            markProd(d, idx);
            if (isMono) {
              const sPl = chanTypes.get(s.src)?.plist;
              const dPl = chanTypes.get(d)?.plist;
              if (sPl && dPl && !schemasEquivalent(sPl, 0, dPl, 0)) {
                errors.push(`${ctx}: tee output '${d}' schema does not match '${s.src}'`);
              }
            }
          }
          break;
        case "wrap":
          markCons(s.src, idx);
          markProd(s.dst, idx);
          if (isMono) {
            const sPl = chanTypes.get(s.src)?.plist;
            const dPl = chanTypes.get(s.dst)?.plist;
            if (dPl) {
              const info = unionTagInfo(dPl, 0, s.tag);
              if (!info) {
                errors.push(`${ctx}: wrap |${s.tag} not valid for union '${s.dst}'`);
              } else if (sPl && !schemasEquivalent(sPl, 0, dPl, info.targetId)) {
                errors.push(`${ctx}: wrap |${s.tag} payload '${s.src}' does not match variant target`);
              }
            }
          }
          break;
        case "match":
          markCons(s.src, idx);
          markProd(s.dst, idx);
          if (isMono) {
            const sPl = chanTypes.get(s.src)?.plist;
            const dPl = chanTypes.get(s.dst)?.plist;
            if (sPl) {
              const info = unionTagInfo(sPl, 0, s.tag);
              if (!info) {
                errors.push(`${ctx}: match /${s.tag} not valid for union '${s.src}'`);
              } else if (dPl && !schemasEquivalent(sPl, info.targetId, dPl, 0)) {
                errors.push(`${ctx}: match /${s.tag} output '${s.dst}' does not match variant payload`);
              }
            }
          }
          break;
        case "demux":
          checkSchemaExpr(s.schema, pset, `${ctx} demux`);
          markCons(s.src, idx);
          for (const f of s.fields) markProd(f.name, idx);
          if (isMono) {
            const sPl = chanTypes.get(s.src)?.plist;
            const pPl = resolveMonoPlist(s.schema, `${ctx} demux`);
            if (sPl && pPl && !schemasEquivalent(sPl, 0, pPl, 0)) {
              errors.push(`${ctx}: demux schema does not match '${s.src}'`);
            }
            if (pPl) {
              const pf = productFields(pPl, 0);
              if (!pf) {
                errors.push(`${ctx}: demux schema on '${s.src}' is not a product`);
              } else if (pf.length !== s.fields.length) {
                errors.push(`${ctx}: demux field count mismatch on '${s.src}'`);
              } else {
                const byLabel = new Map(pf.map((x) => [x.label, x.targetId]));
                for (const f of s.fields) {
                  if (!byLabel.has(f.label)) {
                    errors.push(`${ctx}: demux unknown field '${f.label}'`);
                  } else {
                    const cPl = chanTypes.get(f.name)?.plist;
                    if (cPl && !schemasEquivalent(pPl, byLabel.get(f.label), cPl, 0)) {
                      errors.push(`${ctx}: demux field '${f.label}' -> '${f.name}' schema mismatch`);
                    }
                  }
                }
              }
            }
          }
          break;
        case "mux":
          checkSchemaExpr(s.schema, pset, `${ctx} mux`);
          for (const f of s.fields) markCons(f.name, idx);
          markProd(s.dst, idx);
          if (isMono) {
            const dPl = chanTypes.get(s.dst)?.plist;
            const pPl = resolveMonoPlist(s.schema, `${ctx} mux`);
            if (dPl && pPl && !schemasEquivalent(dPl, 0, pPl, 0)) {
              errors.push(`${ctx}: mux schema does not match '${s.dst}'`);
            }
            if (pPl) {
              const pf = productFields(pPl, 0);
              if (!pf) {
                errors.push(`${ctx}: mux schema on '${s.dst}' is not a product`);
              } else if (pf.length !== s.fields.length) {
                errors.push(`${ctx}: mux field count mismatch on '${s.dst}'`);
              } else {
                const byLabel = new Map(pf.map((x) => [x.label, x.targetId]));
                for (const f of s.fields) {
                  if (!byLabel.has(f.label)) {
                    errors.push(`${ctx}: mux unknown field '${f.label}'`);
                  } else {
                    const cPl = chanTypes.get(f.name)?.plist;
                    if (cPl && !schemasEquivalent(cPl, 0, pPl, byLabel.get(f.label))) {
                      errors.push(`${ctx}: mux field '${f.label}' (${f.name}) schema mismatch`);
                    }
                  }
                }
              }
            }
          }
          break;
        case "project":
          if (isMono) errors.push(`${ctx}: polymorphic 'project' is forbidden in mono module`);
          checkSchemaExpr(s.srcSchema, pset, `${ctx} project src`);
          checkSchemaExpr(s.dstSchema, pset, `${ctx} project dst`);
          markCons(s.src, idx);
          markProd(s.dst, idx);
          break;
        case "guard":
          if (isMono) errors.push(`${ctx}: polymorphic 'guard' is forbidden in mono module`);
          checkSchemaExpr(s.schema, pset, `${ctx} guard`);
          markCons(s.src, idx);
          markProd(s.dst, idx);
          break;
        case "spawn": {
          const target = procMap.get(s.target);
          if (!target) {
            errors.push(`${ctx}: spawn references unknown proc '${s.target}'`);
          } else {
            if (s.inputs.length !== target.inputs.length || s.outputs.length !== target.outputs.length) {
              errors.push(`${ctx}: spawn ${s.target} port arity mismatch`);
            }
            if ((s.schemaArgs || []).length !== (target.params || []).length) {
              errors.push(`${ctx}: spawn ${s.target} schema argument arity mismatch`);
            }
            for (const a of s.schemaArgs || []) checkSchemaExpr(a, pset, `${ctx} spawn ${s.target}`);
            if (isMono) {
              for (let i = 0; i < Math.min(s.inputs.length, target.inputs.length); i++) {
                const aPl = chanTypes.get(s.inputs[i])?.plist;
                const tPl = resolveMonoPlist(target.inputs[i].schema, `${ctx} spawn ${s.target}`);
                if (aPl && tPl && !schemasEquivalent(aPl, 0, tPl, 0)) {
                  errors.push(`${ctx}: spawn ${s.target} input ${i} ('${s.inputs[i]}') schema mismatch`);
                }
              }
              for (let i = 0; i < Math.min(s.outputs.length, target.outputs.length); i++) {
                const aPl = chanTypes.get(s.outputs[i])?.plist;
                const tPl = resolveMonoPlist(target.outputs[i].schema, `${ctx} spawn ${s.target}`);
                if (aPl && tPl && !schemasEquivalent(aPl, 0, tPl, 0)) {
                  errors.push(`${ctx}: spawn ${s.target} output ${i} ('${s.outputs[i]}') schema mismatch`);
                }
              }
            }
          }
          if (s.after && !tokens.has(s.after)) {
            errors.push(`${ctx}: spawn after references unknown token '${s.after}'`);
          }
          if (s.token) {
            if (tokens.has(s.token)) errors.push(`${ctx}: duplicate spawn token '${s.token}'`);
            tokens.add(s.token);
            tokenToStmt.set(s.token, idx);
          }
          for (const inp of s.inputs) markCons(inp, idx);
          for (const out of s.outputs) markProd(out, idx);
          break;
        }
        case "exec": {
          const target = kernelMap.get(s.target);
          if (!target) {
            errors.push(`${ctx}: exec references unknown kernel '${s.target}'`);
          } else {
            if (s.inputs.length !== target.inputs.length || s.outputs.length !== target.outputs.length) {
              errors.push(`${ctx}: exec ${s.target} port arity mismatch`);
            }
            if (isMono) {
              for (let i = 0; i < Math.min(s.inputs.length, target.inputs.length); i++) {
                const aPl = chanTypes.get(s.inputs[i])?.plist;
                const tPl = resolveMonoPlist(target.inputs[i].schema, `${ctx} exec ${s.target}`);
                if (aPl && tPl && !schemasEquivalent(aPl, 0, tPl, 0)) {
                  errors.push(`${ctx}: exec ${s.target} input ${i} schema mismatch`);
                }
              }
              for (let i = 0; i < Math.min(s.outputs.length, target.outputs.length); i++) {
                const aPl = chanTypes.get(s.outputs[i])?.plist;
                const tPl = resolveMonoPlist(target.outputs[i].schema, `${ctx} exec ${s.target}`);
                if (aPl && tPl && !schemasEquivalent(aPl, 0, tPl, 0)) {
                  errors.push(`${ctx}: exec ${s.target} output ${i} schema mismatch`);
                }
              }
            }
          }
          for (const inp of s.inputs) markCons(inp, idx);
          for (const out of s.outputs) markProd(out, idx);
          break;
        }
        case "switch": {
          for (const inp of s.inputs) {
            if (!chanTypes.has(inp)) errors.push(`${ctx}: switch references undeclared channel '${inp}'`);
          }
          // Determine the exact outer channels consumed/produced by the switch from its
          // first branch (supporting both terminal and mid-block / nested switches!).
          const firstBody = s.arms.length > 0 ? s.arms[0].body : (s.defaultBody || []);
          const { cons: swCons, prod: swProd } = collectSwitchOuterIO(firstBody, chanTypes);

          for (let a = 0; a < s.arms.length; a++) {
            const arm = s.arms[a];
            if (arm.patterns.length !== s.inputs.length) {
              errors.push(`${ctx}: switch arm ${a} pattern arity mismatch`);
            } else if (isMono) {
              for (let j = 0; j < arm.patterns.length; j++) {
                const pat = arm.patterns[j];
                if (pat.kind === "tag") {
                  const pl = chanTypes.get(s.inputs[j])?.plist;
                  if (pl && !unionTagInfo(pl, 0, pat.tag)) {
                    errors.push(`${ctx}: switch arm ${a} tag /${pat.tag} invalid for '${s.inputs[j]}'`);
                  }
                }
              }
            }
            validateBlock(arm.body, {
              ctx: `${ctx} switch.case[${a}]`,
              pset,
              outerChans: chanTypes,
              requiredConsumes: swCons,
              requiredProduces: swProd,
              outerBarriers: barriers,
              outerTokens: tokens
            });
          }
          if (s.defaultBody) {
            validateBlock(s.defaultBody, {
              ctx: `${ctx} switch.default`,
              pset,
              outerChans: chanTypes,
              requiredConsumes: swCons,
              requiredProduces: swProd,
              outerBarriers: barriers,
              outerTokens: tokens
            });
          }
          for (const v of swCons) markCons(v, idx);
          for (const v of swProd) markProd(v, idx);
          break;
        }
        case "spec": {
          const specIn = new Set(s.inputs);
          const specOut = new Set(s.outputs);
          for (const inp of s.inputs) markCons(inp, idx);
          for (const out of s.outputs) markProd(out, idx);
          for (let b = 0; b < s.branches.length; b++) {
            const br = s.branches[b];
            const branchChans = new Map();
            for (const v of [...s.inputs, ...s.outputs]) {
              if (chanTypes.has(v)) branchChans.set(v, chanTypes.get(v));
            }
            validateBlock(br.body, {
              ctx: `${ctx} spec.branch[${br.index}]`,
              pset,
              outerChans: branchChans,
              requiredConsumes: specIn,
              requiredProduces: specOut,
              outerBarriers: new Set(),
              outerTokens: new Set()
            });
          }
          break;
        }
      }
    }

    // Check SPSC linearity counts
    for (const v of requiredConsumes) {
      const c = (consumed.get(v) || []).length;
      const p = (produced.get(v) || []).length;
      if (c !== 1) errors.push(`${ctx}: input channel '${v}' must be consumed exactly once (found ${c})`);
      if (p !== 0) errors.push(`${ctx}: input channel '${v}' must not be produced locally (found ${p})`);
    }
    for (const v of requiredProduces) {
      const p = (produced.get(v) || []).length;
      const c = (consumed.get(v) || []).length;
      if (p !== 1) errors.push(`${ctx}: output channel '${v}' must be produced exactly once (found ${p})`);
      if (c !== 0) errors.push(`${ctx}: output channel '${v}' must not be consumed locally (found ${c})`);
    }
    for (const v of localChans) {
      const p = (produced.get(v) || []).length;
      const c = (consumed.get(v) || []).length;
      if (p !== 1) errors.push(`${ctx}: local channel '${v}' must have exactly 1 producer (found ${p})`);
      if (c !== 1) errors.push(`${ctx}: local channel '${v}' must have exactly 1 consumer (found ${c})`);
    }

    // --- Rule 3: Local DAG Acyclicity (channel edges + barrier edges + `after %tok` edges) ---
    const nStmts = stmts.length;
    const adj = Array.from({ length: nStmts }, () => []);
    for (const v of localChans) {
      const prods = produced.get(v) || [];
      const conss = consumed.get(v) || [];
      if (prods.length === 1 && conss.length === 1) {
        adj[prods[0]].push(conss[0]);
      }
    }
    // Barrier edges: drain -> gate
    const barrierDrains = new Map();
    for (let idx = 0; idx < nStmts; idx++) {
      const s = stmts[idx];
      if (s.op === "drain" && s.barrier) {
        if (!barrierDrains.has(s.barrier)) barrierDrains.set(s.barrier, []);
        barrierDrains.get(s.barrier).push(idx);
      }
    }
    for (let idx = 0; idx < nStmts; idx++) {
      const s = stmts[idx];
      if (s.op === "gate" && barrierDrains.has(s.barrier)) {
        for (const dIdx of barrierDrains.get(s.barrier)) adj[dIdx].push(idx);
      }
      if (s.op === "spawn" && s.after && tokenToStmt.has(s.after)) {
        adj[tokenToStmt.get(s.after)].push(idx);
      }
    }
    // Cycle detection via 3-color DFS
    const color = new Int8Array(nStmts);
    let hasCycle = false;
    function dfs(u) {
      color[u] = 1;
      for (const v of adj[u]) {
        if (color[v] === 1) { hasCycle = true; return; }
        if (color[v] === 0) dfs(v);
        if (hasCycle) return;
      }
      color[u] = 2;
    }
    for (let i = 0; i < nStmts; i++) {
      if (color[i] === 0) dfs(i);
      if (hasCycle) {
        errors.push(`${ctx}: local channel/barrier/after dependency graph contains a cycle`);
        break;
      }
    }
  }

  // --- Rule 5: Kernel Discipline ---
  for (const k of mod.kernels || []) {
    const ctx = `kernel ${k.name}`;
    const portChans = new Map();
    const inSet = new Set();
    const outSet = new Set();
    for (const p of k.inputs) {
      checkSchemaExpr(p.schema, new Set(), `${ctx}(${p.name})`);
      portChans.set(p.name, resolveMonoPlist(p.schema, `${ctx}(${p.name})`));
      inSet.add(p.name);
    }
    for (const p of k.outputs) {
      checkSchemaExpr(p.schema, new Set(), `${ctx}->(${p.name})`);
      portChans.set(p.name, resolveMonoPlist(p.schema, `${ctx}->(${p.name})`));
      outSet.add(p.name);
    }
    const regMap = new Map();
    for (const r of k.regs || []) {
      if (r.states < 1) errors.push(`${ctx}: reg '${r.name}' must have >= 1 state`);
      if (r.init < 0 || r.init >= r.states) errors.push(`${ctx}: reg '${r.name}' init ${r.init} out of range`);
      regMap.set(r.name, r);
    }
    const stackSet = new Set((k.stacks || []).map((s) => s.name));
    const blockMap = new Map();
    for (const b of k.blocks || []) {
      if (blockMap.has(b.label)) errors.push(`${ctx}: duplicate block '${b.label}'`);
      blockMap.set(b.label, b);
    }
    if (!blockMap.has("entry")) {
      errors.push(`${ctx}: missing required 'entry' block`);
    }

    const checkBlockRef = (lbl, where) => {
      if (!blockMap.has(lbl)) errors.push(`${ctx} ${where}: unknown target block '${lbl}'`);
    };

    for (const b of k.blocks || []) {
      for (const s of b.stmts) {
        switch (s.op) {
          case "peek_bits":
            if (!inSet.has(s.src)) errors.push(`${ctx}.${b.label}: peek_bits unknown input '${s.src}'`);
            if (s.width < 1 || s.width > 32) errors.push(`${ctx}.${b.label}: invalid peek_bits width ${s.width}`);
            checkBlockRef(s.onEof, `${b.label}.peek_bits`);
            break;
          case "shift_bits":
            if (!inSet.has(s.src)) errors.push(`${ctx}.${b.label}: shift_bits unknown input '${s.src}'`);
            break;
          case "shift_tag":
            if (!inSet.has(s.src)) errors.push(`${ctx}.${b.label}: shift_tag unknown input '${s.src}'`);
            checkSchemaExpr(s.nextSchema, new Set(), `${ctx}.${b.label}.shift_tag`);
            break;
          case "push_bits":
          case "unshift_bits":
            if (!outSet.has(s.dst)) errors.push(`${ctx}.${b.label}: ${s.op} unknown output '${s.dst}'`);
            if (s.bits.length !== s.width) {
              errors.push(`${ctx}.${b.label}: ${s.op} literal width ${s.bits.length} != ${s.width}`);
            }
            break;
          case "set_reg":
            if (!regMap.has(s.reg)) errors.push(`${ctx}.${b.label}: unknown reg '${s.reg}'`);
            else if (s.value < 0 || s.value >= regMap.get(s.reg).states) {
              errors.push(`${ctx}.${b.label}: reg '${s.reg}' value ${s.value} out of bounds`);
            }
            break;
          case "stack_push":
            if (!stackSet.has(s.stack)) errors.push(`${ctx}.${b.label}: unknown stack '${s.stack}'`);
            if (s.bits.length !== s.width) {
              errors.push(`${ctx}.${b.label}: stack_push literal width ${s.bits.length} != ${s.width}`);
            }
            break;
          case "stack_pop":
            if (!stackSet.has(s.stack)) errors.push(`${ctx}.${b.label}: unknown stack '${s.stack}'`);
            checkBlockRef(s.onEmpty, `${b.label}.stack_pop`);
            break;
          case "stack_clear":
            if (!stackSet.has(s.stack)) errors.push(`${ctx}.${b.label}: unknown stack '${s.stack}'`);
            break;
          case "drain_guard":
            if (!inSet.has(s.src)) errors.push(`${ctx}.${b.label}: drain_guard unknown input '${s.src}'`);
            checkSchemaExpr(s.schema, new Set(), `${ctx}.${b.label}.drain_guard`);
            break;
          case "dpda_copy":
            if (!inSet.has(s.src) || !outSet.has(s.dst)) {
              errors.push(`${ctx}.${b.label}: dpda_copy invalid port`);
            }
            checkSchemaExpr(s.schema, new Set(), `${ctx}.${b.label}.dpda_copy`);
            break;
          case "dpda_coerce":
            if (!inSet.has(s.src) || !outSet.has(s.dst)) {
              errors.push(`${ctx}.${b.label}: dpda_coerce invalid port`);
            }
            checkSchemaExpr(s.srcSchema, new Set(), `${ctx}.${b.label}.dpda_coerce src`);
            checkSchemaExpr(s.dstSchema, new Set(), `${ctx}.${b.label}.dpda_coerce dst`);
            break;
          case "splice":
            if (!inSet.has(s.src) || !outSet.has(s.dst)) {
              errors.push(`${ctx}.${b.label}: splice invalid port`);
            }
            break;
          case "close":
            if (!outSet.has(s.dst)) errors.push(`${ctx}.${b.label}: close unknown output '${s.dst}'`);
            break;
          case "yield":
            if (!outSet.has(s.dst)) errors.push(`${ctx}.${b.label}: yield unknown output '${s.dst}'`);
            break;
        }
      }

      const t = b.term;
      if (!t) {
        errors.push(`${ctx}.${b.label}: missing block terminator`);
        continue;
      }
      switch (t.op) {
        case "goto":
          checkBlockRef(t.target, `${b.label}.goto`);
          break;
        case "retire":
        case "fail":
          break;
        case "handoff":
          if (!procMap.has(t.target) && !kernelMap.has(t.target)) {
            errors.push(`${ctx}.${b.label}: handoff unknown target '${t.target}'`);
          }
          break;
        case "switch_bits":
          for (const c of t.cases) checkBlockRef(c.target, `${b.label}.switch_bits`);
          if (t.defaultTarget) checkBlockRef(t.defaultTarget, `${b.label}.switch_bits`);
          break;
        case "switch_reg":
          if (!regMap.has(t.reg)) errors.push(`${ctx}.${b.label}: switch_reg unknown reg '${t.reg}'`);
          for (const c of t.cases) checkBlockRef(c.target, `${b.label}.switch_reg`);
          break;
        case "table_step":
          if (!tableMap.has(t.table)) errors.push(`${ctx}.${b.label}: unknown table '${t.table}'`);
          if (!regMap.has(t.reg)) errors.push(`${ctx}.${b.label}: unknown reg '${t.reg}'`);
          for (const lbl of Object.values(t.exits)) checkBlockRef(lbl, `${b.label}.table_step`);
          break;
        case "stack_table_step":
          if (!tableMap.has(t.table)) errors.push(`${ctx}.${b.label}: unknown table '${t.table}'`);
          if (!regMap.has(t.reg)) errors.push(`${ctx}.${b.label}: unknown reg '${t.reg}'`);
          if (!stackSet.has(t.stack)) errors.push(`${ctx}.${b.label}: unknown stack '${t.stack}'`);
          for (const lbl of Object.values(t.exits)) checkBlockRef(lbl, `${b.label}.stack_table_step`);
          break;
        case "fsm_table_step":
          if (!tableMap.has(t.table)) errors.push(`${ctx}.${b.label}: unknown table '${t.table}'`);
          for (const lbl of Object.values(t.exits)) checkBlockRef(lbl, `${b.label}.fsm_table_step`);
          break;
      }
    }
  }

  // --- Rule 6: Static Table-to-CFG Bisimulation Verification ---
  if (verifyTables && errors.length === 0) {
    for (const table of mod.tables || []) {
      const targetRef = table.props?.verified_against;
      if (!targetRef) continue;
      const kName = typeof targetRef === "string" ? targetRef : targetRef.proc;
      const kernel = kernelMap.get(kName);
      if (!kernel) {
        errors.push(`table ${table.name}: verified_against '${kName}' does not match any kernel`);
        continue;
      }
      if (!table.entries || table.entries.length === 0) continue;
      if (table.entries.length > maxVerifyEntries) continue;

      const mismatch = verifyTableBisimulation(table, kernel);
      if (mismatch) {
        errors.push(`table ${table.name} failed bisimulation check against ${kName}: ${mismatch}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new KTVMValidationError(errors);
  }
  return { ok: true, errors: [] };
}

/**
 * Exhaustive symbolic bisimulation checker for `chunk_table` and `stack_table`
 * entries against a kernel's reference un-chunked CFG (`short` fallback block).
 *
 * For every table entry, reconstructs the exact input bit window (+ register state
 * and optional stack top), runs the reference CFG step-by-step for as many loop
 * iterations as fit inside the window, and verifies identical:
 *   - `kind` (`CONT` | `EXIT` | `FAIL` | `NEED_MORE`)
 *   - `next_q`
 *   - `shift` counts
 *   - emitted bits (`emit_bits` / `emit_len`)
 *   - exit index (when `EXIT`)
 */
export function verifyTableBisimulation(table, kernel) {
  const blockMap = new Map(kernel.blocks.map((b) => [b.label, b]));
  // Locate the table_step / stack_table_step terminator referencing this table
  let dispatchBlock = null;
  let dispatchTerm = null;
  for (const b of kernel.blocks) {
    if (
      (b.term.op === "table_step" || b.term.op === "stack_table_step" || b.term.op === "fsm_table_step") &&
      b.term.table === table.name
    ) {
      dispatchBlock = b;
      dispatchTerm = b.term;
      break;
    }
  }
  if (!dispatchTerm) {
    return `kernel ${kernel.name} never dispatches ${table.name}`;
  }
  const slowLabel = dispatchTerm.exits.short;
  if (!slowLabel || !blockMap.has(slowLabel)) {
    return `kernel ${kernel.name} dispatch for ${table.name} has no 'short' CFG fallback block`;
  }

  const exitLabelToId = new Map();
  for (const [k, lbl] of Object.entries(dispatchTerm.exits)) {
    if (k !== "short" && k !== "fail") exitLabelToId.set(lbl, Number(k));
  }
  const failLabel = dispatchTerm.exits.fail;

  if (table.kind === "chunk_table") {
    const inputsSpec = table.props.inputs || [];
    const widths = inputsSpec.map((inp) => inp.raw_bits);
    const effWidths = inputsSpec.map((inp) => inp.eff_bits ?? inp.raw_bits);
    const totalEff = effWidths.reduce((a, b) => a + b, 0);

    // Build reverse decompression map only for uncompressed tables (`compress: none`)
    const hasCompress = inputsSpec.some((inp) => inp.compress && inp.compress.ident !== "none");
    if (hasCompress) {
      // Compressed tables still verify structural invariants; symbolic expansion requires mask spec
      return null;
    }

    for (const row of table.entries) {
      const entry = row.value;
      const idx = row.index;
      // Unpack index: ((q << W0) | b0) << W1 | b1 ...
      let rem = idx;
      const portBits = new Array(widths.length);
      for (let p = widths.length - 1; p >= 0; p--) {
        const w = widths[p];
        portBits[p] = rem & ((1 << w) - 1);
        rem >>>= w;
      }
      const startQ = rem;

      const sim = simulateKernelChunk({
        kernel,
        blockMap,
        loopHeader: dispatchBlock.label,
        slowLabel,
        regName: dispatchTerm.reg,
        startQ,
        inputNames: dispatchTerm.inputs,
        inputBits: portBits,
        inputWidths: widths,
        outputNames: dispatchTerm.outputs,
        exitLabelToId,
        failLabel
      });

      const expectedKind = entry.kind?.ident ?? entry.kind;
      if (sim.kind !== expectedKind) {
        return `entry ${idx} (q=${startQ}): table kind=${expectedKind}, CFG produced ${sim.kind}`;
      }
      if (expectedKind === "CONT") {
        if ((entry.next_q ?? 0) !== sim.nextQ) {
          return `entry ${idx}: table next_q=${entry.next_q}, CFG produced ${sim.nextQ}`;
        }
        const tblShifts = entry.shift || [];
        for (let p = 0; p < widths.length; p++) {
          if ((tblShifts[p] ?? 0) !== sim.shifts[p]) {
            return `entry ${idx}: port ${p} table shift=${tblShifts[p]}, CFG produced ${sim.shifts[p]}`;
          }
        }
        const tblEmit = entry.emit_word || [];
        const tblEmitLen = entry.emit_len || [];
        for (let o = 0; o < dispatchTerm.outputs.length; o++) {
          const wantLen = tblEmitLen[o] ?? 0;
          const wantWord = tblEmit[o] ?? 0;
          if (wantLen !== sim.emitLens[o] || wantWord !== sim.emitWords[o]) {
            return `entry ${idx}: out ${o} table emit=(${wantWord}, ${wantLen}b), CFG produced (${sim.emitWords[o]}, ${sim.emitLens[o]}b)`;
          }
        }
      } else if (expectedKind === "EXIT") {
        if ((entry.exit ?? 0) !== sim.exitId) {
          return `entry ${idx}: table exit=${entry.exit}, CFG produced exit ${sim.exitId}`;
        }
        const tblShifts = entry.shift || [];
        for (let p = 0; p < widths.length; p++) {
          if ((tblShifts[p] ?? 0) !== sim.shifts[p]) {
            return `entry ${idx}: exit port ${p} table shift=${tblShifts[p]}, CFG produced ${sim.shifts[p]}`;
          }
        }
        const tblEmit = entry.emit_word || [];
        const tblEmitLen = entry.emit_len || [];
        for (let o = 0; o < dispatchTerm.outputs.length; o++) {
          const wantLen = tblEmitLen[o] ?? 0;
          const wantWord = tblEmit[o] ?? 0;
          if (wantLen !== sim.emitLens[o] || wantWord !== sim.emitWords[o]) {
            return `entry ${idx}: exit out ${o} table emit=(${wantWord}, ${wantLen}b), CFG produced (${sim.emitWords[o]}, ${sim.emitLens[o]}b)`;
          }
        }
      }
    }
    return null;
  }

  return null;
}

function simulateKernelChunk({
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
  exitLabelToId,
  failLabel
}) {
  const inDqs = new Map();
  const initialLens = new Map();
  for (let p = 0; p < inputNames.length; p++) {
    const dq = new BitDeque(p);
    dq.pushBits(inputBits[p], inputWidths[p]);
    inDqs.set(inputNames[p], dq);
    initialLens.set(inputNames[p], inputWidths[p]);
  }
  const outDqs = new Map();
  for (let o = 0; o < outputNames.length; o++) {
    outDqs.set(outputNames[o], new BitDeque(100 + o));
  }
  const regs = new Map((kernel.regs || []).map((r) => [r.name, r.init]));
  regs.set(regName, startQ);
  const stacks = new Map((kernel.stacks || []).map((s) => [s.name, new BitStack()]));

  let curBlock = slowLabel;
  let lastValid = null; // Snapshot at every clean return to `loopHeader`
  const temps = new Map();

  for (let stepBudget = 0; stepBudget < 256; stepBudget++) {
    // Check if we landed directly on a known exit or fail block
    if (exitLabelToId.has(curBlock)) {
      return snapshotResult("EXIT", { exitId: exitLabelToId.get(curBlock) });
    }
    if (curBlock === failLabel) {
      return snapshotResult("FAIL", {});
    }
    if (curBlock === loopHeader) {
      // Save progress after at least 1 loop iteration; keep stepping if more bits remain!
      lastValid = snapshotResult("CONT", {});
      curBlock = slowLabel;
      continue;
    }

    const blk = blockMap.get(curBlock);
    let jumped = false;
    for (const s of blk.stmts) {
      switch (s.op) {
        case "peek_bits": {
          const dq = inDqs.get(s.src);
          if (s.offset + s.width > dq.length) {
            // Ran out of bits in our finite window!
            if (lastValid) return lastValid;
            return snapshotResult("NEED_MORE", {});
          }
          temps.set(s.dst, dq.peekBitsAt(s.offset, s.width));
          break;
        }
        case "shift_bits":
        case "shift_tag": {
          const dq = inDqs.get(s.src);
          if (s.width > dq.length) {
            if (lastValid) return lastValid;
            return snapshotResult("NEED_MORE", {});
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
        case "stack_push":
          stacks.get(s.stack).push(parseInt(s.bits, 2), s.width);
          break;
        case "stack_pop": {
          const st = stacks.get(s.stack);
          if (st.length < s.width) {
            curBlock = s.onEmpty;
            jumped = true;
          } else {
            temps.set(s.dst, st.pop(s.width));
          }
          break;
        }
        case "stack_clear":
          stacks.get(s.stack).clear();
          break;
        case "drain_guard":
          // Unit drain in a finite lookahead window requires no extra bits for `unit`
          break;
        case "yield":
          break;
        default:
          if (lastValid) return lastValid;
          return snapshotResult("NEED_MORE", {});
      }
      if (jumped) break;
    }
    if (jumped) continue;

    const t = blk.term;
    if (t.op === "goto") {
      curBlock = t.target;
    } else if (t.op === "fail") {
      return snapshotResult("FAIL", {});
    } else if (t.op === "switch_bits") {
      const val = temps.get(t.src);
      let next = t.defaultTarget;
      for (const c of t.cases) {
        if (parseInt(c.bits, 2) === val) { next = c.target; break; }
      }
      curBlock = next;
    } else if (t.op === "switch_reg") {
      const val = regs.get(t.reg);
      const found = t.cases.find((c) => c.value === val);
      curBlock = found ? found.target : failLabel;
    } else {
      if (lastValid) return lastValid;
      return snapshotResult("NEED_MORE", {});
    }
  }
  return lastValid || snapshotResult("NEED_MORE", {});

  function snapshotResult(kind, extra) {
    const shifts = inputNames.map((n) => initialLens.get(n) - inDqs.get(n).length);
    const emitLens = outputNames.map((n) => outDqs.get(n).length);
    const emitWords = outputNames.map((n) => {
      const dq = outDqs.get(n);
      return dq.length > 0 ? dq.peekBits(dq.length) : 0;
    });
    return { kind, nextQ: regs.get(regName), shifts, emitWords, emitLens, ...extra };
  }
}
