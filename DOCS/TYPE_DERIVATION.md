# Contract derivation

The compiler derives an input/output pattern graph for each relation.
The graph constrains schemas accepted and produced by an expression; shared
nodes express equality of schema constraints across positions.

A contract does not prove execution termination or that a shared-schema output
is the same payload as an input.

## Pattern representation

During derivation, `TypePatternGraph` uses representative nodes and labeled
edges. Patterns can be unconstrained, open/closed products, open/closed unions,
or references to canonical closed schemas.

`find` resolves representatives; `unify` combines compatible constraints;
`clone` imports a callee's input/output graph together, retaining sharing;
`compact` reduces the graph and registers fully determined schemas.

Unification refines constraints:

- two open structures combine their required labels;
- an open structure can unify with a closed one only when its requirements
  fit the closed structure;
- closed structures must agree on their fields/tags and child constraints;
- product and union kinds are incompatible;
- a free variable can be constrained to a compatible structure.

Schema variables and recursive knots must retain their shared-node meaning.
Canonicalizing a closed schema and linearizing a named-pattern skeleton have
different purposes; see [patterns](PATTERNS.md).

## Local constraints

For expression `e`, write `in(e)` and `out(e)` for its pattern roots.

| Expression | Constraints |
| --- | --- |
| `()` | Input and output are the same node |
| `{}` | Output is unit; input is unconstrained |
| `(f g)` | `out(f)` unifies with `in(g)` |
| `{f a, g b}` | Both branches share the input; output is a product of branch outputs |
| `\|tag` | Output union has `tag` leading to the input |
| `.field` | Input product requires `field` leading to the output |
| `/tag` | Input union requires `tag` leading to the output |
| `<f, g>` | Branch input constraints unify, as do branch output constraints |
| `?P` | Input and output unify with `P` |
| Relation reference | Clone the callee boundary graph and unify with the reference boundaries |

An empty union is undefined. Ordered choice retains its source order at runtime;
contract unification does not change that ordering.

## Dependency groups and convergence

`compiler.mjs` initializes constraints and builds a graph of relation references.
It processes strongly connected components (SCCs) in dependency order.

- An acyclic singleton uses `single_pass`: import already derived callee
  boundaries and compact once.
- A recursive component uses `fixed_point`: clone/unify callee boundaries,
  compact, and compare signatures until they stabilize or the budget is exhausted.

The default fixed-point budget is `2 + SCC size`. A relation that does not
converge can retain a `not-converged` status and produce a warning; optimized
execution paths have their own eligibility checks.

A recursive structural witness can make derivation converge:

```k
peel = ?X < /+1 ?X peel, /0 |0 >;
peel
```

The repeated `X` connects the input to the recursively processed payload.
Without that connection the engine can keep expanding an open union chain.

Convergence is a property of these constraints. For example, derivation can
converge for a self-calling relation even though execution never returns.

## API options and statistics

`annotate`, `compile`, and `run` from `index.mjs` accept:

```js
{
  convergence: {
    strategy: "auto", // "auto", "single_pass", or "fixed_point"
    maxIterations: 20
  }
}
```

`auto` selects the strategy by SCC shape. Explicit `single_pass` is intended
for acyclic relations and rejects multi-member components. `annotate` exposes
statistics:

```js
import { annotate } from "@fraczak/k";

const result = annotate("f = .x; f");
console.log(result.compileStats.sccCount);
console.log(result.compileStats.sccs);
```

Each SCC entry records its members, selected strategy, iteration count, and
whether it converged.

## Stored and specialized contracts

Objects store derivation status on each relation as
`typeDerivation: { status }`. Loading uses the stored graphs rather than
rederiving source contracts.

KIR-P envelope specialization can deliberately run derivation again under an
input constraint. kVM specialization instead uses the lowered template and
principal patterns. See [architecture](ARCHITECTURE.md) and
[KIR-P](KIR_V1.md).

## Implementation and verification

| File | Responsibility |
| --- | --- |
| [augmentation.mjs](../augmentation.mjs) | Local expression constraints |
| [TypePatternGraph.mjs](../TypePatternGraph.mjs), [typing.mjs](../typing.mjs) | Graph operations and unification |
| [compiler.mjs](../compiler.mjs) | Relation dependencies, SCC processing, and naming |
| [convergence.mjs](../convergence.mjs) | Strategy choice, fixed points, signatures, and budgets |
| [codes.mjs](../codes.mjs) | Closed schema normalization |

[tests/code-derivation/](../tests/code-derivation/) covers syntax, convergence
strategies, recursive constraints, and envelopes. Named-pattern tests cover
template validation and routing. Run `npm test` from the repository root.
