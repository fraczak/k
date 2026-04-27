# Object File And Pattern Type

This note sketches the next representation boundary after parsing and type
derivation. The goal is to stop treating the codec envelope as a JSON object and
instead make it an ordinary k value that can be passed to a high-performance
evaluator or lowered toward LLVM.

## Current Bootstrap Envelope

The current JSON prefix-codec envelope has this shape:

```json
{
  "pattern": [
    ["open-union", [["a", 1]]],
    ["closed-product", [["b", 2], ["c", 3]]],
    ["open-union", [["x", 3]]],
    ["closed-product", []]
  ],
  "value_bits": "..."
}
```

This is a useful bootstrap object, but it is not the semantic object we want:

- `pattern` is a rooted graph in property-list form.
- each node has a kind and labeled edges.
- each edge target is a node index.
- `value_bits` is the payload interpreted by that pattern.

The weak parts are exactly the host-shaped parts: string labels, arrays,
base64, and numeric node indices.

## Pure k Pattern Schema

[`Examples/pattern.k`](../Examples/pattern.k) defines the corresponding k
types:

Both maps use the same binary-tree shape:

```k
binary-tree? = ?< X leaf, { Y 0, Y 1 } tree > = Y;

$ label-target-tree = <
  {} empty,
  { string label, bits target } leaf,
  { label-target-tree 0, label-target-tree 1 } tree
>;

$ pattern-node = <
  {} any,
  label-target-tree open-product,
  label-target-tree open-union,
  label-target-tree closed-product,
  label-target-tree closed-union
>;

$ pattern = <
  pattern-node leaf,
  { pattern 0, pattern 1 } tree
>;
```

In this schema:

- Labels are represented by `string` payloads stored at leaves of a binary
  routing tree.
- Edge targets are bit-path node ids, not Peano `nat`.
- Pattern nodes use the same binary-tree trick, keyed by those bit-path ids.
- Label trees also have an `empty` case for nodes like the unit closed product.
- A pattern node's kind is its union tag; edge-bearing node kinds carry the
  label tree directly.
- `value-bits` is a bit list, not base64 text.

That makes the envelope a normal typed k value. The JSON envelope can remain a
debug/bootstrap transport, but it should decode into this value before entering
the evaluator boundary.

This keeps node identity explicit. A direct recursive tree of patterns would be
simpler, but it would lose the shared-node constraints that make patterns more
than just syntax.

## Object File Direction

The parser plus type-derivation phase should eventually emit an object value
rather than executable JavaScript structures. A minimal first object shape is:

```k
$ object-file = {
  pattern input-pattern,
  pattern output-pattern,
  envelope input
};
```

This is intentionally small. It captures the typed input contract, the typed
output contract, and the concrete input payload. Later versions can add relation
IR, constant tables, symbol dictionaries, relocation/linking records, and
optimization metadata.

## Conversion Boundary

The immediate bridge is:

1. Parse the current JSON envelope.
2. Convert property-list pattern nodes into `$pattern`.
3. Store JSON labels as k `string` values in `label-target-tree` leaves.
4. Convert numeric node targets into temporary binary node ids.
5. Convert `value_bits` from base64 into `$bits`.
6. Pass the resulting `$envelope` value to the evaluator/object pipeline.

[`codecs/runtime/k-object.mjs`](../codecs/runtime/k-object.mjs) implements this
first bridge for the current JSON bootstrap envelope. It materializes the
envelope as regular `Product`/`Variant` values whose shape matches
`Examples/pattern.k`.

Once this exists, the high-performance evaluator can consume a single k object
model instead of a mixture of JSON, JavaScript `Value` objects, and pattern
property lists.
