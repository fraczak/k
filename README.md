# k

k is a small language for describing algebraic data shapes and composing
transformations over them. Programs are first-order partial functions, called
*relations*, built from products, tagged unions, and composition. Named patterns
describe reusable schemas; the compiler derives structural input/output contracts.

**[Try k in the browser](https://fraczak.github.io/k/)** ·
**[Getting started](DOCS/GETTING_STARTED.md)** ·
**[Documentation](DOCS/README.md)**

The [paper on Zenodo](https://zenodo.org/records/23652382) introduces the language.
Its [LaTeX source](paper/k-paper.tex) and [PDF](paper/k-paper.pdf) are in this
repository.

## A small example

This relation swaps two fields:

```k
swap = { .x y, .y x };
{ {} |hello x, {} |world y } swap
```

Each field expression receives the same input. The result has `world` under
`x` and `hello` under `y`. Relations can be undefined for some inputs, and
ordered choice `<f, g>` tries `g` when `f` returns undefined.

All values are built from products and variants. Integers and strings are
library-defined structures, with codecs for familiar external representations.

## Run from source

Use Node.js 22+ for development and the browser tests.
The published runtime supports Node.js 18+.

```sh
npm install
node repl.mjs
```

`npm install` generates the parsers. From another terminal at the repository
root, try a complete pipeline:

```sh
node codecs/unit.mjs --parse | node k.mjs '{} |ok' | node codecs/k-print.mjs
```

It prints `"ok"`. The pipeline carries a binary schema followed by a payload;
the codec commands handle the text boundaries.

To expose the commands on your path, run `npm link`. The equivalent pipeline is:

```sh
k-unit --parse | k '{} |ok' | k-print
```

Build the standalone browser REPL with `npm run build:repl-html`, then open
`repl.html`. See the [walkthrough](DOCS/GETTING_STARTED.md) for recursive
relations, libraries, and codecs.

## Libraries and examples

| File | Purpose |
| --- | --- |
| [core.k](core.k) | Standalone bit, Unicode string, and self-hosted pattern schemas (`bit[]`, `bits[]`, `list[X]`, `string[]`, `pattern[]`) |
| [lib/generic.k](lib/generic.k) | Algebraic types, binary tries, and string/bit codecs (`bool[]`, `order[]`, `opt[V]`, `btrie[V]`, `string_to_bits`, `bits_to_string`) |
| [lib/integer.k](lib/integer.k) | Signed arbitrary-precision integer arithmetic (`int[]`, `nat`, `int`, `plus`, `minus`, `times` via Karatsuba, `divmod`, `div`, `mod`, `gcd`, `lcm`) |
| [lib/ieee.k](lib/ieee.k) | Binary64 types, predicates, negation, and rational conversions (`float64[]`, `negate_float64`, `bits_to_float64`, `ratio_to_float64`) |
| [lib/djson.k](lib/djson.k) | RFC 8259 JSON parser (`parse_json`) and dynamic JSON operations (`djson[]`, `get`, `nth`, `set`, `del`, `push`, `keys`, `values`) |
| [Examples/nat.k](Examples/nat.k) | Small Peano arithmetic example |
| [Examples/poly.k](Examples/poly.k) | Polymorphic list operations indexed by `int[]`; load `lib/integer.k` first |
| [Examples/ieee-arithmetics.k](Examples/ieee-arithmetics.k) | Binary64 arithmetic returning `{result, flags}`; load `core.k` and `lib/ieee.k` first |

Load libraries explicitly with `:load` in the REPL. Leading
`# --lib <dependency> --use <specs>` lines in source files are ordinary
human-readable comments documenting expected dependencies. On the CLI,
`--lib <dependency.klib>` makes library definitions available in memory by
content hash (`@<hash>`), while `--use` explicitly brings requested friendly
names or aliases into compilation scope. See
[file formats and tools](DOCS/FILE_FORMATS.md).

## JavaScript API

```js
import k from "@fraczak/k";

const fn = k.compile("{} |ok");
const result = fn(k.fromObject({}));
console.log(result.tag); // "ok"
```

Compiled functions return a `Value` or `undefined`. A `Value` carries its
structural pattern as well as its payload.

## Development

```sh
npm test
npm run test:backends
npm --prefix k-vscode test
```

See [tests/README.md](tests/README.md) for suite boundaries and optional tools.
Grammar changes require `npm run prepare`; generated parsers are not edited
by hand.

The [compiler guide](DOCS/ARCHITECTURE.md) maps the implementation and execution
layers. [WebAssembly](backends/wasm/README.md),
[LLVM](backends/llvm/README.md), and the [VS Code extension](k-vscode/README.md)
have their own usage instructions.

k is experimental: syntax, diagnostics, libraries, and artifact formats may
change. Release history is in [CHANGELOG.md](CHANGELOG.md).

## Release checks

GitHub CI runs the main, backend, and editor suites, then installs the packed
archive with production dependencies and checks its API and commands on Node.js
22 and 18. Run `npm run test:package -- /path/to/installed/@fraczak/k` to repeat
the package check. `npm publish` runs the main suite before publishing.
