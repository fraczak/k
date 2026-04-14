# K Binary Interchange Format Specification

This document describes the **closed-value specialization** of the more general
polymorphic package format defined in `POLYMORPHIC_BINARY_FORMAT.md`.

Semantically, this file covers the singleton-pattern case:

```text
(Pat(T), (T, t))
```

where the explicit pattern graph is omitted because it is uniquely determined by
the witness type `T`.

Equivalently, this is the codec used at an `exact-type-leaf` boundary in the
polymorphic format.

So this document does **not** define a separate semantic object. It defines the
compact binary representation of the already-understood object:

```text
(Pat(T), (T, t))
```

with the following optimization:

- the explicit pattern graph `Pat(T)` is omitted,
- the exact root type is named directly by `root_type_hash`,
- the value is decoded relative to that exact type.

## Overview

The binary format for k values consists of two parts:

1. **Type header**: Identifies the canonical type of the value
2. **Value payload**: canonical encoding of the value's **minimal typed DAG**

The payload is designed to be friendly to the two primitive `k` navigations:

- `.label` on products
- `/tag` on unions

This pushes the format away from a pure inline bitstream tree and toward a **node-table encoding** of the minimal typed DAG.
The type carries labels and tag names; the payload carries only compact structural references.

## Relation To The Polymorphic Format

The general polymorphic package serializes:

```text
pattern_section + value_section
```

where pattern nodes may include `exact-type-leaf`.

This file is the specialization obtained when:

- the root pattern is singleton,
- the whole package can therefore be represented by one exact root type,
- the explicit pattern section is dropped.

Operationally:

- `root_type_hash` plays the role of the omitted singleton root pattern,
- `state_id` values are interpreted in the canonical automaton of that exact type,
- the resulting closed-value payload is exactly what an `exact-type-leaf` delegates to in the polymorphic spec.

## Format Structure

```
┌─────────────────┬────────────────────────────────┐
│  Type Header    │     Value Payload              │
│  (variable)     │     (variable)                 │
└─────────────────┴────────────────────────────────┘
```

### Type Header

The type is identified by its **canonical name** (content-addressed hash), which is a base58-encoded SHA-256 hash prefixed with `@`.

**Format Options:**

**Option A: Length-prefixed ASCII**
```
[1 byte: length N][N bytes: ASCII type hash including '@']
```
Example: `\x2d@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c`

**Option B: Fixed 32-byte hash**
```
[32 bytes: raw SHA-256 hash]
```
No '@' prefix, no base58 encoding - pure binary.

**Option C: No header (rely on context)**
```
[Value payload only]
```
The decoder must know the expected type from context.

**Decision: Option B** - Fixed 32-byte raw hash

- Predictable size (easier to parse)
- Compact (no encoding overhead)
- Fast to validate (direct hash comparison)

In the polymorphic setting, this corresponds to omitting the explicit singleton
pattern and naming the exact root type directly.

### Value Payload (Canonical Serialization)

The source semantic object is always a **typed tree**. For compact interchange, the wire format may encode the tree through its unique minimal DAG quotient.

Two subtrees are shareable only if they are equal as **typed values**:

- they are rooted at the same canonical subtype/state,
- they choose the same union alternative if applicable,
- and their children are recursively equal as typed values.

Equality of local payload bytes alone is not enough. In particular, two subtrees that happen to serialize to the same bit pattern under different types must **not** be merged.

After quotienting by typed-value equality, each DAG node is serialized according to its canonical type state:

1. **Product nodes** store child references in canonical field order
2. **Union nodes** store the chosen tag ordinal, then one child reference
3. **Unit** (empty product) stores no children
4. **Empty union** cannot be encoded

The wire format is determined by the minimal typed DAG itself, not by encoder heuristics such as "share only large nodes" or "share whichever duplicate was found first".

For values with no repeated typed subtrees, the DAG degenerates to the original tree.

This is the closed-type analogue of the polymorphic rule that value sharing is
computed relative to the structural authority above it. Here that authority is
the exact root type rather than an explicit pattern graph.

## Canonical Payload Layout

