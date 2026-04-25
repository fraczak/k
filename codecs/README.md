# K Codecs

This directory is being rewritten around a new codec design:

```text
abstract pattern graph + prefix-free tree encoding
```

The immediate bootstrap format is a JSON envelope carrying:

```json
{
  "pattern": [...],
  "value_bits": "..."
}
```

The goal is to stabilize the semantics first. Compact self-hosted binary
envelopes, binary pattern serialization, and higher-level sharing/compression
can come later.

## Objectives

The rewrite is guided by two hard requirements:

1. compactness close to the structural lower bound,
2. efficient `k` projections, especially `.field` and `/tag`.

The current target architecture is the property-list pattern graph plus
prefix-free value-tree envelope described here and in
[`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md).

## Core Idea

The semantic object serialized by the new codec is:

```text
(P, v)
```

where:

- `P` is an abstract rooted pattern graph,
- `v` is a value tree compatible with `P`.

The same pair is now the in-memory runtime model as well. Decoding an envelope
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

## Bootstrap Envelope

The first concrete transport format is JSON:

```json
{
  "pattern": [
    ["closed-union", [["nil", 1], ["cons", 2]]],
    ["closed-product", []],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-union", [["_", 1], ["0", 3], ["1", 3]]]
  ],
  "value_bits": "base64-or-bitstring"
}
```

This is intentionally simple:

- `pattern` is explicit and easy to validate,
- `value_bits` is a compact carrier for the prefix-free payload,
- the pattern representation is abstract enough to later encode in `k` itself.

The envelope boundary is therefore:

```text
JSON envelope <-> Value(pattern, tree)
```

`k.mjs` is only the command-line adapter for that boundary. The operational
runtime sees and preserves the pattern on the `Value` itself.

## Pattern Graph Representation

The pattern graph is represented as a property-list style vector of nodes:

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

This JSON graph is only the bootstrap syntax. The long-term intent is to encode
the same abstract graph as an ordinary `k` value.

## Witness-Derived Patterns

When `k-parse` is used without an explicit input pattern or type, the envelope
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

This is canonicalization of the pattern graph carried in the envelope. It is
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
3. bootstrap JSON envelope,
4. later self-hosted `k` representation of the pattern graph,
5. later compact self-hosted encoding and optional higher-level optimizations.

## Files

- [`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md):
  main design document for the new pattern-plus-prefix-tree codec.
- [`BINARY_FORMAT.md`](./BINARY_FORMAT.md):
  notes on future binary packaging of the same abstract semantics.

## Status

The repository is currently being migrated onto this envelope model. Some helper
modules still reflect transitional implementation work, but the active design
contract is the one described in these codec documents.
