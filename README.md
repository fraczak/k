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

## Execution backends

All backends implement the same k semantics over the binary
[wire format](codecs/WIRE_FORMAT.md) and are fully polymorphic (supporting
parameterized schemas and open patterns).

| Backend | Target(s) | Execution model | How to invoke |
| --- | --- | --- | --- |
| **JS reference** | JavaScript | Tree-walking interpreter over enveloped `Value` objects | `k` (`k.mjs`), `k.compile()`, REPL `:js` |
| **kVM interpreter** | JavaScript | Register bytecode over structural heap values | `k-vm` (`kvm.mjs`), `executeKVM()` |
| **kVM Wasm** | WebAssembly | Register VM compiled to `.wasm` with a bump arena | `k-wasm`, `k-wasm-compile`, `k-wasm-run`, REPL `:wasm` *(default)* |
| **kVM LLVM** | Native (Clang/LLVM) | Register VM lowered to LLVM IR + C runtime (`krt.c`) | `k-llvm`, `k-llvm-compile`, `k-llvm-build` |
| **kTVM ref VM** | JavaScript | Iterative packed-wire streaming transducer VM | `@fraczak/k/ktvm/index.mjs` (`executeObjectWithKTVM`) |
| **kTVM Wasm** | WebAssembly | Packed-wire transducer + verified bit-chunk tables in `.wasm` | REPL `:ktvm` (`--ktvm`), `compileObjectToKTVMWasm()` |
| **kTVM LLVM** | Native (Clang/LLVM) | Packed-wire transducer lowered to C99 + `clang -O3` | `compileObjectToKTVMExecutable()` / `executeKTVMExecutable()` |

### 1. JavaScript reference evaluator

The reference interpreter (`run.mjs`, `k.mjs`) evaluates relations directly
over in-memory `Value` trees with runtime envelope propagation (plus an
envelope-free `run_converged` path for converged relations). It supports all
language features, including non-converged relations.

```sh
node codecs/unit.mjs --parse | node k.mjs '{} |ok' | node codecs/k-print.mjs
node repl.mjs --js                 # or type :js inside the REPL
```

### 2. kVM backends (interpreter, WebAssembly, LLVM)

[kVM](DOCS/KVM_EXECUTION_MODEL.md) lowers portable [KIR-P](DOCS/KIR_V1.md) into
polymorphic register-bytecode templates (`KVM-P`), specializes them for
incoming envelopes (`KVM`), and evaluates pointer-linked algebraic trees on the
host/Wasm call stack.

- **kVM bytecode interpreter** (`kvm.mjs` / `k-vm`):
  ```sh
  node codecs/unit.mjs --parse | node kvm.mjs '{} |ok' | node codecs/k-print.mjs
  ```
- **kVM WebAssembly** ([backends/wasm/README.md](backends/wasm/README.md) —
  default engine in both the terminal and browser REPLs):
  ```sh
  # Compile and run in one step
  node codecs/unit.mjs --parse |
    node backends/wasm/bin/k-wasm.mjs '|ok' |
    node codecs/k-print.mjs

  # Compile ahead-of-time to .wasm and run
  node backends/wasm/bin/k-wasm-compile.mjs '?{} {} |ok' /tmp/k-ok.wasm
  node codecs/unit.mjs --parse |
    node backends/wasm/bin/k-wasm-run.mjs /tmp/k-ok.wasm |
    node codecs/k-print.mjs
  ```
- **kVM LLVM** ([backends/llvm/README.md](backends/llvm/README.md) — requires
  Clang):
  ```sh
  # Compile, cache, and run directly over a wire stream
  node codecs/unit.mjs --parse |
    node backends/llvm/bin/k-llvm.mjs '|ok' |
    node codecs/k-print.mjs

  # Build a standalone native executable (or emit .ll IR with k-llvm-compile.mjs)
  node backends/llvm/bin/k-llvm-build.mjs '?{} {} |ok' /tmp/k-ok.exe
  node codecs/unit.mjs --parse | /tmp/k-ok.exe | node codecs/k-print.mjs
  ```

