# k

**k is a small language for content-addressable schemas and data transformations.**

It describes data as algebraic schemas, programs as first-order partial
relations, and runtime values as a self-describing binary `schema + payload`
stream that can be parsed, transformed, printed, compiled, and inspected.

Schema definitions and transformations share one syntax, so a k file can
define both data schemas and the relations that transform between them.

k is experimental, but it already has a working parser, contract-derivation
engine, REPL, binary codec pipeline, object/library format, Node.js API,
and test suite.

## Why k?

Many systems need to answer the same questions:

- What schema does this data have?
- Which transformations are valid for that schema?
- What does a program accept, produce, or preserve?
- Can this transformation be serialized, tested, reused, or verified?

k explores a compact answer: define algebraic schemas, compose
partial relations over them, derive input/output contracts
automatically, and move values across process boundaries with a canonical,
content-addressable binary representation.

That makes k interesting as a foundation for:

- content-addressable schema registries and schema-to-schema pipelines
- binary codecs and canonical serialization
- protocol, hardware, or test-vector transformation pipelines
- teaching algebraic data types and compositional relational programming
- research into partial relations, finite tree automata, and typed IRs

## A Small Example

k can define recursive data and transformations in the same file. Peano
natural numbers are either `0` or one more than another natural number:

```k
0 = {} | 0;
inc = | +1;
dec = / +1;       # undefined for '0'
add = ?{ < {} 0, N +1 > = N x, ... } <
  { . x dec x, . y inc y } add,    # defined if 'x > 0'
  . y                              # else, return 'y'
>;
```

`add` takes a product `{ x, y }`. If `x` has a `+1`, it moves that
successor from `x` to `y` and recurses. When that no longer applies, it
returns `y`. The inductive filter `?{ < {} 0, N +1 > = N x, ... }`
explicitly witnesses that recursive calls shrink `x`.

In the REPL:

```text
> { 0 inc inc x, 0 inc y } add
{}|0|+1|+1|+1 ?<X0 +1, {} 0>=X0
```

That evaluates `2 + 1` to `3`: a value starts at `0`, and each `+1` tag
adds one successor. The REPL also prints the inferred value envelope.

## Try It

### In the Browser (Zero Install)

