# k

**k is a small language for typed data transformations.**

It describes data as algebraic shapes, programs as first-order partial
functions, and runtime values as a binary `pattern + value` stream that can be
parsed, transformed, printed, compiled, and inspected.

Data descriptions and transformations share one syntax, so a k file can define
both the shapes of values and the relations that move between them.

k is experimental, but it already has a working parser, type-derivation engine,
REPL, binary codec pipeline, object/library format, Node.js API, and test suite.

## Why k?

Many systems need to answer the same questions:

- What shape does this data have?
- Which transformations are valid for that shape?
- What does a program accept, produce, or reject?
- Can this transformation be serialized, tested, reused, or inspected?

k explores a compact answer: define algebraic data shapes, compose partial
transformations over them, derive input/output patterns automatically, and move
values across process boundaries with a canonical binary representation.

That makes k interesting as a foundation for:

- schema definitions and schema-to-schema transformations
- binary codecs and canonical serialization
- protocol, hardware, or test-vector transformation pipelines
- teaching algebraic data types and compositional programming
- research into partial functions, finite tree automata, and typed IRs

## A Small Example

k can define recursive data and transformations in the same file. Peano natural
numbers are either `0` or one more than another natural number:

```k
$ nat = < {} 0, nat +1 >;
0 = {} | 0 $ nat ;
inc = | +1 $ nat ;
dec = $ nat / +1 ;       # undefined for '0'
add = $ { nat x, nat y } <
  { . x dec x, . y inc y } add,    # defined if 'x > 0'
  . y                              # else, return 'y'
>;
```

`add` takes a product `{ x, y }`. If `x` has a `+1`, it moves that successor
from `x` to `y` and recurses. When that no longer applies, it returns `y`.

In the REPL:

```text
> { 0 inc inc x, 0 inc y } add
{}|0|+1|+1|+1 ?<X0 +1, {} 0>=X0
```

That evaluates `2 + 1` to `3`: a value starts at `0`, and each `+1` tag adds
one successor. The REPL also prints the inferred value envelope.

## Try It

### In the Browser (Zero Install)