The payload after the root type hash is:

```text
| payload_version:u8 | node_count:uvarint | node_record_0 | ... | node_record_(N-1) |
```

Conventions:

- `payload_version` is currently `1`.
- `node_count` is the number of nodes in the minimal typed DAG.
- Node IDs are implicit: the first record is node `0`, the next is node `1`, ..., the last is node `N-1`.
- The **root node ID is always `N-1`**.

The payload is therefore compact, sequentially parseable, and canonically ordered.

### Why root = last node

Node records are emitted in canonical **postorder**:

1. children before parents,
2. product children in canonical field order,
3. union nodes visit their single selected child,
4. a shared node is emitted only on its first completed postorder visit.

This yields:

- a deterministic node numbering,
- every child ID strictly smaller than its parent ID,
- no explicit root ID field.

## Canonical Node Identity

The canonical typed-DAG node key is:

```text
(state_id, node_shape)
```

where:

- `state_id` is the canonical automaton state of the subtree root,
- `node_shape` is:
  - for product states: the ordered list of child node IDs,
  - for union states: `(tag_ordinal, child_id)`.

Equivalently, an encoder may compute a bottom-up semantic hash from:

```text
hash(state_id, tag_ordinal_or_product, hash(child_0), hash(child_1), ...)
```

but the semantic rule is normative, not the hash function.

## Node Record Layout

Every node record starts with:

```text
| state_id:uvarint | body... |
```

The decoder uses `state_id` together with the root type's canonical automaton to know whether this is a product or union state, how many fields it has, and what child states are expected.

### Product Record

If `state_id` is a product state with fields

```text
f0, f1, ..., f(k-1)
```

in canonical field order, the record body is:

```text
| child_ref_0:uvarint | child_ref_1:uvarint | ... | child_ref_(k-1):uvarint |
```

There are no field names in the payload. Labels come entirely from the canonical type.

### Union Record

If `state_id` is a union state with variants

```text
t0, t1, ..., t(m-1)
```

in canonical tag order, the record body is:

```text
| tag_ordinal:uvarint | child_ref:uvarint |
```

`tag_ordinal` must be in `[0, m)`.

There are no tag names in the payload. Tag names come entirely from the canonical type.

### Unit Record

If `state_id` is an empty product state `{}`, the record body is empty.

Its full encoding is just:

```text
| state_id:uvarint |
```

## Child References

Child references are encoded as **back-distances** rather than absolute node IDs.

For a current node with ID `i` and a child with ID `j`, where `j < i`, encode:

```text
child_ref = i - 1 - j
```

Therefore:

- `0` means "the immediately preceding node",
- `1` means "two records back",
- and so on.

The decoder reconstructs:

```text
j = i - 1 - child_ref
```

This is compact because canonical postorder tends to place children near their parents, especially for non-shared subtrees.

## Complete Format

```text
| root_type_hash:32 bytes | payload_version:u8 | node_count:uvarint | node records... |
```

The root type hash identifies the canonical type automaton used to interpret all `state_id` values and all product-field / union-tag ordinals.

No separate pattern section is needed because the omitted pattern is exactly the
singleton pattern `Pat(T)` induced by that root type.

## Examples

### Example 1: Unit type `{}`

- Type: `$unit = {}`
- Canonical name: `@KL...` (hash computed by compiler)

Binary:
```text
[32 bytes: root_type_hash($unit)]
[1 byte: payload_version = 1]
[uvarint: node_count = 1]
[uvarint: state_id(unit)]
```

There is one node, and because it is the last node, it is also the root.

### Example 2: Boolean

- Type: `$bool = < {} false, {} true >`
- Value: `{true {}}`

Canonical form assigns ordinals: false=0, true=1

Binary:
```text
[32 bytes: root_type_hash($bool)]
[1 byte: payload_version = 1]
[uvarint: node_count = 2]

node 0:
  [uvarint: state_id(unit)]

node 1:
  [uvarint: state_id(bool)]
  [uvarint: tag_ordinal(true) = 1]
  [uvarint: child_ref = 0]   // points to node 0
```

