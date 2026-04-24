# K Codecs

This directory contains the current binary codec work for `k` values.

The active direction is the polymorphic binary package described in
[`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md). Older notes and
some helper files still refer to a closed typed-value format, but the main
runtime and CLI tools now use `KPV2` packages.

## What A Codec Does

A codec is an adapter between an external representation and a `k` value encoded
as a binary package:

```text
external bytes/text -> codec parser -> KPV2 package
KPV2 package -> codec printer -> external bytes/text
```

That makes codecs the boundary between ordinary files, streams, terminal text,
and compiled `k` programs. A compiled program should be able to read a `KPV2`
package, operate on the value, and write another `KPV2` package.

## Current Binary Model

The semantic object serialized by the active format is:

```text
(P, v)
```

where:

- `P` is a normalized rooted pattern graph.
- `v` is a value compatible with that pattern.

The package layout is:

```text
| magic | format_version | flags | symbol_table | pattern_section | value_section |
```

Current header values:

- `magic = "KPV2"`
- `format_version = 1`
- `flags = 0`

The pattern section is the structural authority. It carries field names, tag
names, open/closed product and union shape, and graph sharing. The value section
is interpreted relative to that pattern, so it does not repeat labels or tags as
strings.

Pattern node kinds are encoded as:

```text
0 = (...)
1 = {...}
2 = <...>
3 = {}
4 = <>
```

Version 1 does not serialize arbitrary value content below `(...)`. Encoders may
refine an open or unconstrained input pattern into a concrete pattern that is
sufficient for the value being written.

See [`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md) for the
normative byte-level rules.

## Why This Replaced The Old Format

The older README described packages shaped like:

```text
[32-byte type hash][canonical payload]
```

That model only handles closed typed values cleanly. It is still useful as a
possible specialization, and [`BINARY_FORMAT.md`](./BINARY_FORMAT.md) now frames
it that way, but it is not the main interchange package used by the codec
runtime.

The polymorphic format is more general because it can represent values relative
to a pattern, including open product and union patterns. Closed typed values are
just the singleton-pattern case.

## Runtime API

The runtime implementation lives in [`runtime/codec.mjs`](./runtime/codec.mjs).

Main exports:

- `encode(value, typeName, typeInfo, resolveType)`: derive a closed singleton
  pattern from a concrete type and write a `KPV2` package.
- `encodeWithPattern(value, pattern)`: write a `KPV2` package relative to an
  explicit pattern object. The runtime refines open or `(...)` parts as needed
  for the observed value.
- `decode(buffer)`: read a `KPV2` package and return `{ pattern, value }`.
- `decodeDebug(buffer)`: read a package and return decoded pattern and value-DAG
  metadata for inspection.
- `exportPatternGraph(typePatternGraph, rootPatternId)`: convert the compiler's
  internal pattern graph into the codec pattern representation.
- `NODE_KIND`: symbolic constants for the five pattern node kinds.

Example:

```javascript
import { encodeWithPattern, decode, NODE_KIND } from "./runtime/codec.mjs";
import { Product } from "../Value.mjs";

const unitPattern = {
  dictionary: [],
  nodes: [{ kind: NODE_KIND.ANY, edges: [] }]
};

const bytes = encodeWithPattern(new Product({}), unitPattern);
const { pattern, value } = decode(bytes);
```

## Command-Line Tools

### Generic k value parser/printer

[`k-parse.mjs`](./k-parse.mjs) parses textual `k` values and writes `KPV2`
packages.

```bash
echo 'true' | node ./codecs/k-parse.mjs > value.kpv2
node ./codecs/k-print.mjs value.kpv2
```

By default, `k-parse` starts from `(...)` and lets the runtime refine the pattern
from the parsed value.

Use `--input-pattern` to encode relative to a `k` filter pattern:

```bash
echo '["zebara","ela"]' \
  | node ./codecs/k-parse.mjs --input-pattern '?{<{} zebara, {} ela> 0, <{} zebara, {} ela> 1}' \
  > value.kpv2
```

Use `--input-type` for the closed typed-value path:

```bash
echo '["zebara","ela"]' \
  | node ./codecs/k-parse.mjs --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v' \
  > value.kpv2
```

`k-print` writes JSON for the decoded value by default. Use `--debug` to inspect
the package's pattern graph and value DAG:

```bash
node ./codecs/k-print.mjs --debug value.kpv2
```

### Specialized codecs

Current specialized adapters include:

- [`unit.mjs`](./unit.mjs): parse/print the unit value.
- [`int.mjs`](./int.mjs): parse/print decimal integers using the current `k`
  integer shape.
- [`utf8.mjs`](./utf8.mjs): UTF-8 text to/from the current `k` string shape.
- [`utf16.mjs`](./utf16.mjs): BOM-aware UTF-16 input and UTF-16LE-with-BOM
  output to/from the current `k` string shape.

Examples:

```bash
echo '-21' | node ./codecs/int.mjs --parse | node ./codecs/int.mjs --print
printf 'A🙂\nBé~\t' | ./codecs/utf8.mjs --parse | ./codecs/utf8.mjs --print
node ./codecs/unit.mjs --parse | node ./codecs/unit.mjs --print
```

## Pipeline Example

The intended boundary shape is:

```text
TEXT/BYTES -> codec parser -> KPV2 -> k program -> KPV2 -> codec printer -> TEXT/BYTES
```

For example, the test suite exercises:

```bash
echo '["zebara", "ela", "kupa", ala, owca]' \
  | node ./codecs/k-parse.mjs \
  | ./k.mjs '{.1 0,.3 1}' \
  | node ./codecs/k-print.mjs
```

## Implementation Notes

- Symbols are UTF-8 strings interned once in the package symbol table.
- Pattern nodes are numbered by rooted depth-first discovery.
- Value nodes are emitted in canonical postorder, with the root value node last.
- Child references are encoded as back-distances, not absolute IDs.
- Products store child references in pattern-edge order.
- Unions store a tag ordinal plus one child reference.
- Repeated value occurrences may be shared when their decorated value-node
  identity is equal.

## Legacy And Experimental Files

- [`BINARY_FORMAT.md`](./BINARY_FORMAT.md) documents a closed-value
  specialization and should be read as subordinate to the polymorphic format.
- [`runtime/envelope.mjs`](./runtime/envelope.mjs) contains an older `KBIN1`
  JSON-metadata envelope helper. It is not the active `KPV2` runtime path.
- [`example-pipeline.mjs`](./example-pipeline.mjs) and
  [`runtime/test-codec.mjs`](./runtime/test-codec.mjs) still demonstrate the
  closed-type API, but the bytes they write come from the current `KPV2`
  runtime.

## Testing

Run the codec-related checks through the project test suite:

```bash
npm test
```

For a smaller smoke test during codec work:

```bash
node ./codecs/runtime/test-codec.mjs
echo '-21' | node ./codecs/int.mjs --parse | node ./codecs/int.mjs --print
node ./codecs/unit.mjs --parse | node ./codecs/unit.mjs --print
```

## References

- [`POLYMORPHIC_BINARY_FORMAT.md`](./POLYMORPHIC_BINARY_FORMAT.md): active
  package specification.
- [`BINARY_FORMAT.md`](./BINARY_FORMAT.md): closed-value specialization notes.
- [`runtime/codec.mjs`](./runtime/codec.mjs): current encoder/decoder.
- [`../Value.mjs`](../Value.mjs): runtime value representation.
- [`../valueIO.mjs`](../valueIO.mjs): textual value parsing and printing support.
