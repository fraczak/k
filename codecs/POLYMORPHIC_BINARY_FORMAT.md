# K Polymorphic Binary Format

## Purpose

This document defines a binary format for polymorphic values in `k`.

The semantic object to be serialized is:

```text
(P, v)
```

where:

- `P` is a normalized pattern graph,
- `v` is a typed value compatible with `P`.

The binary format is designed so that:

- the pattern carries all field and tag names,
- the value payload carries no explicit labels or tags,
- the value payload is friendly to `.label` and `/tag`,
- closed typed values appear as the singleton-pattern special case.

## Design Principles

### 1. Pattern is the structural authority

The pattern section is the authoritative description of the structure expected by the value section.

It determines:

- whether a node is product or union,
- whether it is open or closed,
- which fields or tags are present explicitly,
- which subpositions point to the same pattern node,
- which leaves are exact types.

### 2. Value is interpreted relative to the pattern

The value payload is not self-describing.
It is decoded relative to the pattern graph.

This is why the payload does not need to repeat field names or tag names.

### 3. `(...)` is not value-carrying

The leaf pattern `(...)` is allowed in the pattern language, but it is **not** allowed to carry serialized value content in version 1 of this format.

This restriction keeps explicit labels out of the value payload.
Otherwise the missing structure would have to be reintroduced locally in the value itself.

### 4. Value DAG is only an optimization

Semantically, the value is a tree.
On the wire, it may be encoded as a DAG by collapsing equal occurrences relative to the pattern.

## High-Level Structure

The package layout is:

```text
| magic | format_version | flags | symbol_table | pattern_section | value_section |
```

There is no separate `type_section`.

## Primitive Encodings

### Integers

- fixed-width integers are unsigned and big-endian,
- variable-width integers use unsigned LEB128 and are written `uvarint`.

### Symbols

A symbol is a UTF-8 string used as:

- a field name,
- a tag name,
- an exact type identifier when such identifiers are serialized as strings.

Symbols are interned in a symbol table and referred to by symbol ID.

## Header

```text
| magic:4 bytes | format_version:u8 | flags:u8 |
```

Current values:

- `magic = "KPV2"`
- `format_version = 1`

All flag bits are reserved in version 1 and must be zero.

## Symbol Table

```text
| symbol_count:uvarint | symbol_0 | ... | symbol_(N-1) |
```

Each symbol is:

```text
| byte_length:uvarint | utf8_bytes... |
```

### Canonical ordering

Symbols are ordered canonically by:

1. ascending UTF-8 byte sequence,
2. duplicates removed.

The same symbol table is used by both the pattern and the value sections.

## Pattern Section

The pattern section serializes a normalized rooted pattern graph.

### Pattern node kinds

There are exactly five semantic node kinds:

- `(...)`
- `{...}`
- `<...>`
- `{}`
- `<>`

These are constructor classes of pattern nodes, not leaf/internal tags.
Only `(...)` is forced to have no outgoing edges.
All other node kinds may have zero or more outgoing edges.

Their meanings are:

- `(...)` means unconstrained type,
- `{...}` with edges `l1 -> X1, ..., ln -> Xn` means

  ```text
  { X1 l1, ..., Xn ln, ... }
  ```

- `<...>` with edges `t1 -> X1, ..., tn -> Xn` means

  ```text
  < X1 t1, ..., Xn tn, ... >
  ```

- `{}` with edges `l1 -> X1, ..., ln -> Xn` means

  ```text
  { X1 l1, ..., Xn ln }
  ```

- `<>` with edges `t1 -> X1, ..., tn -> Xn` means

  ```text
  < X1 t1, ..., Xn tn >
  ```

In particular:

- `{}` with zero edges is the unit type,
- `<>` with zero edges is the empty type,
- `{...}` with zero edges matches any product type,
- `<...>` with zero edges matches any union type.

### Canonical node numbering

Pattern nodes are numbered by first discovery in rooted depth-first traversal:

1. start at the root,
2. visit outgoing edges in ascending symbol ID order,
3. assign a new node ID on first encounter,
4. reuse the existing node ID on revisits.

The root pattern node is always node `0`.

### Structure

```text
| pattern_node_count:uvarint | pattern_node_0 | ... | pattern_node_(P-1) |
```

### Pattern node record

Every pattern node record starts with:

```text
| node_kind:u8 |
```

The codes are:

- `0` = `(...)`
- `1` = `{...}`
- `2` = `<...>`
- `3` = `{}`
- `4` = `<>`

The remainder of every record is:

```text
| edge_count:uvarint | edge_0 | ... | edge_(k-1) |
```

Each edge is:

```text
| symbol_id:uvarint | target_pattern_node:uvarint |
```

Edges must be sorted by ascending `symbol_id` and have no duplicates.

Validation rules for node kinds:

- `(...)` must have `edge_count = 0`,
- all other node kinds may have any `edge_count ≥ 0`.

