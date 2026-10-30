# Writing codecs

A codec converts an external representation into an enveloped k `Value` and
back again. The common runner makes the same module usable from a shell pipeline
and the [REPL](REPL.md).

## Module contract

A standard text codec exports:

- `parse(text)`: return a `Value` with a pattern; throw on invalid input.
- `print(value)`: return external text; throw when the value cannot be represented.
- `doc`: optional help text describing syntax and representation.

The REPL identifies a codec by its file name. Input uses a selected codec;
output tries all loaded codecs and displays each successful rendering.

Import helpers from `codecs/runtime/codec-sdk.mjs`:

| Helper | Purpose |
| --- | --- |
| `Value.product` / `Value.variant` | Construct structural values |
| `isProduct` / `isVariant` | Recognize values structurally |
| `withPattern` | Attach a pattern to a value |
| `patternFromFilter` | Derive a normalized pattern from k source |
| `encodeToWire` / `decodeWire` | Convert enveloped values to/from binary streams |
| `decodeWireLazy` | Decode with bitstream-backed value access |
| `runCodecCLI` | Entrypoint detection, flags, stdin/stdout, and wire conversion |

Derive fixed schemas through `patternFromFilter` rather than maintaining a
duplicate handwritten graph. Codecs whose structure depends on external input,
such as JSON, can derive document-specific patterns.

## Complete example

Save this as `codecs/yesno.mjs`. It maps `yes`/`no` to unit variants under
the boolean schema:

```js
#!/usr/bin/env node
import {
  Value, isProduct, isVariant, withPattern, patternFromFilter, runCodecCLI
} from "./runtime/codec-sdk.mjs";

const BOOL_PATTERN = patternFromFilter("?< {} false, {} true >");
export const doc = "Boolean codec: accepts yes or no.";

export function parse(text) {
  const word = text.trim();
  const tag = word === "yes" ? "true" : word === "no" ? "false" : null;
  if (!tag) throw new Error("expected yes or no");
  return withPattern(Value.variant(tag, Value.product({})), BOOL_PATTERN);
}

export function print(value) {
  if (!isVariant(value) || !isProduct(value.value) ||
      Object.keys(value.value.product).length !== 0) {
    throw new Error("expected a boolean unit variant");
  }
  if (value.tag === "true") return "yes";
  if (value.tag === "false") return "no";
  throw new Error("expected true or false");
}

runCodecCLI(import.meta.url, { parse, print, doc });
```

From the repository root:

```sh
printf 'yes\n' | node codecs/yesno.mjs --parse |
  node codecs/yesno.mjs --print
```

This prints `yes`. In the REPL:

```text
:codec load codecs/yesno.mjs
:input yesno.mjs yes
```

The REPL displays the structural value and `yesno.mjs: yes`.

## CLI behavior

`runCodecCLI(import.meta.url, { parse, print, doc })` acts only when the module
is invoked as the entrypoint:

- `--parse` reads external input and writes a binary schema+payload stream.
- `--print` reads that stream and writes the external rendering.
- `-h` / `--help` writes usage and `doc`.
- Errors go to stderr and cause a nonzero exit.

Text rendering normally adds a newline. Modules handling binary external input
can set `readBuffer: true`; `addNewline: false` suppresses the output newline.
A zero-argument `parse` can produce a value without reading stdin, as the unit
codec does.

The pattern is selected from the parsed value, a module-supplied pattern, or
witness derivation. General wire semantics are specified in
[WIRE_FORMAT.md](../codecs/WIRE_FORMAT.md).

## Existing codecs

| Module / installed command | Representation |
| --- | --- |
| `int.mjs` / `k-int` | Decimal integers and integer lists as signed bit trees |
| `ieee.mjs` / `k-ieee` | Binary64 floats as sign/exponent/fraction records |
| `utf8.mjs` / `k-utf8` | UTF-8 text as the Unicode scalar list `string[]` from core.k |
| `utf16.mjs` / `k-utf16` | UTF-16 external bytes mapped to the same string structure |
| `unit.mjs` / `k-unit` | Unit |
| `json.mjs` / `k-json` | Document-specific schemas: objects as products, arrays as indexed products |
| `djson.mjs` / `k-djson` | One recursive JSON representation using binary tries for objects and arrays |

