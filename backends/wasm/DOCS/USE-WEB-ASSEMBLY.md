# Using WebAssembly

The experimental WebAssembly backend can compile a k program into a binary
`.wasm` artifact and run that artifact later without loading the original k
source. It uses the same binary `pattern + value` streams as the normal `k`
runtime, so the existing codecs remain the pipeline boundaries.

## Install the Commands

From the monorepo root:

```bash
npm install
cd backends/wasm
npm link
```

This installs three commands:

| Command | Purpose |
| --- | --- |
| `k-wasm` | Compile k source, `.ko`, or `.kvm` input in memory and run it immediately |
| `k-wasm-compile` | Compile k source, `.ko`, or `.kvm` input into a standalone `.wasm` artifact |
| `k-wasm-run` | Run a previously compiled `.wasm` artifact |

The same tools can be called directly from a checkout with
`node ./bin/k-wasm.mjs`, `node ./bin/k-wasm-compile.mjs`, and
`node ./bin/k-wasm-run.mjs`.

## Compile and Run a Source File

A source file must end with the expression that becomes its entry point:

```k
|ok
```

Compile it:

```bash
k-wasm-compile program.k program.wasm
```

Run it over a binary input stream:

```bash
k-unit --parse |
  k-wasm-run program.wasm |
  k-print
```

Expected output:

```json
"ok"
```

The `.wasm` artifact is a standard WebAssembly binary module:

```bash
file program.wasm
```

It can be stored or transferred as one file. The runner does not need
`program.k` after compilation.

## Compile an Expression

For a small program, pass a k expression directly:

```bash
k-wasm-compile '|ok' program.wasm
```

The `k-wasm` convenience command performs compilation and execution in one
process:

```bash
k-unit --parse |
  k-wasm '|ok' |
  k-print
```

For compile inputs, existing paths are read as files. Missing names with
`.k`, `.ko`, `.kvm`, `.klib`, or `.wasm` extensions are reported as missing
files; other arguments are interpreted as inline source snippets.

## Read Input from a File

Both runners accept an optional binary input file:

```bash
k-unit --parse > input.kv
k-wasm-run program.wasm input.kv > output.kv
k-print < output.kv
```

The one-step command has the same input-file form:

```bash
k-wasm program.k input.kv > output.kv
```

## Compile from k Objects or kVM

`k-wasm-compile` can consume the object and kVM outputs produced by
`k-compile`:

```bash
k-compile program.k program.ko
k-wasm-compile program.ko program.wasm

k-compile program.k program.kvm
k-wasm-compile program.kvm program.wasm
```

Use `.ko` when you want to preserve the compiled object form for the normal k
toolchain. Use `.kvm` when you want to inspect or cache the lowered kVM program
before producing WebAssembly.

## Compile with Libraries

`k-wasm-compile` and `k-wasm` accept one `--lib` option before the program.
Use repeated `--export` options to bring aliases from that library into the
source scope. The export spec is `name` or `libname:localname`.

For a library that defines `transform`:

```bash
k-compile library.k library.klib
k-wasm-compile --lib library.klib --export transform 'transform' program.wasm
k-parse |
  k-wasm-run program.wasm |
  k-print
```

The `.klib` file is required while compiling the artifact. It is not required
when running the resulting `.wasm` file.

## Profile IEEE Execution

The comparative IEEE benchmark moved with the backend:

```bash
npm run perf:ieee
```

To isolate WebAssembly execution and report arena allocation statistics:

```bash
WASM_ONLY=1 WASM_PROFILE=1 ITERATIONS=3 npm run perf:ieee
```

Set `WASM_RESET=0` to reproduce retained-arena growth and
`WASM_WARMUP_ITERATIONS=0` to include cold-start behavior.

## What the Artifact Contains

`k-wasm-compile` produces one WebAssembly binary module. The module contains:

- the bump-allocator runtime from [`runtime.wat`](../runtime.wat)
- one WebAssembly function for each reachable k relation
- the exported `rel___main__` entry point
- a WebAssembly custom section named `k.metadata`

The custom section stores JSON metadata needed by the host runner:

| Field | Meaning |
| --- | --- |
| `format` | Artifact family, currently `k-wasm` |
| `version` | Artifact format version, currently `1` |
| `abi` | Runtime ABI, currently `arena-v1` |
| `entry` | Exported WebAssembly function called by the runner |
| `inputPattern` | Pattern graph used to serialize the input into the arena |
| `outputPattern` | Pattern graph used to decode the output from the arena |
| `tags` | Stable integer IDs assigned to statically known variant tags |

Embedding metadata in a custom section keeps the artifact self-contained.
Unknown WebAssembly engines ignore custom sections, while `k-wasm-run` reads
the section with `WebAssembly.Module.customSections(...)`.

## Compilation Pipeline

Compilation follows these steps:

1. Resolve the input as inline source, a source file, a `.ko` object, or a
   `.kvm` program.
2. For source input, parse and annotate the source, including any loaded
   `.klib` dependencies and `--export` aliases.
3. For `.ko` input, use the hydrated relation definitions directly.
4. For `.kvm` input, use the already-lowered kVM functions directly.
5. Lower each reachable kVM function to WebAssembly text.
6. Combine the generated functions with `runtime.wat`.
7. Use WABT to validate the text and emit a binary WebAssembly module.
8. Append the `k.metadata` custom section to the binary module.

The implementation lives in [`src/wasm.mjs`](../src/wasm.mjs). The command-line
wrappers are [`k-wasm-compile.mjs`](../bin/k-wasm-compile.mjs),
[`k-wasm-run.mjs`](../bin/k-wasm-run.mjs), and
[`k-wasm.mjs`](../bin/k-wasm.mjs).

## Execution Pipeline

`k-wasm-run` performs these steps:

1. Load and compile the `.wasm` module with Node.js `WebAssembly.compile(...)`.
2. Read and validate the `k.metadata` custom section.
3. Decode the input `pattern + value` stream.
4. Serialize the input tree into the module's linear-memory arena.
5. Call the artifact entry point with the input arena pointer.
6. Decode the returned arena pointer under the stored output pattern.
7. Write the result as a binary `pattern + value` stream.

The WebAssembly entry-point ABI is:

```text
(param input_pointer i32) -> (result output_pointer i32, ok i32)
```

An `ok` result of `1` means that the partial function produced a value. A
result of `0` means that the k relation was undefined for that input.

## Current Limitations

- The artifact is a WebAssembly module, not a native executable. It still needs
  a host runner that understands k binary streams and the `k.metadata` section.
- `k-wasm-run` currently targets Node.js. A browser runner can use the same
  artifact format but has not been added yet.
- `.klib` files are compile-time dependencies, not standalone WebAssembly
  inputs. Load them with `--lib` and compile source, `.ko`, or `.kvm` input with
  a main relation.
- The backend is experimental. Use `k` as the general-purpose runtime while
  WebAssembly pattern coverage and optimization continue to evolve.