This document therefore starts without type hashes or exact-type leaves.
Closed typed values are represented simply as values whose root pattern happens to be singleton.

## Value Section

The value section encodes the witness value tree relative to the pattern graph.
On the wire, it is represented as a DAG of value occurrences decorated by pattern-node identity.

### Canonical value-node identity

The canonical key of a value node is:

```text
(pattern_node_id, node_shape)
```

where:

- for product pattern nodes (`{...}` or `{}`), `node_shape` is the ordered list of child node IDs,
- for union pattern nodes (`<...>` or `<>`), `node_shape` is `(tag_ordinal, child_node_id)`,
- `(...)` carries no value and therefore cannot appear in the value section.

This is the criterion for canonical DAG sharing in the value payload.

### Encodability restriction

Version 1 forbids serialized values from descending into an `any-leaf` pattern node.

So if evaluation of a value against a pattern would require materializing a subtree at `(...)`, the value is **not encodable** in this format.

### Canonical value-node numbering

Value nodes are numbered in canonical postorder:

1. children before parents,
2. for product nodes, children in ascending pattern-edge symbol order,
3. for union nodes, the selected child before the parent,
4. a shared node is emitted only once, at the first completed postorder visit.

The root value node is always the last node.

### Structure

```text
| value_node_count:uvarint | value_node_0 | ... | value_node_(V-1) |
```

### Value node record

Each value node starts with:

```text
| pattern_node_id:uvarint | body... |
```

The body depends on the referenced pattern node kind.

#### Product value node

If the pattern node is `{...}` or `{}` with `k` outgoing edges in ascending symbol order:

```text
| child_ref_0:uvarint | child_ref_1:uvarint | ... | child_ref_(k-1):uvarint |
```

The value carries exactly the children of the explicitly listed fields.
Open product patterns do not permit the value section to introduce additional unlabeled fields.

#### Union value node

If the pattern node is `<...>` or `<>` with `m` outgoing edges in ascending symbol order:

```text
| tag_ordinal:uvarint | child_ref:uvarint |
```

`tag_ordinal` must be in `[0, m)`.
Open union patterns do not permit the value section to introduce additional unnamed tags.

#### `(...)` value node

This case is forbidden in version 1.

## Child References

Child references are encoded as back-distances:

```text
child_ref = current_value_node_id - 1 - child_value_node_id
```

So:

- `0` means the immediately preceding node,
- `1` means two records back,
- and so on.

The decoder reconstructs:

```text
child_value_node_id = current_value_node_id - 1 - child_ref
```

## Validation

After decoding, a package is valid iff all of the following hold.

### Pattern section

- all pattern node IDs referenced by edges are in range,
- all edge symbol IDs are in range,
- edge symbol IDs are strictly increasing within each node,
- `(...)` has no outgoing edges,
- the root node exists.

### Value section

- every `pattern_node_id` is in range,
- every child reference points to an earlier value node,
- a product value node references a `{...}` or `{}` pattern node,
- a union value node references a `<...>` or `<>` pattern node,
- no value node references `(...)`,
- `tag_ordinal` is valid for the referenced union pattern node,
- the root value node references pattern node `0`.
- no value node references `<>` with zero outgoing edges, since the empty type has no values.

## Example

Consider:

```k
pattern: < X tag1, {} tag2, ... > = X
value:   {}|tag2|tag1|tag1
```

### Symbols

```text
0 -> "tag1"
1 -> "tag2"
```

### Pattern graph

```text
P0: <...>, edges(tag1 -> P0, tag2 -> P1)
P1: {},    no edges
root = P0
```

### Value DAG

```text
V0: {}            at P1
V1: V0 | tag2     at P0
V2: V1 | tag1     at P0
V3: V2 | tag1     at P0
root = V3
```

This example has no repeated decorated subtrees, so the value DAG is the same as the value tree.

## Closed-Value Specialization

If the root pattern is singleton, then the whole package represents an ordinary closed typed value.

In that case:

- the pattern section still exists and makes the package self-contained,
- a more compact specialization may omit the pattern section and use the dedicated closed-value format.

So the closed-value format is a derived optimization, not the semantic foundation.

## Operational Properties

The value payload is chosen to support efficient `k` navigation.

### `.label`

For a product value node:

1. inspect the referenced pattern node,
2. map `label` to field ordinal by the pattern edge order,
3. jump to the corresponding child reference.

### `/tag`

For a union value node:

1. inspect the referenced pattern node,
2. compare the stored `tag_ordinal` with the requested tag ordinal,
3. on success follow the child reference.

So field and tag names stay in the pattern graph, not in the value payload.

## Future Extensions

Possible future extensions include:

- introducing exact-type leaf nodes and a pattern registry,
- allowing a controlled self-describing payload under `(...)`,
- auxiliary indexes for faster random access,
- optional textual debug envelopes,
- section compression that preserves the decoded semantic object.
