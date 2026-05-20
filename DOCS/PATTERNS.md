# Patterns

A pattern describes the shape of values that may flow through a k expression.
Patterns are used by:

- the type-derivation engine
- the binary codec
- runtime values carried by the codec pipeline
- filter expressions

## Pattern Kinds

The exported canonical pattern form is a property-list array of nodes.

Each node has the form:

```text
[kind, edges]
```

where `kind` is one of:

- `"any"`
- `"open-product"`
- `"open-union"`
- `"closed-product"`
- `"closed-union"`

and `edges` is a list of:

```text
[label, targetNodeId]
```

Example:

```json
[
  ["closed-union", [["nil", 1], ["cons", 2]]],
  ["closed-product", []],
  ["closed-product", [["car", 3], ["cdr", 0]]],
  ["closed-union", [["_", 1], ["0", 3], ["1", 3]]]
]
```

This is not the wire format. It is the canonical readable export form.

## Filters and Type Names

A k script can describe a pattern through:

- a type name in terminal position
- a filter expression in terminal position

Examples:

```k
$ bits = < {} _, bits 0, bits 1 >;
$ list = < {} nil, { bits car, list cdr } cons >;
list
```

```k
?< {} nil, { $bits car, X cdr } cons > = X
```

In both cases, the compiler derives a root pattern from `__main__`.

## Pattern Export Helper

`patterns/from-k.mjs` extracts that root pattern from a k script. It is a
repository helper, not an installed `package.json` binary.

It:

1. reads a k script from stdin or a file argument
2. runs `k.annotate(...)`
3. resolves `__main__`
4. requires `__main__` to be either:
   - a filter expression
   - a type name
5. exports the corresponding root pattern
6. prints it as the canonical property-list array

Example:

```bash
echo '?< {} nil, { $bits car, X cdr } cons > = X' | node ./patterns/from-k.mjs
```

Typical output:

```json
[["closed-union",[["nil",1],["cons",2]]],["closed-product",[]],["closed-product",[["car",3],["cdr",0]]],["closed-union",[["_",1],["0",3],["1",3]]]]
```

## Patterns in the Codec

The active wire format is:

```text
encode($pattern_value : $pattern) encode(value : decoded_pattern)
```

So the property-list array printed by `patterns/from-k.mjs` is a readable
externalization of the same pattern information carried in the wire stream.

`k-parse --input-pattern ...` and `k-parse --input-type ...` both ultimately
produce the same kind of root pattern used to interpret textual values.

## See Also

- [DOCS/TEXTUAL_VALUES.md](./TEXTUAL_VALUES.md)
- [codecs/README.md](../codecs/README.md)
- [DOCS/OBJECT_FILE_AND_PATTERN.md](./OBJECT_FILE_AND_PATTERN.md)