### 3. kTVM backends (packed-wire transducer VM: JS, WebAssembly, LLVM)

[kTVM](DOCS/KTVM_SPEC.md) is an iterative, demand-driven streaming transducer
VM (`ktvm/`) that executes relations **directly over raw `k-wire` bitstreams**
without materializing heap value trees. At the wire boundary it specializes
polymorphic `kTVM-P` modules into closed `kTVM` modules, compiles inner
streaming loops into bisimulation-verified, L1-budgeted multi-bit lookup tables
(selected via Howard's MWTR criterion), and recycles channels and nodes through
slab freelists — avoiding call-stack overflows on deep bitstreams and using
dramatically less memory than heap-allocated execution.

- **In the terminal and browser REPLs (kTVM WebAssembly):**
  ```sh
  node repl.mjs --ktvm               # or type :ktvm inside the REPL
  ```
  In `repl.html`, click the engine badge (`wasm-in-process → ktvm-wasm → js-in-process`) or run `:engine ktvm`.
- **Via the JavaScript API** (`ktvm/index.mjs`, also re-exported from
  `backend-api.mjs`):
  ```js
  import { compileObjectBuffer, decodeObject } from "@fraczak/k/object.mjs";
  import { encodeToWire, decodeWire } from "@fraczak/k/codecs/runtime/prefix-codec.mjs";
  import { Value } from "@fraczak/k/Value.mjs";
  import {
    executeObjectWithKTVM,
    compileObjectToKTVMWasm,
    instantiateKTVMWasm,
    compileObjectToKTVMExecutable,
    executeKTVMExecutable
  } from "@fraczak/k/ktvm/index.mjs";

  const unitPattern = [["closed-product", []]];
  const obj = decodeObject(compileObjectBuffer("?{} {} |ok"));
  const inWire = encodeToWire(Value.product({}, unitPattern), unitPattern);

  // 1. kTVM iterative JS reference VM
  const ref = executeObjectWithKTVM(obj, "__main__", inWire);
  console.log(ref.value.tag); // "ok"

  // 2. kTVM WebAssembly (zero JS tree marshaling at the wire boundary)
  const wasmArtifact = await compileObjectToKTVMWasm(obj, "__main__", unitPattern);
  const wasmRunner = await instantiateKTVMWasm(wasmArtifact);
  console.log(wasmRunner.executeWire(inWire, { decodeValue: true }).value.tag); // "ok"

  // 3. kTVM Native C/LLVM executable (requires Clang; binary reads/writes k-wire on stdio)
  compileObjectToKTVMExecutable(obj, "__main__", unitPattern, "/tmp/k-ok-ktvm.exe");
  const native = executeKTVMExecutable("/tmp/k-ok-ktvm.exe", inWire);
  console.log(decodeWire(native.wire).value.tag); // "ok"
  ```

A standalone binary produced by `compileObjectToKTVMExecutable` also works
directly in shell pipelines:

```sh
node codecs/unit.mjs --parse | /tmp/k-ok-ktvm.exe | node codecs/k-print.mjs
```

### Comparing backends

Compare backends on conformance and speed with `npm run compare`
(`node harness/cli.mjs --help`). See the
[kVM vs. kTVM comparative study](DOCS/KVM_VS_KTVM_COMPARATIVE_STUDY.md) and
[profiling guide](DOCS/PROFILING_AND_TRACING.md) for trade-offs across deep
bitstreams, polymorphic lists, Karatsuba arithmetic, and RFC 8259 JSON parsing.

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
[LLVM](backends/llvm/README.md), [kTVM](DOCS/KTVM_SPEC.md), and the
[VS Code extension](k-vscode/README.md) have their own usage instructions.

k is experimental: syntax, diagnostics, libraries, and artifact formats may
change. Release history is in [CHANGELOG.md](CHANGELOG.md).

## Release checks

GitHub CI runs the main, backend, and editor suites, then installs the packed
archive with production dependencies and checks its API and commands on Node.js
22 and 18. Run `npm run test:package -- /path/to/installed/@fraczak/k` to repeat
the package check. `npm publish` runs the main suite before publishing.
