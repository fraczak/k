# K Prefix-Free Pattern Codec

## Purpose

This document defines the new target semantics for binary codecs in `k`.

The object to be serialized is:

```text
(P, v)
```

where:

- `P` is a rooted pattern graph,
- `v` is a value tree compatible with `P`.

This is both the transport semantics and the runtime value semantics. In the
current JavaScript runtime, the materialized `Value` stores the pattern as
`value.pattern`; the tree is still represented by `Product` and `Variant`
nodes.

The codec is designed around:

1. compactness,
2. efficient structural navigation,
3. a clean separation between semantic encoding and later transport/container
   choices.

This document defines the semantic codec. It does **not** require a final
binary package format yet.

## Design Principles

### 1. Pattern is the structural authority

The pattern determines:

- whether a node is a product or union,
- whether it is open or closed,
- what field names or tag names exist,
- how recursive positions are connected.

The value payload is interpreted relative to the pattern.
During execution, the same pattern context is propagated with materialized
values, so structural operations do not have to reconstruct envelope information
after the fact.

### 2. Values are trees in the base codec

The base codec serializes value trees, not value DAGs.

DAG compression is not part of the primitive codec. If wanted, it should happen
as a separate transform above the base value encoding.

### 3. Prefix-free value encoding

The value payload is a prefix-free bitstream.

Products rely on structural concatenation.
Unions emit a choice code, then the payload of the selected branch.

### 4. Abstract first, packaging later

The pattern graph and the value encoding must be specified abstractly first.

Only after that should they be embedded in:

- JSON,
- `k` values,
- or a compact binary envelope.

## Pattern Graph

### Semantic node kinds

There are exactly five node kinds:

- `any`
- `open-product`
- `open-union`
- `closed-product`
- `closed-union`

Their informal meanings are:

- `any`
  unconstrained position,
- `open-product`
  explicit fields plus possibly more fields in the matched value,
- `open-union`
  explicit tags plus possibly more tags in the matched value,
- `closed-product`
  exactly the listed fields,
- `closed-union`
  exactly the listed tags.

In the base codec, `any` is not directly value-carrying.

### Graph structure

A pattern graph node is:

```text
[kind, edges]
```

where `edges` is a list of:

```text
[label, target_node_id]
```

The root node is node `0`.

### Canonical constraints

- node `0` is the root,
- node order is canonical graph-discovery order,
- edges are sorted by label,
- no duplicate labels occur within one node,
- `any` has no outgoing edges.

### Bootstrap JSON syntax

The initial concrete representation is:

```json
{
  "pattern": [
    ["closed-union", [["nil", 1], ["cons", 2]]],
    ["closed-product", []],
    ["closed-product", [["car", 3], ["cdr", 0]]],
    ["closed-union", [["_", 1], ["0", 3], ["1", 3]]]
  ]
}
```

This syntax is only a bootstrap envelope for the abstract graph.

## Pattern Construction From A Witness Tree

When no external pattern or type is supplied, the bootstrap tools derive a
pattern from the value tree itself.

- `{}` derives the closed product leaf `["closed-product", []]`.
- A textual tree node with multiple children derives a closed product.
- A textual tree node with exactly one child derives an open union.
- If an explicit product pattern is supplied, that pattern can disambiguate the
  same one-child textual node as a singleton product.

Example:

```text
{a:{b:x,c:{}}}
```

derives:

```json
[
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]
```

The derived graph is canonicalized by a bottom-up closed-node collapse. Starting
from the closed empty product, two closed nodes are collapsible only when their
kind, labels, and already-collapsed children are identical. Open nodes are not
collapsed, and this rule is not value-DAG compression.

## Value Encoding

### General shape

The value encoding is defined recursively relative to the current pattern node.

#### Product node

For `open-product` or `closed-product`:

```text
encode(v_0) encode(v_1) ... encode(v_(n-1))
```

in canonical edge order.

There are no separators between children. The pattern determines where each
child begins and ends.

#### Union node

For `open-union` or `closed-union`:

```text
encode-choice(tag_ordinal, tag_count)
encode(selected_payload)
```

#### Any node

`any` is not directly value-carrying in the base format.

If a value would need to descend into an `any` position, the pattern must first
be refined.

## Choice Encoding

The initial concrete choice encoding is fixed-width by cardinality:

```text
width(cardinality) = ceil(log2(cardinality))
```

A choice with:

- `cardinality = n`
- `ordinal in [0, n)`

is encoded as the binary representation of `ordinal` in `width(n)` bits.

Examples:

- `n = 1`: `0` bits,
- `n = 2`: `1` bit,
- `n = 3`: `2` bits,
- `n = 4`: `2` bits,
- `n = 5`: `3` bits.

This is the initial canonical rule for the rewrite. More aggressive coding
schemes may be considered later, but only after the abstract semantics are
stable.

## Operational Properties

### `/tag`

At a union node:

1. read the choice code,
2. compare it to the requested tag ordinal,
3. if it matches, continue with the selected payload.

This makes `/tag` naturally efficient.

### `.field`

At a product node, child values appear in canonical field order.

So `.field` is resolved by:

1. locating the field ordinal in the pattern,
2. decoding or skipping earlier children,
3. decoding the requested child subtree.

The base codec does not include field-offset indexes. Such indexes may be added
later as separate higher-level acceleration structures.

In the materialized evaluator, `.field` applies the analogous pattern operation:
the output `Value` carries the subpattern reached by the selected field.
Likewise, `/tag` carries the subpattern reached by the selected variant tag.

## Recursive Types

Recursive pattern graphs are first-class.

For example, a bit-list-like recursive type:

```text
["closed-union", [["_", 1], ["0", 3], ["1", 3]]]
```

is encoded as repeated union choices in a value tree, not as a byte-aligned node
table and not as a built-in primitive integer format.

This keeps the codec uniform: recursion is handled by the pattern graph itself.

## Bootstrap Envelope

The initial transport envelope is JSON:

```json
{
  "pattern": [...],
  "value_bits": "..."
}
```

`value_bits` may be carried as:

- a literal bitstring for debugging, or
- a base64 string for practical transport.

The envelope is deliberately simple so that the semantics of `pattern` and
`value_bits` can be stabilized before moving to a self-hosted representation.

Decoding the JSON envelope yields `Value(pattern, tree)`. Encoding a runtime
`Value` uses its carried pattern by default, or an explicit caller-supplied
pattern when one is provided.

## Out Of Scope For The Base Codec

The following are intentionally outside the primitive codec:

- DAG compression,
- subtree deduplication,
- projection indexes,
- transport-specific framing,
- compact binary pattern serialization,
- exact-type-only specializations.

These may be added later, but they are not part of the base pattern-plus-tree
prefix codec.
