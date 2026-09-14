# k Linux ARM64 Backend

`@fraczak/k-arm64` is the native Linux AArch64 (ARM64) backend for
[`@fraczak/k`](https://github.com/fraczak/k). It lowers typed k programs directly from
the kVM representation into GNU AArch64 assembly text (`.s`), compiles native ELF
executables, and provides CLI tools and runners for binary `pattern + value` streams
and `--json` input/output.

## Features

- **Direct kVM to ARM64 Lowering**: Generates pure GNU AArch64 assembly text without requiring LLVM or external code generators.
- **Calling Convention & Registers (AAPCS64)**:
  - `x0`: Input value pointer on entry; Return status (`0` for success, non-zero for failure) on exit.
  - `x1`: Output value pointer on exit.
  - `x19`: Callee-saved Arena bump pointer preserved and updated across relation calls.
  - Standard 16-byte stack frame alignment with FP (`x29`) and LR (`x30`) chaining.
- **Flat Arena Memory Representation**:
  - Word 0 (bytes 0–1): Total block size in bytes (16-byte aligned).
  - Word 1 (bytes 2–3): Value kind (`1` = Product, `2` = Variant).
  - Word 2 (bytes 4–7): Product field count OR Variant 32-bit tag ID.
  - Payloads (bytes 8+): 64-bit pointers to child values in the arena.
- **Self Tail-Call Optimization (TCO)**:
  - Recursion where the tail call passes new product fields directly updates cached field slots and jumps back to `.Ltail_loop` with zero frame overhead, enabling deep recursion without stack overflow.
- **Union Backtracking & Memory Rollback**:
  - Union branches save the arena bump pointer (`x19`) before evaluation. If a branch fails, `x19` is rewound to cleanly roll back all allocations made in the failed speculative branch before attempting subsequent branches.
- **Standalone Linux Binaries**:
  - Links with a lightweight C driver (`backends/arm64/src/runtime.c`) and `backends/llvm/runtime/krt.c` to produce independent native ELF executables that execute directly on Linux without Node.js.
  - Supports `--json` for direct text output, stdin/stdout piping, and binary envelope streams.

## Quick Start

Compile an expression to a standalone native Linux ARM64 executable:

```bash
node ./backends/arm64/bin/k-arm64-compile.mjs -o /tmp/ok '|ok'
```

Execute it over unit input and decode output:

```bash
node ./codecs/unit.mjs --parse | /tmp/ok --json
```

Output:
```json
"ok"
```

Compile with library dependencies (`--lib` and `--export`):

```bash
node ./backends/arm64/bin/k-arm64-compile.mjs \
  --lib Examples/arithmetics.k \
  --export plus:+ --export succ --export int \
  '{succ int x,int y}+' \
  -o /tmp/add-one

node ./codecs/k-parse.mjs <<< '{"x":{"succ":"zero"},"y":{"succ":{"succ":"zero"}}}' |
  /tmp/add-one --json
```

Output:
```json
{"+":{"1":"_"}}
```

## CLI Commands

| Command | Purpose |
| --- | --- |
| `k-arm64` | Compile k source, `.ko`, or `.kvm` in memory and run immediately |
| `k-arm64-compile` | Compile k source, `.ko`, or `.kvm` to standalone ELF executable or assembly (`-S`) |
| `k-arm64-run` | Run a compiled ELF executable over binary wire streams |

### Options

All tools accept `--help`.

- `-S, --assembly`: Emit GNU ARM64 assembly text (`.s`) instead of an ELF binary.
- `-o, --output <file>`: Specify the output file path.
- `--entry <name>`: Specify the entry relation (defaults to `__main__`).
- `--lib <file>`: Load one `.klib` or `.k` library dependency.
- `--export <spec>`: Export library symbols into source scope (`name` or `libname:localname`).
- `--json`: Format output as JSON instead of binary wire format.

## Running Tests

Run unit tests:

```bash
node ./backends/arm64/tests/test-arm64.mjs
```

Run integration tests:

```bash
./backends/arm64/tests/integration.sh
```

Run the complete ARM64 backend test suite:

```bash
npm run test:arm64
```
