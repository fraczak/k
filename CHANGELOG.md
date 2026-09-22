# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [6.5.0] — 2026-09-22 — Tail-loop arena compaction & OOM diagnostics

### WebAssembly Backend

- Added threshold-based arena compaction in self-tail-recursive loops to reclaim dead scratch space, allowing deep computations (e.g. multi-thousand-bit arithmetic) without exhausting linear memory.
- Added explicit Out-Of-Memory error reporting (`OutOfMemoryError`), tracking allocation failure and 32-bit offset overflow via exported runtime globals.

### Runtime & REPL

- Replaced recursive traversal in `codecs/runtime/show-value.mjs` and `Value.mjs` with iterative loops, eliminating `Maximum call stack size exceeded` errors when rendering deep variant chains.

### Examples

- Converted arithmetic helper functions in `Examples/arithmetics.k` to tail-recursive relations.

---

## [6.2.3] — 2026-06-03 — Unified k compiler output

### Toolchain

- Unified `k-compile` so it can emit `.ko`, `.klib`, and `.kvm` output.
- Removed the separate `k-compile-lib` binary; use `k-compile ... .klib`.
- Added inline source snippet input to `k-compile`, matching the `k` CLI style.

---

## [6.1.0] — 2026-05-20 — CLI aliases and help

### Toolchain

- Renamed the REPL entry point to `repl.mjs` and the installed binary to `k-repl`.
- Unified installed command names around the `k-` prefix and source basenames.
- Added `-h` / `--help` support across executable CLI scripts.
- Added public aliases in `Examples/ieee.k` for `add`, `sub`, `mul`, `div`, comparisons, and `neg`.

### Documentation

- Reworked the README around typed data transformations, contributor entry points, and the IEEE example.
- Updated CLI references across documentation to the current installed command names.

---

## [6.0.0] — 2026-05-12 — First public release

### Language & Runtime

- First-class partial functions over algebraic data types (products and tagged unions).
- Three combinators: composition `(f g)`, merge `<f, g>`, product `{f l1, g l2}`.
- Pattern-based type derivation with filter expressions (`?<...>`, `?{...}`).
- Canonical (hash-addressed) code names — two structurally equivalent codes always produce the same hash.
- Content-addressed object files (`.ko` / `.klib`) for compiled modules.

### Type System

- Finite tree automaton type representation (`codes.mjs`).
- Graph-based constraint propagation via `TypePatternGraph`.
- SCC-aware convergence with configurable strategy (`auto` / `single_pass` / `fixed_point`).
- `compileStats` API for inspecting convergence behavior per SCC.

### Toolchain

- `k` — CLI executor: reads binary pattern+value stream, applies a k script, writes result.
- `k-repl` — interactive interpreter with tab-completion.
- `k-compile` / `k-decompile` — object file compilation and decompilation.
- `k-compile-lib` / `k-extract-aliases` — library compilation and alias extraction.

### Codec Pipeline

- Binary format: serialized pattern graph followed by value encoded under that pattern.
- JSON codec, UTF-8/UTF-16 string codec, IEEE 754 codec.
- Polymorphic codec streams: pattern carried in-memory through projections and constructors.

### Node.js Library API

- `k.compile(source, options?)` — returns a runnable JS function.
- `k.annotate(source, options?)` — type-checks and returns annotated AST with `compileStats`.
- `k.run(expression, value)` — evaluate a single expression against a value.

---

[6.2.3]: https://github.com/fraczak/k/releases/tag/v6.2.3
[6.1.0]: https://github.com/fraczak/k/releases/tag/v6.1.0
[6.0.0]: https://github.com/fraczak/k/releases/tag/v6.0.0
