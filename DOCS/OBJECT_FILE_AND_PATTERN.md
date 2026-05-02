# Object File And Pattern Type

This note records the representation boundary after parsing and type derivation.
The codec boundary is no longer a JSON object. A serialized value is one binary
stream:

```text
encode($pattern_value : $pattern) encode(value : decoded_pattern)
```

The pattern is the framing protocol. There is no separate envelope type.

## Pattern Schema

[`core.k`](../core.k) defines the canonical self-hosted pattern type:

```k
$ edge = { string label, bits target };
$ edges = < {} nil, { edge car, edges cdr } cons >;

$ pattern-node = <
  {} any,
  edges open-product,
  edges open-union,
  edges closed-product,
  edges closed-union
>;

$ pattern = < {} nil, { pattern-node car, pattern cdr } cons >;
```

In this schema:

- the first pattern-list element is node `0`, the root,
- an edge target is a node index encoded as `$bits`,
- labels are `$string` values and therefore Unicode scalar-value strings,
- edge lists are sorted by label,
- `any` carries no edges,
- the four product/union node kinds carry their edge list directly.

The fixed singleton pattern of `$pattern` is the first decoder context for all
k wire values. Decoding any value first decodes a `$pattern` value under that
constant, then decodes the remaining bits under the pattern just obtained.

## Debug Notation

Documentation and tests often show patterns as property-list JSON because it is
compact to read:

```json
[
  ["open-union", [["a", 1]]],
  ["closed-product", [["b", 2], ["c", 3]]],
  ["open-union", [["x", 3]]],
  ["closed-product", []]
]
```

That notation is not a transport format. It is only a host-side rendering of
the same abstract graph.

## Object File Direction

The parser plus type-derivation phase should eventually emit an object value
rather than executable JavaScript structures. A minimal first object shape is:

```k
$ object-file = {
  pattern input-pattern,
  pattern output-pattern,
  pattern value-pattern
};
```

The concrete input payload is then stored in the same binary stream form:
`encode(value-pattern) encode(input : value-pattern)`. The exact object-file
type still needs design work because the concrete input value is typed by the
decoded pattern. The important boundary is that object files should carry
ordinary k values and patterns, not a JSON codec object.

Later versions can add relation IR, constant tables, symbol dictionaries,
relocation/linking records, optimization metadata, and optional indexes.