There are no repeated typed subtrees here, so the minimal DAG is the same as the tree.

### Example 3: Natural number

- Type: `$nat = < {} zero, {nat succ} >`
- Value: `{{{{} zero} succ} succ}` (represents 2)

Variant ordinals: zero=0, succ=1

Binary:
```text
[32 bytes: root_type_hash($nat)]
[1 byte: payload_version = 1]
[uvarint: node_count = 4]

node 0:
  [uvarint: state_id(unit)]

node 1:
  [uvarint: state_id(nat)]
  [uvarint: tag_ordinal(zero) = 0]
  [uvarint: child_ref = 0]   // points to node 0

node 2:
  [uvarint: state_id(nat)]
  [uvarint: tag_ordinal(succ) = 1]
  [uvarint: child_ref = 0]   // points to node 1

node 3:
  [uvarint: state_id(nat)]
  [uvarint: tag_ordinal(succ) = 1]
  [uvarint: child_ref = 0]   // points to node 2
```

The root is node 3. Again, this example has no repeated typed subtrees, so only ordinary parent-to-child back-distances are used.

## Parsing and Validation

The decoder MUST:

1. Read the 32-byte root type hash.
2. Resolve the canonical type automaton for that hash.
3. Read `payload_version` and reject unknown mandatory versions.
4. Read `node_count`.
5. Parse records in node-ID order `0..N-1`.
6. For each record:
   - resolve `state_id`,
   - determine whether the state is a product or union,
   - read exactly the required number of body items,
   - verify every child reference points to an earlier node,
   - verify every child node's state matches the edge-required child state from the automaton,
   - verify union `tag_ordinal` is valid for the state.
7. Treat node `N-1` as the root node.

Malformed payloads include:

- unknown `state_id`,
- child references that point outside `[0, i)`,
- child nodes whose states do not match the type automaton,
- invalid union tag ordinals,
- trailing undecoded bytes,
- impossible empty-union values.

## Operation Friendliness

This payload is chosen so that a runtime can build an offset table in one linear scan and then execute `.` and `/` cheaply.

### `.label`

Given a pointer `(node_id, state_id)` to a product node:

1. Look up `label -> field_index` in the canonical type state.
2. Jump to the `field_index`-th child reference in the node record.
3. Follow the child reference to child node `j`.
4. The child state is already determined by the type edge.

No sibling scanning by label is needed.

### `/tag`

Given a pointer `(node_id, state_id)` to a union node:

1. Read `tag_ordinal` from the node record.
2. Compare with the requested tag's canonical ordinal.
3. On match, follow the single child reference.
4. On mismatch, fail immediately.

The discriminator is therefore available before touching the child payload.

## Implementation Requirements

### Encoder Interface

```javascript
/**
 * Encode a k value to binary format
 * @param {Object} value - k value (Product/Variant from Value.mjs)
 * @param {string} typeName - Canonical type name (e.g., "@ABC123...")
 * @param {Object} typeDef - Type definition from compiler
 * @returns {Buffer} Binary representation
 */
function encode(value, typeName, typeDef);
```

### Decoder Interface

```javascript
/**
 * Decode a k value from binary format
 * @param {Buffer} buffer - Binary data
 * @returns {Object} {typeName: string, value: Value}
 */
function decode(buffer);
```

## Extension: Streaming Format

For streaming multiple values:

```
┌─────────────┬──────────┬─────────────┬──────────┬───
│  32B hash   │  payload │  32B hash   │  payload │ ...
└─────────────┴──────────┴─────────────┴──────────┴───
```

Each value is independently parseable.

## Notes

- The payload is byte-oriented and node-oriented, not a packed bitstream of inline tree branches.
- This slightly increases per-node overhead relative to the most compact tree-only encoding, but it makes the format much friendlier to the primitive `k` operations `.label` and `/tag`.
- A future transport may add a non-canonical auxiliary index for zero-scan random access to raw bytes, but the canonical payload itself does not require one.
- In the general polymorphic format, this payload appears as the delegated leaf codec for `exact-type-leaf`.
