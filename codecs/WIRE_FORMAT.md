# Wire format

A k wire value is a pattern envelope followed by a payload tree encoded under
that pattern:

```text
encode(pattern_value : pattern[]) encode(payload : decoded_pattern)
```

There is no JSON transport container or value-DAG table in this format.
Property-list graphs shown below are host-side inspection notation.

## Pattern framing

[core.k](../core.k) defines `pattern[]` as a list of graph nodes. Each node
is one of five tagged variants:

| Kind | Edges mean |
| --- | --- |
| `any` | Unconstrained position; no edges |
| `open-product` | Required fields, permitting additional schema fields |
| `closed-product` | Exactly the listed fields |
| `open-union` | Required tags, permitting additional schema tags |
| `closed-union` | Exactly the listed tags |

Edges pair a Unicode `string[]` label with a target node index encoded as
`bits[]`. Node zero is the root. Edge labels are unique within a node and use
canonical label order; graph nodes use canonical discovery order.

The complete closed schema of `pattern[]` is a fixed decoder context, shared
by both ends of the stream. It admits many pattern values; it is not a schema
with only one possible document. Its concrete graph is
`CORE_PATTERN_PROPERTY_LIST` in
[prefix-codec.mjs](runtime/prefix-codec.mjs).

The decoder first reads a pattern value under that context, then uses the
decoded graph for the payload.

## Graph notation

The host representation is an array of `[kind, edges]` nodes, where each
edge is `[label, targetIndex]`. For a list of units:

```json
[
  ["closed-union", [["cons", 1], ["nil", 2]]],
  ["closed-product", [["car", 2], ["cdr", 0]]],
  ["closed-product", []]
]
```

This is the graph exported by the
[pattern helper](../DOCS/PATTERNS.md#inspection-and-persistence), not the bytes
written to a stream.

## Payload bits

For a product, encode each field payload in canonical edge order, concatenated
without separators or repeated field names.

For a union with `n` tags, encode the selected tag's zero-based ordinal using:

```text
width = ceil(log2(n))
```

Then encode the selected payload under its target pattern. Invalid ordinals
are rejected. An empty union has no encodable values.

| Case | Choice/payload cost |
| --- | --- |
| Unit `{}` | Zero bits |
| Singleton union | Zero choice bits |
| Two-tag union | One choice bit |
| Three- or four-tag union | Two choice bits |

Bits are packed most significant first. Header and payload share one bitstream;
there is no byte-alignment gap between them. Output zero-pads the final byte.
The decoder rejects truncation, invalid choices, and nonzero trailing padding.

`any` cannot directly encode a payload. The pattern must first be refined with
enough structure for each position reached by the value.

## Witness-derived patterns

Without an explicit pattern, textual k values use these witness rules:

- an empty node becomes a closed product;
- a node with multiple children becomes a closed product;
- a single-child node becomes an open union.

An open product input filter disambiguates a parsed singleton product;
fully closed patterns instead expect the value to already have the right kind.
For example,
`{a:{b:x,c:{}}}` derives:

```json
[
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]
```

Finite closed subgraphs are collapsed from the leaves upward when their kinds,
labels, and children agree. Open nodes retain distinct positions and their
constraints. This is graph normalization of the pattern, not compression of
repeated payload subtrees.

When encoding an enveloped runtime `Value`, `encodeToWire` uses the carried
pattern by default, or an explicitly supplied compatible pattern. Open or
incomplete patterns are refined against the value; closed graphs are
canonicalized and encoded directly.

## Navigation and runtime values

`/tag` reads a choice code and continues into the matching payload.
`.field` locates the field in the pattern and decodes or skips preceding
children. The base format has no field-offset index or back-references.

Recursive graphs are encoded by following the finite payload tree, not by
unrolling the pattern into a table of value nodes. The in-memory evaluator
carries the selected subpattern through projections and constructs envelopes
for new products and variants.

`decodeWire` materializes a value; `decodeWireLazy` supports bitstream-backed
access. These are implementation choices over the same wire representation.

See [textual values](../DOCS/TEXTUAL_VALUES.md),
[codec authoring](../DOCS/CODECS.md), and
[file formats](../DOCS/FILE_FORMATS.md) for the surrounding boundaries.
