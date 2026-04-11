# Convergence Strategies

This note describes the current structure of the JavaScript type-derivation engine and the places intended for experimentation.

## Current default

Type derivation operates on the SCC DAG of relation dependencies.

- Singleton SCC with no self-reference:
  - use `single_pass`
  - clone already-derived callee boundary patterns once
  - compact once
- Recursive SCC:
  - use `fixed_point`
  - iterate until signatures stabilize or the iteration budget is exhausted

This split keeps acyclic modules fast while preserving the old behavior for recursive polymorphic definitions.

## Public tuning hook

`annotate`, `compile`, and `run` accept:

```js
{
  convergence: {
    strategy: "auto" | "single_pass" | "fixed_point",
    maxIterations?: number
  }
}
```

The returned `annotate(...)` object includes:

```js
{
  compileStats: {
    sccCount,
    sccs: [
      {
        members: ["relA", "relB"],
        strategy: "fixed_point",
        iterations: 3,
        converged: true
      }
    ]
  }
}
```

This is the supported inspection surface for convergence experiments.

## Why the current fast path works

For an acyclic singleton SCC, every callee has already been fully derived by the time the current relation is processed. There is no need for repeated fixed-point propagation because:

1. Callee boundary patterns are stable.
2. The current relation only needs those stable input/output boundaries.
3. One propagation pass plus one compaction is sufficient.

`Examples/ieee.k` is exactly this shape: a large acyclic dependency graph. The major speedup comes from avoiding unnecessary fixed-point iteration there.

## Current implementation choices

Two implementation changes matter for performance:

1. Compaction now starts from the quotient graph of live representatives instead of cloning the full historical union-find forest.
2. Singleton-pattern registration is incremental and no longer re-finalizes the entire global code repository on every compaction.

These two changes are what make `Examples/ieee.k` practical to type-check.

## Where to experiment next

If you want to continue convergence work, these are the main seams:

- `convergence.mjs`
  - strategy selection
  - recursive SCC processing
  - future divergence detection
- `compression.mjs`
  - quotient-graph construction
  - equivalence partitioning
  - alternative canonicalization schemes
- `typing.mjs`
  - clone/unify behavior
  - pattern-graph data structure

Promising next experiments:

- Replace signature-string stabilization in `fixed_point` with structural change tracking.
- Add divergence heuristics for recursive polymorphic SCCs.
- Cache cloned callee boundary graphs for repeated call sites within one relation.
- Compare the current partition refinement in `compression.mjs` with a hash-consed canonical-form approach.
