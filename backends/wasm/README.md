# WebAssembly backend

The experimental Wasm backend compiles k relations to standard WebAssembly
modules using kVM and WABT. The terminal and browser REPLs also use its
in-process execution path.

Commands are provided by the root package. From the repository root:

```sh
npm install
```

Run the modules directly as below, or use `npm link` at the root to expose
`k-wasm`, `k-wasm-compile`, and `k-wasm-run`.

## Compile and run

```sh
node backends/wasm/bin/k-wasm-compile.mjs '?{} {} |ok' /tmp/k-ok.wasm
node codecs/unit.mjs --parse |
  node backends/wasm/bin/k-wasm-run.mjs /tmp/k-ok.wasm |
  node codecs/k-print.mjs
```

This prints `"ok"`. Compilation and execution in one step:

```sh
node codecs/unit.mjs --parse |
  node backends/wasm/bin/k-wasm.mjs '|ok' |
  node codecs/k-print.mjs
```

## Inputs and libraries

| Command | Purpose |
| --- | --- |
| `k-wasm` | Compile and execute a source expression/file, `.ko`, `.kvm`, or `.pkir` |
| `k-wasm-compile` | Produce a `.wasm` artifact from those program forms |
| `k-wasm-run` | Execute a previously compiled `.wasm` artifact |

The runners read binary schema+payload data from stdin or an optional input
filename. Compile tools read source from stdin when the program is omitted.
Source files need a terminal expression; a `.klib` alone is not an executable
input.

Compile commands accept one `--lib file` and repeated `--export alias` or
`--export libraryAlias:localAlias` options before the program. Libraries can
be `.k` source or `.klib` objects. `--pkir` chooses the experimental PKIR
lowering path; `-o` / `--output` selects an output path.

Existing paths are read as files. Recognized missing filenames are errors;
other program arguments are treated as inline source.

For a library example using only a small definition:

```sh
node objects/compile.mjs 'greet = {} |hello;' /tmp/k-demo.klib
node backends/wasm/bin/k-wasm-compile.mjs --lib /tmp/k-demo.klib   --export greet '?{} greet' /tmp/k-greet.wasm
node codecs/unit.mjs --parse |
  node backends/wasm/bin/k-wasm-run.mjs /tmp/k-greet.wasm |
  node codecs/k-print.mjs
```

The result is `"hello"`. The library is required at compilation time; the
module can subsequently run without the original source/library files.

## Artifact and execution contract

A module contains the reachable functions, the arena runtime from
[runtime.wat](runtime.wat), and one `k.metadata` custom section.

| Metadata field | Meaning |
| --- | --- |
| `format` / `version` | `"k-wasm"` / `1` |
| `abi` | `"arena-v1"` |
| `entry` | Exported function called by the runner |
| `inputPattern` / `outputPattern` | Patterns used by the arena adapters |
| `tags` | Statically known variant tags and their IDs |

The entry ABI is `(input_pointer i32) -> (output_pointer i32, ok i32)`.
`ok = 1` means a defined result; `ok = 0` means ordinary partial failure.

The host decodes a wire value, writes it into linear memory, invokes the
entry, reads the result under its output pattern, and writes a wire value.
`instantiateWasmArtifact` also exposes `executeValue` for in-memory `Value`
input/output and optional phase tracing.

`k-wasm` can use the arriving input envelope while compiling. A precompiled
module runs with its stored metadata; `k-wasm-run` does not rerun derivation
on the original relation graph. Use one-step compilation when an input-specific
contract is needed.

## Limits and implementation

A `.wasm` file still needs a host that understands the arena ABI and metadata.
The CLI host is Node.js; the browser REPL bundles its own in-process adapter.

Allocation uses a bump arena. Runners reset it between completed runs; selected
tail-loop paths also compact live state. Temporary allocation within successful
non-tail calls can still increase peak memory. The host translates exported
out-of-memory flags into diagnostics.

The implementation lives in [src/wasm.mjs](src/wasm.mjs) and
[src/kvm2wasm.mjs](src/kvm2wasm.mjs). See
[compiler architecture](../../DOCS/ARCHITECTURE.md) and
[kVM](../../DOCS/KVM_EXECUTION_MODEL.md) for shared layers.

## Verification and profiling

From the repository root:

```sh
npm run test:wasm
npm run build:repl-html
```

For performance measurements, use `npm run perf:ieee` or
`npm run perf:poly:trace`. The [profiling guide](../../DOCS/PROFILING_AND_TRACING.md)
explains execution lanes and boundary costs.
