# Type Derivation Algorithm - Abstract Specification

## Purpose

Infer type constraints for a program of mutually recursive partial functions over algebraic data types.

## Core Idea

Each subexpression has an **input type** and **output type**. These are represented as **patterns** (type constraints) that form nodes in a graph. Patterns are unified (merged) according to expression structure until a fixed point is reached.

## Data Model

### Patterns

A pattern represents a set of types:

- **Open patterns**: `(...)`, `{...}`, `<...>` - may have additional fields
- **Closed patterns**: `()`, `{}`, `<>` - exact field set known
- **Type**: reference to a specific named type

Patterns have **fields** represented as labeled edges to other patterns.

### Pattern Graph

- **Nodes**: patterns (equivalence class representatives)
- **Edges**: labeled by field/tag names, pointing to other patterns
- **Forest**: parent pointers track equivalence via union-find

## Algorithm Overview

```
1. INITIALIZE: Create [input, output] pattern pairs for each AST node

2. APPLY LOCAL RULES: Set up constraints based on expression type
   - Composition: chain input/output
   - Product: collect fields
   - Union: merge alternatives
   - Projection: extract field
   - etc.

3. COMPUTE DEPENDENCIES: Find strongly connected components (SCCs)

4. ITERATE TO FIXED POINT: For each SCC (bottom-up):
   - Inline referenced function types
   - Unify patterns according to constraints
   - Compress graph
   - Repeat until stable

5. CANONICALIZE: Assign names based on derived types
```

## Key Operations

### UNIFY(p1, p2, ...)

Merge patterns that must represent the same type:

1. Find representatives of all patterns
2. Compute least upper bound (most specific common pattern)
3. Create new representative with merged constraints
4. Recursively unify field destinations

**Fails** if patterns are incompatible (e.g., product vs union).

### CLONE(patterns, target_graph)

Copy a subgraph of patterns into another graph:

1. Traverse from root patterns
2. Create corresponding nodes in target
3. Copy edges with remapped destinations
4. Return mapping from old IDs to new IDs

### COMPRESS(graph)

Normalize and deduplicate patterns:

1. Identify singleton types (closed patterns with no open ancestors)
2. Convert singletons to named types
3. Group patterns by type (open patterns kept separate)
4. Within groups, compute structural equivalence
5. Merge structurally equivalent patterns
6. Return compressed graph with ID remapping

**Note:** Open unknown patterns `(...)` are never merged, preserving distinct type variables.

## Local Typing Rules (Summary)

| Expression | Constraint |
|------------|------------|
| `f g` (composition) | out(f) = in(g) |
| `{e1 l1, ..., en ln}` | in(e1) = ... = in(en), out = product |
| `<e1, ..., en>` | in(e1) = ... = in(en), out(e1) = ... = out(en) |
| `.label` | in has field label, out = type of field |
| `ref(v)` | clone v's types, unify with local |

## Convergence

Iterate until pattern graph structure is unchanged (or max iterations reached).

## Error Conditions

- Incompatible pattern unification (e.g., `{}` with `<>`)
- Undefined reference
- Type mismatch with declared types

## Properties

- **Soundness**: If derivation succeeds, program is well-typed
- **Completeness**: All valid programs have a derivation (modulo recursion limits)
- **Termination**: Guaranteed by iteration bound and monotonic pattern refinement
