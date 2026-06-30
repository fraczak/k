# k-llvm

Experimental LLVM backend prototype for `k`.

This package lives under the `k` monorepo as `backends/llvm`. It consumes the
backend bridge from the root `@fraczak/k` package and starts from compiled
`.ko` objects:

```text
.k source -> .ko -> retyped KIR-P -> LLVM IR prototype
```

The first milestone is not performance. It is a stable backend pipeline that
can load an object, retype it through KIR-P, and produce an inspectable LLVM
module.

## Quick Start

From the monorepo root, install the workspace dependencies, then run the
backend from `backends/llvm`:

```sh
npm install
cd backends/llvm
node ../../objects/compile.mjs '()' /tmp/id.ko
node ./bin/k-llvm-compile.mjs --input-pattern '[["open-product",[]]]' /tmp/id.ko /tmp/id.ll
```

The generated `.ll` embeds the retyped KIR-P JSON as module data and exposes
the first runtime ABI slice:

```llvm
%k_result = type { i32, ptr }

define %k_result @k_main(ptr %rt, ptr %input)
```

`%rt` is an opaque runtime handle and `%input` is an opaque boxed `k_value*`.
The first executable lowerings support identity, typed filters and singleton
code filters, product field projection, product construction, variant
construction, and variant projection. Unsupported operations return a nonzero
status in `k_result`. These operations can compose through KIR `comp`.

## CLI

```sh
k-llvm-build [options] object.ko output-exe
k-llvm-compile [options] object.ko [output.ll]
k-llvm-jit [options] object.ko
k-llvm-run [options] object.ko [input.kv]
```

Options:

- `--retype rel`: relation to specialize; defaults to the object's `main`.
- `--input-pattern json-or-file`: KIR property-list input pattern; required
  for `k-llvm-build`.
- `--expect value-or-file`: for `k-llvm-run`, compare the output value against
  expected value text.
- `-h`, `--help`: show usage.

Only `.ko` / `.klib` object input is supported in this first prototype.
Source compilation remains owned by core `k`.
Without `--expect`, `k-llvm-run` prints the result value as compact JSON.
`k-llvm-build` emits a native executable that reads and writes the binary
k pattern+value envelope used by `codecs/k-parse.mjs` and `codecs/k-print.mjs`.
The executable checks the stdin envelope pattern against the compiled input
pattern and encodes stdout with the compiled output pattern.
`k-llvm-jit` reads the stdin binary envelope first, specializes the object with
that input pattern, caches the native executable, and writes the compiled
output envelope to stdout.
The native envelope codec supports the k Unicode string encoding used for
labels and tags.

## Tests

```sh
npm test
node ./scripts/conformance.mjs
npm run perf:int
npm run perf:ieee
```

The conformance runner reuses supported fixtures from `../../conformance`,
emits LLVM IR for each fixture, generates a small C driver for the fixture
input and expected value, links it with `runtime/krt.c`, and runs the binary.

The performance runners mirror the `k-wasm` integer and IEEE harnesses. They
load the real example programs from `@fraczak/k`, generate the same operation
matrices, compare backend output to native `k` results, and time the native JS,
kVM, and LLVM executable lanes. Set `LLVM_ONLY=1` to skip native timing,
`ITERATIONS=N` to change samples, and `LLVM_STRICT=1` to make unsupported LLVM
cases fail the process. The LLVM lane uses persistent executables by default;
set `LLVM_PIPELINE=1` to measure parallel request pipelining or
`LLVM_SPAWN_PER_CALL=1` to reproduce the older spawn-per-operation timing.

## Scope

Current output:

- KIR-P retyping through `@fraczak/k/backend-api.mjs`;
- textual LLVM IR with embedded retyped KIR-P JSON;
- boxed runtime ABI declarations;
- identity, filter/code erasure, product projection/construction, and variant
  construction/projection lowerings as `@k_main(k_rt*, k_value*) -> k_result`;
- KIR `comp` lowering for sequencing supported operations;
- KIR `empty` failure and ordered `union` branch selection;
- KIR `ref` lowering to internal `%k_result` relation functions;
- a tiny C runtime under `runtime/`.

Next backend steps:

- add an executable conformance mode once the runtime ABI exists.

## Runtime ABI

The C side owns all runtime allocation:

```c
typedef struct k_rt k_rt;
typedef struct k_value k_value;

typedef struct {
  int32_t status;
  k_value *value;
} k_result;

k_result k_main(k_rt *rt, k_value *input);
```

`runtime/krt.h` provides the initial boxed helpers for units, products,
variants, and pointer equality. The representation is intentionally opaque so
future KIR specialization can add unboxed fast paths without changing the
external ABI.
