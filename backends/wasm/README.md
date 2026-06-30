# k WebAssembly Backend

`@fraczak/k-wasm` is the experimental WebAssembly backend for
[`@fraczak/k`](https://github.com/fraczak/k). It lowers typed k programs through
the kVM representation, emits standard `.wasm` modules with WABT, and provides
a Node.js runner for the binary `pattern + value` streams used by the k codec
toolchain.

## Install

Install dependencies from the monorepo root:

```bash
npm install
```

Optionally expose the three backend commands on your path:

```bash
npm link
```

## Quick Start

Compile an expression into a standalone WebAssembly artifact:

```bash
node ./bin/k-wasm-compile.mjs '|ok' /tmp/ok.wasm
```

Run it over the unit value and print the decoded result:

```bash
node ../../codecs/unit.mjs --parse |
  node ./bin/k-wasm-run.mjs /tmp/ok.wasm |
  node ../../codecs/k-print.mjs
```

Expected output:

```json
"ok"
```

With the backend and k codec commands on your path, the equivalent shorter
form is:

```bash
k-wasm-compile '|ok' /tmp/ok.wasm
k-unit --parse | k-wasm-run /tmp/ok.wasm | k-print
```

## Commands

| Command | Purpose |
| --- | --- |
| `k-wasm` | Compile k source, `.ko`, or `.kvm` input in memory and run it immediately |
| `k-wasm-compile` | Compile k source, `.ko`, or `.kvm` input into a `.wasm` artifact |
| `k-wasm-run` | Run an existing `.wasm` artifact over a binary input stream |

All commands accept `--help`. The compile commands follow the `k-compile`
input convention: pass inline source, an existing source path, a `.ko` object,
or a `.kvm` program. They also accept one `--lib` option for a `.klib`
dependency and repeated `--export` options to bring library aliases into the
source scope. Existing paths are treated as files; non-existing names with
`.k`, `.ko`, `.kvm`, `.klib`, or `.wasm` extensions are treated as missing
files; other arguments are treated as inline source. The runners read a binary
input stream from standard input unless an input file is given.

## Artifacts

The compiler produces a standard WebAssembly binary module containing the
reachable relations, the arena runtime, and a `k.metadata` custom section. The
metadata stores the entry point and the pattern information needed to encode
and decode values. A compiled artifact can be run later without its original k
source, object, kVM, or `.klib` files.

The current host runner targets Node.js. It is still needed to bridge between
WebAssembly linear memory and k binary streams.

## Development

Run the test suite:

```bash
npm test
```

Run the comparative IEEE benchmark:

```bash
npm run perf:ieee
```

See [DOCS/USE-WEB-ASSEMBLY.md](DOCS/USE-WEB-ASSEMBLY.md) for the artifact
format, source-file and library examples, profiling options, and current
limitations.
