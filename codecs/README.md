# K Codecs

This directory is being rewritten around a new codec design:

```text
abstract pattern graph + prefix-free tree encoding
```

The default concrete format is now the binary encoding of a `$pattern` value,
using the `$pattern` type from [`../core.k`](../core.k), immediately followed by
the binary encoding of the value under that decoded pattern.

There is no separate JSON container format.

## Objectives

The rewrite is guided by two hard requirements:

1. compactness close to the structural lower bound,
2. efficient `k` projections, especially `.field` and `/tag`.

The current target architecture is the pattern graph plus prefix-free value-tree
stream described here and in
[`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md).

## Core Idea

The semantic object serialized by the new codec is:

```text
(P, v)
```

where:

- `P` is an abstract rooted pattern graph,
- `v` is a value tree compatible with `P`.

The same pair is now the in-memory runtime model as well. Decoding a stream
attaches `P` to the resulting `Value` as `value.pattern`; evaluation propagates
that pattern through projections and constructors; encoding a `Value` uses its
carried pattern unless an explicit pattern is supplied.

The base value encoding is:

- tree-based, not DAG-based,
- prefix-free,
- interpreted relative to the pattern graph,
- free of repeated field names and tag names in the value payload.

The base codec does **not** perform DAG compression. If sharing is desired, it
should happen as a higher-level transform, not inside the primitive value
format.

## Wire Format

The default transport format is:

```text
encode($pattern_value : $pattern) encode(value : decoded_pattern)
```

`$pattern_value` is a normal k value whose shape is defined in `core.k`. After
that value is decoded, it becomes the pattern used to decode the remaining
value payload.

The runtime boundary is therefore:

```text
binary pattern+value stream <-> Value(pattern, tree)
```

`k.mjs` is only the command-line adapter for that boundary. The operational
runtime sees and preserves the pattern on the `Value` itself.

## Pattern Graph Representation

For documentation and tests, a pattern graph may be shown as a property-list
style vector of nodes:

```text
[kind, edges]
```

where:

- `kind` is one of:
  - `"any"`
  - `"open-product"`
  - `"open-union"`
  - `"closed-product"`
  - `"closed-union"`
- `edges` is a list of:
  - `[label, target_node_id]`

Example:

```json
[
  ["closed-union", [["nil", 1], ["cons", 2]]],
  ["closed-product", []],
  ["closed-product", [["car", 3], ["cdr", 0]]],
  ["closed-union", [["_", 1], ["0", 3], ["1", 3]]]
]
```

Canonical rules:

- root node is node `0`,
- node list order is canonical graph-discovery order,
- edges are sorted by label,
- edge labels are unique within a node,
- `"any"` must have no outgoing edges.

This JSON-like graph is only a readable notation. The wire representation is
the ordinary k `$pattern` value from `core.k`.

## Witness-Derived Patterns

When `k-parse` is used without an explicit input pattern or type, the wire
pattern is derived from the parsed value tree.

- An empty textual node is a closed product: `{}`.
- A textual node with multiple children is a closed product.
- A textual node with one child is interpreted as an open union by default.
- An explicit product input pattern may force such a node to be treated as a
  singleton product instead.

For example, parsing:

```text
{a:{b:x,c:{}}}
```

without an input pattern derives:

```json
[
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]
```

During this construction, finite closed pattern subtrees are hash-consed from
the leaves upward. The starting closed leaf is `["closed-product", []]`. Two
closed nodes collapse only when they have the same closed kind, the same labels,
and the same already-collapsed child targets. Open nodes keep their identity,
and recursive closed nodes are not collapsed by this witness-tree rule.

This is canonicalization of the pattern graph carried in the wire stream. It is
not DAG compression of the value payload.

## Prefix-Free Value Encoding

The value payload is a bitstream interpreted relative to the pattern graph.

Base rules:

- closed or open product:
  - encode child values in canonical edge order,
- closed or open union:
  - encode the selected tag position,
  - then encode the selected payload,
- `any`:
  - not directly value-carrying in the base format.

The initial concrete union encoding rule is:

```text
width = ceil(log2(cardinality))
emit tag ordinal in width bits
```

This is the simplest canonical prefix-free choice encoding. It is not the final
word on compression, but it gives a regular and compact base encoding that can
later be refined without changing the abstract pattern/value model.

## Projections

The base tree encoding is chosen so that:

- `/tag` only needs to read the union choice at the current node,
- `.field` follows canonical product order and may later be accelerated by
  higher-level indexes if necessary.

In the materialized runtime, projections also project the carried pattern:
`.field` returns the subpattern at that product field, and `/tag` returns the
subpattern at that union tag. If no carried subpattern is available, later
encoding can still derive a witness pattern from the result tree.

The primitive codec stays minimal. Projection indexes, framing, or sharing
schemes are explicitly separate concerns.

## Design Boundary

The new codec work is split into layers:

1. abstract pattern graph semantics,
2. prefix-free value-tree semantics relative to that graph,
3. self-hosted `k` representation of the pattern graph,
4. optional higher-level optimizations.

## Files

- [`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md):
  main design document for the new pattern-plus-prefix-tree codec.
- [`BINARY_FORMAT.md`](./BINARY_FORMAT.md):
  notes on future binary packaging of the same abstract semantics.

## Status

The active command-line pipeline emits and consumes the self-hosted binary
pattern+value stream.