Try k directly in your browser without installing anything:
**[https://fraczak.github.io/k/](https://fraczak.github.io/k/)**

The Web REPL is self-contained, powered by an in-process WebAssembly
compiler and execution engine with built-in codecs, autocompletion,
interactive input, and standard libraries.

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

All data structures in k are built from products and tagged unions (variants).
Relations and pattern filters describe their domains:

```k
bit  = ?< {} 0, {} 1 >;
byte = ?{ Bit 0, Bit 1, Bit 2, Bit 3, Bit 4, Bit 5, Bit 6, Bit 7 };
bits = ?< {} _, bits 0, bits 1 > = bits;
```

There are no built-in primitive values. The empty product `{}` is the
only leaf in a non-recursive definition.

**Composable partial functions**

Core expressions are deliberately small:

| Syntax | Meaning |
| --- | --- |
| `.field` | project a product field |
| `/tag` | project a tagged-union branch |
| `\|tag` | introduce a variant (tagged union) |
| `(f g)` | compose transformations |
| `<f, g>` | try `f`, then `g` if `f` is undefined |
| `{f a, g b}` | build a product from parallel transformations |
| `?filter` | schema filter / inductive termination witness |
| `()` | identity |
| `<>` | always undefined |
| `{}` | constant empty product |

**Derived relational contracts**

k derives structural contracts for relations. A contract is a connected
$(input, output)$ schema graph that specifies accepted input schemas,
guaranteed output schemas, and preserved data structures ($=X$). Those
contracts guide diagnostics, REPL output, binary serialization, and
optimizations.

**Self-describing binary streams**

The command-line pipeline uses a self-describing binary stream:

```text
encoded schema, followed by payload encoded under that schema
```

The boundary tools are:

```bash
k-parse   # textual k value -> binary schema+payload stream
k         # apply a k expression or .k/.ko program to the stream
k-print   # binary schema+payload stream -> textual value
k-show    # inspect decoded schema and payload value
```

**Inspectable objects and libraries**

`k` programs can be authored, compiled, and linked across four main
file formats:

- `.k`: human-readable source code defining algebraic schemas and relations.
- `.klib`: ahead-of-time (AOT) library objects (`main: null`) storing
  canonical relation definitions, schemas, and local aliases.
- `.ko`: ahead-of-time (AOT) executable containers (`KOBJ\n` magic header)
  with entrypoint `main: "__main__"`, skipping parsing and contract
  derivation at runtime.
- `.kvm`: polymorphic register-IR template artifacts (`layer: "KVM-P"`)
  carrying principal schema contracts for instant runtime specialization
  (`specializeKVM`).

In `k`, all relations and derived schemas are identified canonically by immutable
content-addressed hashes (`@hash`). There is no global symbol namespace;
friendly names (such as `plus`, `int`, or `5`) are local aliases stored
in metadata. Similarly, there are no primitive numbers: numerical
identifiers like `5` or `10` are nullary relations mapping `{}` to `bits`.

For a detailed guide to all four formats, commands, and workflows, see
[DOCS/FILE_FORMATS.md](DOCS/FILE_FORMATS.md).

## CLI Tour

**Running k**

| Command | Purpose |
| --- | --- |
| `k` | Execute a k expression, or an existing source/object file, over a binary stream |
| `k-repl` | Start the interactive interpreter |

**Serialization boundaries**

| Command | Purpose |
| --- | --- |
| `k-parse` | Convert textual k values to binary schema+payload streams |
| `k-print` | Convert binary schema+payload streams back to textual values |
| `k-show` | Pass a stream through while showing the decoded payload and schema |

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

Installed binary names are `k-` plus the source basename without
`.mjs`, except for `k.mjs` itself. Source names that already include
`k-`, such as `codecs/k-parse.mjs`, keep that name.

## Backends

Backends live under [`backends/`](backends/) as npm workspaces:

- [`backends/wasm`](backends/wasm/) lowers typed k programs through kVM
  into WebAssembly artifacts. Powers both the CLI REPL (`wasm-in-process`)
  and the standalone Web REPL.
- [`backends/llvm`](backends/llvm/) lowers polymorphic kVM programs into
  LLVM IR and compiled native test executables.
- [`backends/arm64`](backends/arm64/) lowers polymorphic kVM programs
  directly into standalone Linux ARM64 native executables without external
  compiler dependencies.

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

k is usable as an experimental language and toolkit, not a stable
production platform yet.

Working today:

- parser and runtime for the core language
- type derivation over recursive algebraic data shapes
- REPL with aliases, loading, completion, `.klib` export, and `.ko` export
- binary pattern+value codec
- object and library files
- Node.js API
- regression tests for runtime, codecs, objects, hashes, and type
  derivation

Still evolving:

- surface syntax and diagnostics
- standard libraries
- documentation and tutorials
- object metadata format
- optimization and backend experiments
- larger real-world examples

## Good Areas for Contributors

k is small enough to study, but there are several useful directions:

- examples: schema transformations, codecs, protocol examples, teaching
  tasks
- documentation: tutorials, diagrams, and clearer language walkthroughs
- tooling: formatter, editor integration, better diagnostics, REPL
  ergonomics
- compiler work: optimization, object inspection, backend experiments
- theory: normalization, equivalence, convergence, and pattern derivation
- applications: hardware modeling, asynchronous/synchronous pipelines,
  schema repositories, and data migration tooling

If you are interested in languages, compilers, data modeling, formal
methods, serialization, or teaching tools, there is room to shape the
project.

## Examples

The [`Examples/`](Examples/) directory contains language demonstrations
and standard libraries:

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

`list.k` is also useful as a focused demonstration of filters and
patterns.

`ieee.k` is a complete IEEE-754 binary64 model built from bit-level
types upward with hierarchical significand adders, including comparison
and floating-point `add`, `sub`, `mul`, and `div` relations. Those public
aliases return `{ result, flags }`; compose with `.result` when only the
floating-point value is needed.

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

The test runner prints each test before execution and reports its
elapsed time afterward. It stops immediately when a test fails.
The suite covers:

- core runtime and parser behavior
- type derivation cases in `tests/code-derivation/`
- hash/fingerprint stability
- object file round-trips
- REPL scripted interaction
- Web REPL headless browser verification
- polymorphic kVM and specialization
- shell integration tests

## Further Reading

- [DOCS/FILE_FORMATS.md](DOCS/FILE_FORMATS.md) - guide to
  .k, .ko, .klib, and .kvm file formats and workflows
- [DOCS/DICTIONARY.md](DOCS/DICTIONARY.md) - concept names and terminology
- [DOCS/REPL.md](DOCS/REPL.md) - interactive interpreter and codec details
- [DOCS/WEB_REPL_REQUIREMENTS.md](DOCS/WEB_REPL_REQUIREMENTS.md) -
  Web REPL architecture and requirements
- [DOCS/KVM_EXECUTION_MODEL.md](DOCS/KVM_EXECUTION_MODEL.md) -
  kVM execution model and bytecode design
- [DOCS/TEXTUAL_VALUES.md](DOCS/TEXTUAL_VALUES.md) -
  textual boundary notation
- [DOCS/PATTERNS.md](DOCS/PATTERNS.md) - pattern representation
- [DOCS/OBJECT_FILE_AND_PATTERN.md](DOCS/OBJECT_FILE_AND_PATTERN.md) -
  object format and pattern encoding
- [DOCS/PROFILING_AND_TRACING.md](DOCS/PROFILING_AND_TRACING.md) -
  execution phase tracing and function call profiling across backends
- [DOCS/CODECS.md](DOCS/CODECS.md) - writing external codecs
- [codecs/README.md](codecs/README.md) - binary codec internals
- [objects/README.md](objects/README.md) - object/library tools
- [DOCS/book.md](DOCS/book.md) - longer language reference
