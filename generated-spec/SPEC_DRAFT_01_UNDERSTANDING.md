# Type Derivation Algorithm - Current Understanding

## Overview
The algorithm decorates each AST node with a pair of type patterns [input, output] representing the type signature of the partial function at that node.

## Pattern Types (Filters)

Patterns represent sets of types:

- `(...)` - unknown/any type (open, can have any fields)
- `{...}` - product type, open (has at least the specified fields)
- `<...>` - union type, open (has at least the specified tags)
- `()` - closed unknown (exactly the specified fields, but constructor unknown)
- `{}` - closed product (exactly these fields)
- `<>` - closed union (exactly these tags)
- `type` - a specific named type (reference to code registry)

## AST Expression Types

From patterns.mjs and TYPING.md:

1. **ref** - variable reference to another function
2. **comp** - composition of functions
3. **product** - product constructor `{e1 l1, ..., en ln}`
4. **union** - merge/union `<e1, ..., en>`
5. **dot** - projection `.label`
6. **div** - union case selector `/tag`
7. **vid** - union constructor (variant injection)
8. **identity** - identity function `()`
9. **code** - type literal
10. **filter** - explicit type constraint `?pattern`

## Data Structures

### TypePatternForest
- Nodes: individual pattern instances
- Parent pointers: represent equivalence via union-find
- Each node has a pattern descriptor

### TypePatternGraph
- Nodes: equivalence class representatives from the forest
- Edges: labeled by field/tag names, pointing to other pattern nodes
- Special edge label: `vector-member` for array types

## Algorithm Flow

1. **Initialization**: Create [input, output] pattern pairs for each AST node
2. **Local Rules**: Apply typing rules for each expression type
3. **Unification**: Merge patterns that must be equal
4. **SCC Analysis**: Handle mutually recursive definitions
5. **Fixed Point**: Iterate until patterns stabilize
6. **Compression**: Normalize and deduplicate patterns

## Key Operations

### UNIFY(p1, p2, ...)
- Find representatives of all patterns
- Compute merged pattern via `flat-unify`
- Create new representative node
- Migrate edges to new node
- Recursively unify edge destinations

### flat-unify(p1, p2)
Commutative binary operation with compatibility rules (see TYPING.md table)

## Local Typing Rules Summary

- **comp(f, g)**: in_comp = in_f, out_f = in_g, out_g = out_comp
- **product{e1 l1, ..., en ln}**: all inputs equal, output is `{out_e1 l1, ..., out_en ln}`
- **union<e1, ..., en>**: all inputs equal, all outputs equal
- **dot(l)**: input has field l, output is type of field l
- **ref(v)**: clone definition patterns and unify with local patterns
