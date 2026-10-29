# Textual k values

`k-parse` and `k-print` translate between readable trees and the binary
[schema+payload stream](../codecs/WIRE_FORMAT.md).

This boundary notation is separate from relation source syntax. It resembles
JSON, but its leaves and numeric-looking tokens represent structural k data;
use `k-json`, `k-int`, or the other [codecs](../codecs/README.md) for external
JSON and numeric meanings.

## Trees and shorthand

Products map labels to child values; variants select one tag and its payload.
The empty product `{}` is the unit leaf.

Accepted forms include:

```text
{}
{"x":{},"y":{}}
{"succ":{"succ":{"zero":{}}}}
```

An atomic label such as `zero` or `"zero"` abbreviates a unit variant.
The last tree can therefore be written:

```text
{"succ":{"succ":"zero"}}
```

Square-bracket notation such as `[a,b]` abbreviates a tree with numeric labels
`0` and `1`. It is an indexed product, not the `cons`/`nil` list representation;
a one-element array has the same singleton ambiguity described below.

In relation source, the corresponding constructor expression is:

```k
{} |zero |succ |succ
```

`k-print` emits boundary notation, with shorthand where available.
The REPL renders the relation-style value and its envelope instead.

## Singleton ambiguity

A single-child tree such as `{"item":{}}` could mean either a singleton
product or a variant. Its pattern decides which.

Without an explicit pattern, witness derivation treats:

- empty nodes as closed products;
- multiple-child nodes as closed products;
- single-child nodes as open unions.

Use an open product filter when you need to convert the parsed singleton into
a product. Fully closed patterns validate the existing product/variant kind
without that conversion.

## Commands

From the repository root:

```sh
printf '%s\n' '{"x":{},"y":{}}' |
  node codecs/k-parse.mjs | node codecs/k-print.mjs
```

For a singleton product:

```sh
printf '%s\n' '{"item":{}}' |
  node codecs/k-parse.mjs --input-type '?{ {} item, ... }' |
  node codecs/k-print.mjs
```

`--input-type` accepts a filter script or file.
`--input-pattern` accepts a property-list pattern as JSON or a file.
Choose one of those options. `k-parse` also accepts an input value filename;
otherwise it reads stdin.

`k-print` decodes the carried pattern and payload before rendering.
The text by itself may not retain all envelope distinctions, so compare
patterns as well as rendered payloads when checking conformance.

For source programs and compiled artifacts, see [file formats](FILE_FORMATS.md).
