# KVBF: Kernel Value Binary Format (canonical core)

This document defines KVBF, a binary container for k values.
KVBF is the canonical, deterministic serialization for values.
It encodes a pair (type_id, value_bits).
The type_id identifies the canonical type automaton.
The value_bits are the canonical core encoding of a value accepted by that type.

KVBF currently supports only union, product, and unit nodes.
There are no external primitive encodings in the canonical core.
All numeric, string, or other data must be defined in k itself.
The decoder therefore relies only on the type registry and the bitstream.
This keeps the format minimal and mathematically defined.

## Type identity

The type_id is the raw SHA-256 digest of the canonical type definition.
It is 32 bytes, stored verbatim with no encoding and no length prefix.
The canonical type definition is not embedded in KVBF.

## Envelope format

All fields are byte-oriented except the payload bits.
The envelope layout is:

```
| Flags (1 byte) | Type ID (32 bytes) | Payload Bytes |
```

- Flags: reserved for future use; must be 0 for now.
- Type ID: 32 raw bytes as defined above.
- Payload Bytes: the core bitstream, padded with 0-7 zero bits to the next byte boundary.

Padding: The last payload byte may include 0-7 zero padding bits.
Padding bits are not part of the core.
KVBF values can be concatenated in a stream by placing envelopes back-to-back, but
in the absence of a length field, streaming requires external framing.
Parsers must not accept non-zero flags in the canonical profile.

All payload bytes are raw; there is no endianness for bits beyond the bit order rules below.
Future extensions must be added via flags and separate non-canonical profiles.

## Canonical core encoding (DAG-aware)

The core is a prefix-free bitstream defined by the canonical type automaton.
The canonical core includes DAG compression with deterministic sharing.
States are numbered C0, C1, ... and transitions are labeled strings.
The ordering of labels is the lexicographic order of their JSON string form.
This is the same ordering used by `encodeCodeToString` in `codes.mjs`.
Product fields and union variants both follow this label ordering.

### DAG markers and back-references

Each node in the value tree is encoded with a 1-bit marker:

- `0` = inline definition (encode this node normally, then its children).
- `1` = back-reference (encode a node id, no children follow).

Back-reference ids are encoded using one of two options (kept in parallel for now):

- Option A: ULEB128 (7-bit groups, LSB-first), byte-oriented and fast to decode.
- Option B: k-native bnat encoding (prefix-free, bit-level, conceptually uniform).

We will choose one option later; the rest of the DAG rules are identical.
The first defined node in preorder has id 0, next id 1, and so on.
An encoder must share all repeated subtrees:

- Compute a structural signature for each node.
- If the signature was seen before, emit a back-reference to its id.
- Otherwise assign a new id, emit an inline definition, and continue.

This yields a unique canonical DAG encoding for each value.

Structural signature:

- For a product state, signature is `(state_id, [sig(child_0), ..., sig(child_n-1)])`.
- For a union state, signature is `(state_id, variant_index, sig(child))`.
- For a unit state, signature is `(state_id)`.

Implementations should hash signatures for efficiency, but the definition is structural.

### Inline node encoding

Let a state be a product or union in the canonical automaton.

- Product state with fields f0..fn-1: emit no bits, then encode each child in order.
- Union state with m variants v0..vm-1: emit a discriminator, then encode the chosen child.
- Unit state (product with 0 fields): emit no bits.

Discriminator encoding:
- Let k = ceil(log2(m)).
- The variant index i (0-based in label order) is encoded as a k-bit unsigned integer.
- Bits are emitted most-significant first (big-endian bit order within the k-bit group).
- For m = 1, k = 0 and no bits are emitted.

Because decoding follows the automaton structure, the core bitstream is self-delimiting.
There are no length prefixes within the core.
The canonical core is the unique serialization for a given (type_id, value).
Other compression or alignment schemes are not part of the canonical core.

## Example (bnat)

For bnat defined by:

```
$C0 = < C0 "0", C0 "1", C1 "_" >;
$C1 = {};
```

The union at C0 has m = 3 variants, so k = 2.
The codes are: "0" -> 00, "1" -> 01, "_" -> 10.
The value {}|_|0|1 (binary 10) encodes as:

```
0|01 0|00 0|10 0
```

Here `0|` marks inline definitions; no back-references are used.
This bitstream is the payload core; it is then wrapped in the KVBF envelope.

## Notes on future flexibility

The canonical core fixes a single label order and discriminator rule.
Future non-canonical profiles may reorder fields or add alignment.
Such profiles must not change the meaning of the value, only its layout.
Canonical decoding must always accept only the core format defined here.