Try k directly in your browser without installing anything:
**[https://fraczak.github.io/k/](https://fraczak.github.io/k/)**

The Web REPL is self-contained, powered by an in-process WebAssembly compiler and execution engine with built-in codecs, autocompletion, interactive input, and standard libraries.

### From Source

From a checkout:

```bash
node --version        # requires Node.js 18+
npm install
npm test
npm link
```

Then run a tiny binary pipeline:

```bash
k-unit --parse | k '{} |ok' | k-print
```

Expected output:

```json
"ok"
```

Start the interactive interpreter:

```bash
k-repl
```

Build the standalone single-file Web REPL locally:

```bash
npm run build:repl-html
# generates repl.html (open in any web browser)
```

Every installed command supports `-h` and `--help`.

## What k Gives You

**Algebraic data shapes**

Types, called *codes*, are built from products and tagged unions:

```k
$ bit  = < {} 0, {} 1 >;
$ byte = { bit 0, bit 1, bit 2, bit 3, bit 4, bit 5, bit 6, bit 7 };
$ bits = < {} _, bits 0, bits 1 >;
```

There are no built-in primitive values. The empty product `{}` is the only leaf
in a non-recursive definition.

**Composable partial functions**

Core expressions are deliberately small:

| Syntax | Meaning |
| --- | --- |
| `.field` | project a product field |
| `/tag` | project a tagged-union branch |
| `\|tag` | introduce a tagged-union branch |
| `(f g)` | compose transformations |
| `<f, g>` | try `f`, then `g` if `f` is undefined |
| `{f a, g b}` | build a product from parallel transformations |
| `()` | identity |
| `<>` | always undefined |
| `{}` | constant empty product |

**Derived input/output patterns**

k derives structural constraints for expressions. Those patterns become useful
for diagnostics, REPL output, binary encoding, and object metadata.

**Binary-friendly runtime values**

The command-line pipeline uses a self-describing binary stream:

```text
encoded pattern, followed by value encoded under that pattern
```

The boundary tools are:

```bash
k-parse   # textual k value -> binary pattern+value stream
k         # apply a k expression or .k/.ko program to the stream
k-print   # binary pattern+value stream -> textual value
```

**Inspectable objects and libraries**

k programs can be compiled into:

- `.klib`: library objects
- `.ko`: executable binary object containers
- `.kvm`: specialized kVM backend artifacts

Object and library files keep canonical code/relation definitions, aliases,
metadata, and type-derivation status. The `.kvm` output is a lowered backend
artifact for inspection and execution experiments.

## CLI Tour

**Running k**

| Command | Purpose |
| --- | --- |
| `k` | Execute a k expression, or an existing source/object file, over a binary stream |
| `k-repl` | Start the interactive interpreter |

**Serialization boundaries**

| Command | Purpose |
| --- | --- |
| `k-parse` | Convert textual k values to binary pattern+value streams |
| `k-print` | Convert binary pattern+value streams back to textual values |
| `k-show` | Pass a stream through while showing the decoded value/filter |

**Built-in codecs**

| Command | Purpose |
| --- | --- |
| `k-json` | Convert JSON to/from the binary stream |
| `k-int` | Convert decimal integers to/from the binary stream |
| `k-ieee` | Convert float literals to/from the binary stream |
| `k-unit` | Produce or validate the unit value |
| `k-utf8` / `k-utf16` | Convert text to/from k string streams |

**Object and library tooling**

| Command | Purpose |
| --- | --- |
| `k-compile` | Compile `.k` source to `.ko`, `.klib`, or `.kvm` output |
| `k-decompile` | Decompile `.ko` or `.klib` back to k source |
| `k-extract-aliases` | Recover metadata aliases as k source |
| `k-inspect-object` | Inspect object sections or print the KIR-P backend export |
| `k-validate-object` | Validate `.ko`, `.klib`, or exported KIR-P artifacts |
| `k-kir` | Export KIR-P from `.ko` or `.klib` |
| `k-vm` | Execute or inspect lowered kVM bytecode artifacts (`.kvm`) |
| `k-wasm` / `k-wasm-compile` / `k-wasm-run` | Compile and run via WebAssembly backend |
| `k-llvm-build` / `k-llvm-compile` / `k-llvm-run` | Compile and run via LLVM backend |
| `k-arm64` / `k-arm64-compile` / `k-arm64-run` | Compile and run via Linux ARM64 native backend |

Installed binary names are `k-` plus the source basename without `.mjs`, except
for `k.mjs` itself. Source names that already include `k-`, such as
`codecs/k-parse.mjs`, keep that name.

## Backends

Backends live under [`backends/`](backends/) as npm workspaces:

- [`backends/wasm`](backends/wasm/) lowers typed k programs through kVM into
  WebAssembly artifacts. Powers both the CLI REPL (`wasm-in-process`) and the standalone Web REPL.
- [`backends/llvm`](backends/llvm/) lowers polymorphic kVM programs into LLVM IR and
  compiled native test executables.
- [`backends/arm64`](backends/arm64/) lowers polymorphic kVM programs directly into
  standalone Linux ARM64 native executables without external compiler dependencies.

All backends integrate with the compiler and binary codecs through
[`backend-api.mjs`](backend-api.mjs).

## Node.js API

```js
import k from "@fraczak/k";

const fn = k.compile("{} |ok");

console.log(fn({})); // "ok"
```

For deeper inspection:

```js
const annotated = k.annotate(source, {
  convergence: { strategy: "auto" }
});

console.log(annotated.compileStats);
```

## Project Status

k is usable as an experimental language and toolkit, not a stable production
platform yet.

Working today:

- parser and runtime for the core language
- type derivation over recursive algebraic data shapes
- REPL with aliases, loading, completion, `.klib` export, and `.ko` export
- binary pattern+value codec
- object and library files
- Node.js API
- regression tests for runtime, codecs, objects, hashes, and type derivation

Still evolving:

- surface syntax and diagnostics
- standard libraries
- documentation and tutorials
- object metadata format
- optimization and backend experiments
- larger real-world examples

## Good Areas for Contributors

k is small enough to study, but there are several useful directions:

- examples: schema transformations, codecs, protocol examples, teaching tasks
- documentation: tutorials, diagrams, and clearer language walkthroughs
- tooling: formatter, editor integration, better diagnostics, REPL ergonomics
- compiler work: optimization, object inspection, backend experiments
- theory: normalization, equivalence, convergence, and pattern derivation
- applications: hardware modeling, asynchronous/synchronous test pipelines,
  schema repositories, and data migration tooling

If you are interested in languages, compilers, data modeling, formal methods,
serialization, or teaching tools, there is room to shape the project.

## Examples

The [`Examples/`](Examples/) directory contains language demonstrations and standard libraries:

| File | Contents |
| --- | --- |
| `core.k` | Standard library: booleans, units, strings, optionals, and fundamental helpers |
| `arithmetics.k` | Integer and rational arithmetic built from bit-level relations from scratch |
| `ieee.k` | IEEE 754 binary64 floating-point arithmetic (`add`, `sub`, `mul`, `div`) |
| `poly.k` | Polymorphic list operations (`concat`, `reverse`, `length`, `get_nth`, `split_by`, `zip`) |
| `nat.k` | Peano natural numbers |
| `byte.k` | Byte type |
| `bnat.k` | Binary natural numbers |
| `buda.k` | Compact relational data transformations |

`list.k` is also useful as a focused demonstration of filters and patterns.

`ieee.k` is a complete IEEE-754 binary64 model built from bit-level types
upward with hierarchical significand adders, including comparison and
floating-point `add`, `sub`, `mul`, and `div` relations. Those public aliases
return `{ result, flags }`; compose with `.result` when only the floating-point
value is needed.

## Development

```bash
npm run prepare         # regenerate parsers from .jison grammars
npm test                # run the fail-fast full suite with per-test timings
npm run test:wasm       # run the WebAssembly backend tests
npm run test:llvm       # run the LLVM backend tests
npm run test:arm64      # run the Linux ARM64 backend tests
npm run build:repl-html # build the standalone single-file Web REPL (repl.html)
npm run compare         # run multi-backend benchmark and conformance harness
npm run perf:poly       # run polymorphic benchmark across backends
npm run perf:poly:trace # run execution phase tracing & call profiling
npm run perf:int        # run integer arithmetic benchmark across backends
npm run perf:ieee       # run IEEE-754 arithmetic benchmark across backends
```

The test runner prints each test before execution and reports its elapsed time
afterward. It stops immediately when a test fails. The suite covers:

- core runtime and parser behavior
- type derivation cases in `tests/code-derivation/`
- hash/fingerprint stability
- object file round-trips
- REPL scripted interaction
- Web REPL headless browser verification
- polymorphic kVM and specialization
- shell integration tests

## Further Reading

- [DOCS/DICTIONARY.md](DOCS/DICTIONARY.md) - concept names and terminology
- [DOCS/REPL.md](DOCS/REPL.md) - interactive interpreter and codec details
- [DOCS/WEB_REPL_REQUIREMENTS.md](DOCS/WEB_REPL_REQUIREMENTS.md) - Web REPL architecture and requirements
- [DOCS/KVM_EXECUTION_MODEL.md](DOCS/KVM_EXECUTION_MODEL.md) - kVM execution model and bytecode design
- [DOCS/TEXTUAL_VALUES.md](DOCS/TEXTUAL_VALUES.md) - textual boundary notation
- [DOCS/PATTERNS.md](DOCS/PATTERNS.md) - pattern representation
- [DOCS/OBJECT_FILE_AND_PATTERN.md](DOCS/OBJECT_FILE_AND_PATTERN.md) - object format
- [DOCS/PROFILING_AND_TRACING.md](DOCS/PROFILING_AND_TRACING.md) - execution phase tracing and function call profiling across backends
- [DOCS/CODECS.md](DOCS/CODECS.md) - writing external codecs
- [codecs/README.md](codecs/README.md) - binary codec internals
- [objects/README.md](objects/README.md) - object/library tools
- [DOCS/book.md](DOCS/book.md) - longer language reference
