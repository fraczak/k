# LLVM backend

The experimental LLVM backend lowers k programs to LLVM IR and links them with
the C runtime. It supports source/object execution, compiled native executables,
kVM input, and the experimental PKIR path.

Commands belong to the root package. Install dependencies from the repository
root and ensure Clang is available:

```sh
npm install
clang --version
```

`CLANG` or `CC` can select the compiler binary. `npm link` at the root exposes
`k-llvm`, `k-llvm-compile`, and `k-llvm-build`.

## Compile and run

Build a program with a closed unit input and a constant result:

```sh
node backends/llvm/bin/k-llvm-build.mjs '?{} {} |ok' /tmp/k-ok.exe
node codecs/unit.mjs --parse | /tmp/k-ok.exe | node codecs/k-print.mjs
```

This prints `"ok"`. To compile and run directly over an input envelope:

```sh
node codecs/unit.mjs --parse |
  node backends/llvm/bin/k-llvm.mjs '|ok' |
  node codecs/k-print.mjs
```

To inspect generated LLVM IR:

```sh
node backends/llvm/bin/k-llvm-compile.mjs '?{} {} |ok' /tmp/k-ok.ll
```

## Commands and options

| Command | Result |
| --- | --- |
| `k-llvm` | Compile, cache, and execute a native program for an input envelope |
| `k-llvm-compile` | Emit textual LLVM IR |
| `k-llvm-build` | Link a standalone executable that reads/writes k wire values |

Compile/build commands accept inline source or a source, `.ko`, `.kvm`, or
`.pkir` input. A `.klib` needs a selected relation, supplied through the
tool's `--retype` option or linked into source with a terminal expression.
Source is read from stdin when omitted. The execution command instead requires
a program argument and reads binary input from stdin or an optional filename.

Common compile options:

- `-o` / `--output path`: output path instead of a positional output.
- `--lib file`: one `.k` or `.klib` dependency.
- `--export name` or `--export libraryName:localName`: repeatable alias imports.
- `--pkir`: compile source through PKIR.
- `--retype relation`: select the relation for envelope specialization.
- `--opt flag`: Clang optimization flag.

Build/compile tools accept `--input-pattern` as JSON or a pattern file when
an explicit specialization input is needed. `k-llvm` derives the envelope
from its wire input; `--no-cache` disables reuse, and `--cache-dir` selects
the executable cache. Each command's `--help` lists its supported options
and defaults.

Existing program paths are read as files; recognized missing filenames are
errors. See [file formats](../../DOCS/FILE_FORMATS.md) for shared linking rules.

## Runtime contract

Compiled programs retain input/output patterns for wire boundaries. A native
runner checks incoming schemas against the compiled contract and serializes
the result with its output pattern. Partial failure is distinct from malformed
input, type errors, or compiler failures.

The boxed C ABI is:

```c
typedef struct k_rt k_rt;
typedef struct k_value k_value;
typedef struct {
  int32_t status;
  k_value *value;
} k_result;

k_result k_main(k_rt *rt, k_value *input);
```

[runtime/krt.h](runtime/krt.h) defines helpers and ownership through the runtime;
[runtime/krt.c](runtime/krt.c) implements values, arenas, and wire support.
[kvm2llvm.mjs](src/kvm2llvm.mjs) lowers kVM functions;
[llvm.mjs](src/llvm.mjs) coordinates object and PKIR paths.

Unsupported operations must produce diagnostics rather than silently change
semantics. Backend coverage and artifact formats remain experimental.

## Verification and profiling

From the repository root:

```sh
npm run test:llvm
```

This includes native execution, the open-product field-alignment regression,
shell integration, and shared conformance fixtures.

`npm run perf:int`, `npm run perf:ieee`, and `npm run perf:poly:trace`
compare execution lanes. See the [profiling guide](../../DOCS/PROFILING_AND_TRACING.md)
for measurement boundaries and target selection.
