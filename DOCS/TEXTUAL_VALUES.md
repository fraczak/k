# Textual k Values

`k-parse` and `k-print` work with a textual notation for k values.

It looks like JSON because products print as JSON objects, but semantically it
is not a generic JSON format. It is a readable notation for values built from
the two k data constructors:

- product
- tagged union

## The Value Model

A k value is a tree.

- A product is a mapping from field labels to child values.
- A union is a single chosen tag together with its payload value.

There are no primitive leaves. The base leaf is the empty product:

```text
{}
```

## Textual Notation

The textual notation used by `k-parse` and `k-print` is:

- `{}` for the empty product
- `{"field": value, ...}` for a product
- `{"tag": value}` for a union

The last form is why the notation only looks like JSON. Syntactically, a
single-entry object is ambiguous in plain JSON, but in k it is interpreted
through the inferred or supplied pattern.

Examples:

```text
{}
```

```text
{"point":{"x":{},"y":{}}}
```

```text
{"succ":{"succ":{"zero":{}}}}
```

The last example is the k value usually written in native notation as:

```k
{}|zero|succ|succ
```

## Relation to Native k Notation

The native k notation is more explicit for interactive work:

- product construction: `{ v field, w other }`
- union introduction: `v |tag`

`k-print` does not emit that native notation. It emits the JSON-like tree
notation because it is easy to pipe, inspect, and round-trip through standard
text tooling.

## `k-parse`

`k-parse`:

1. reads textual k values
2. optionally takes an input type or input pattern
3. produces the binary `pattern + value` stream

When no explicit pattern or type is supplied, `k-parse` derives a witness
pattern from the textual tree.

## `k-print`

`k-print`:

1. reads the binary `pattern + value` stream
2. decodes it to a runtime value with its carried pattern
3. prints the value tree in JSON-like notation

So `k-print` is not a JSON decoder in the general sense. It is a renderer from
k runtime values to a JSON-shaped textual notation.

## Ambiguity and Patterns

The textual tree alone does not always determine whether a single-child node is
meant as a union or a singleton product. That is why patterns matter.

When `k-parse` has no explicit input pattern, it applies the current witness
rule:

- empty node => closed product
- node with multiple children => closed product
- node with one child => open union by default

An explicit input pattern or input type can force a different interpretation.

## See Also

- [codecs/README.md](../codecs/README.md)
- [DOCS/PATTERNS.md](./PATTERNS.md)
- [DOCS/OBJECT_FILE_AND_PATTERN.md](./OBJECT_FILE_AND_PATTERN.md)