`Examples/djson.k` supplies operations such as `get`, `nth`, `set`,
`del`, `push`, `keys`, and `values`. The specializing JSON codec and dynamic
JSON codec serve different schemas; they are not interchangeable encodings.

The library references core and IEEE types by their canonical hashes, as
`poly.k` references the integer type. Its `number[]` is the IEEE `float64[]`;
the sign, exponent, and fraction schemas are shared too. In the REPL, load
`core.k`, `Examples/ieee.k`, then `Examples/djson.k`. When compiling, build the
IEEE library with core first so it carries both sets of types.

`Examples/ieee.k` contains the binary64 representation, small constructors and
predicates, and text conversion. Heavy add/subtract/multiply/divide definitions
are in `Examples/ieee-arithmetics.k`; load that file after `core.k` and `ieee.k`
when arithmetic is needed. JSON parsing uses the lightweight library alone.

`parseFloat64`: `string[]` → `float64[]` accepts JSON-style decimal syntax,
an optional leading `+`, surrounding ASCII JSON whitespace, and the words
`Infinity` and `NaN` with optional signs. Overflow yields signed infinity;
underflow preserves signed zero. Invalid text is undefined.
`printFloat64`: `float64[]` → `string[]` produces an exact decimal expansion
for finite values, preserving signed zero. It prints infinities as `Infinity`
or `-Infinity`, and all NaNs as `NaN`. Parsing NaN text selects one canonical
payload; NaN payloads are not preserved through text.
The printer prioritizes exact round-trips over shortest formatting: `0.1`
prints as `0.1000000000000000055511151231257827021181583404541015625`.

The library also defines `parseJson`: `string[]` → `djson[]`, entirely in k.
It consumes one complete JSON document, including nested containers, Unicode
escapes, and decimal numbers rounded to binary64. Invalid JSON, unpaired
surrogate escapes, and numbers that overflow to infinity are undefined.
For example, decode UTF-8 to a k string, then parse that string in k:

```sh
node objects/compile.mjs --lib core.k Examples/ieee.k /tmp/ieee-core.klib
node objects/compile.mjs --lib /tmp/ieee-core.klib Examples/djson.k /tmp/djson.klib
printf '%s' '{"answer":42}' | node codecs/utf8.mjs --parse |
  node k.mjs --lib /tmp/djson.klib --export parseJson 'parseJson' |
  node codecs/djson.mjs --print
```

This prints `{"answer":42}`. Exact conversion near binary64 limits is expensive
in the envelope-aware JavaScript interpreter; the Wasm backend runs the same
relation with much less overhead.

The compiled IEEE library also supports a complete text round-trip in k:

```sh
printf '%s' '1.5' | node codecs/utf8.mjs --parse |
  node k.mjs --lib /tmp/ieee-core.klib --export parseFloat64 --export printFloat64 'parseFloat64 printFloat64' |
  node codecs/utf8.mjs --print
```

For arithmetic, compile the optional layer against the same IEEE library:

```sh
node objects/compile.mjs --lib /tmp/ieee-core.klib Examples/ieee-arithmetics.k /tmp/ieee-arithmetics.klib
```

`k-parse` and `k-print` use [textual k values](TEXTUAL_VALUES.md), rather than
the external integer/string/JSON interpretations above.

## Browser bundling and verification

`scripts/build-repl-html.mjs` bundles a curated set of codecs as self-contained
ES modules in the virtual filesystem. The browser shim supplies pattern
derivation and disables CLI entrypoint behavior. It loads modules through Blob
URLs without exposing codec runtime helper files in the VFS.

A new codec needs explicit inclusion in that build to be available in the
standalone browser REPL.

Check valid and invalid input, round trips, shape rejection in `print`, CLI
help, and REPL loading. Existing examples are in `tests/test-codecs.mjs` and
`tests/test-repl.mjs`. Run `npm test` after changing codec behavior.
