/**
 * Verified `kTVM -> kTVM` Optimization Pipeline (Milestone 3).
 *
 * Stages:
 *   1. `fuseKernels`: CPS symbolic `proc -> kernel` fusion, TMC forward
 *      streaming, finite-enum register promotion, and virtual LIFO bit-stack
 *      promotion (gracefully skipping wide alphabets and branching recursion).
 *   2. `synthesizeTables`: Bit-chunk / stack-chunk / FSM table synthesis with
 *      SWAR don't-care bit compression and Howard's MWTR global L1 budget
 *      allocation (default 64 KB).
 *   3. Always-on `validateModule(..., { verifyTables })` proving SPSC linearity,
 *      dual-schema typing, and table-to-CFG bisimulation equivalence.
 */

import { validateModule } from "../validator.mjs";
import { simplifyProcs } from "./simplify-procs.mjs";
import { fuseKernels } from "./fuse-kernel.mjs";
import { synthesizeTables } from "./synthesize-tables.mjs";
import {
  DEFAULT_L1_BUDGET_BYTES,
  allocateTableBudgets,
  budgetClassForBytes,
  computeMWTR
} from "./mwtr.mjs";

export {
  DEFAULT_L1_BUDGET_BYTES,
  computeMWTR,
  budgetClassForBytes,
  allocateTableBudgets,
  simplifyProcs,
  fuseKernels,
  synthesizeTables
};

/**
 * Run the full verified `kTVM -> kTVM` optimization pipeline on a concrete
 * `mono` kTVM module.
 */
export function optimizeKTVM(
  monoModule,
  {
    simplify = true,
    fuse = true,
    tables = true,
    budgetBytes = DEFAULT_L1_BUDGET_BYTES,
    verifyTables = true,
    validate = true,
    maxDecisionNodes = 192,
    maxUnionTags = 12,
    enableVirtualStack = true
  } = {}
) {
  let cur = monoModule;
  let simplifyStats = null;
  let fuseStats = null;
  let tableStats = null;

  if (simplify) {
    const s = simplifyProcs(cur);
    cur = s.module;
    simplifyStats = s.stats;
  }

  if (fuse) {
    const f = fuseKernels(cur, { maxDecisionNodes, maxUnionTags, enableVirtualStack });
    cur = f.module;
    fuseStats = f.stats;
  }

  if (tables) {
    const t = synthesizeTables(cur, { budgetBytes });
    cur = t.module;
    tableStats = t.stats;
  } else {
    // Strip any internal `_optMeta` if tables were skipped
    for (const k of cur.kernels || []) delete k._optMeta;
  }

  if (validate) {
    validateModule(cur, { verifyTables });
  }

  return {
    module: cur,
    stats: {
      simplify: simplifyStats,
      fuse: fuseStats,
      tables: tableStats
    }
  };
}
