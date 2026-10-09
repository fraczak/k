# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.10.6] — 2026-10-08 — Minimal Core Schema and REPL VFS Uploads

### Core Schema & Language

- **Minimal `core.k` Schema**:
  - Streamlined `core.k` to focus strictly on structural type schemas
    and pattern foundations.
  - Removed legacy bit arithmetic (`succ`, `plus`, `times`, constants
    `2`..`10`, and helpers `inv`, `concat`), achieving a 39% reduction
    in file size.
  - Retained `$bit`, `$bits`, `_`, `0`, `1`, `$string`, `$unicode`, and
    `$pattern` definitions intact for type derivation and codecs.

### Web REPL & VFS

- **VFS Namespace Flattening**:
  - Flattened VFS back to root filenames (`int.mjs`, `json.mjs`,
    `utf8.mjs`, `unit.mjs`, `ieee.mjs`), ensuring consistent resolution
    across browser and CLI environments.
- **Upload File Directly to VFS**:
  - Updated "Upload" action to strictly add uploaded files into the VFS
    without auto-loading or evaluating them as K code.
  - Enables uploading JavaScript codecs, JSON payloads, and test vectors.
  - Expanded file picker `accept` filter to allow `.mjs`, `.js`, and
    `.json` files.
  - Supported `:codec load` for `.js` codecs in the VFS explorer modal.

---

## [6.10.5] — 2026-10-08 — Adaptive Division and VFS Codecs

### Arithmetic & Algorithms

- **Adaptive Hybrid Division (`Examples/arithmetics.k`)**:
  - Implemented hybrid integer division that dynamically chooses between
    down-shift division ($|x| < 2|y|$) and restoring long division
    ($|x| \ge 2|y|$).
  - Down-shift division scales divisor $y$ up to match length of $x$,
    performing trial subtraction and down-shifting in $O(1)$ per step.
  - Crossover condition is evaluated structurally in $O(\min(|y|, |x|/2))$
    without prior length computations.
  - Added native number-theory operations: `mod`, Euclidean `gcd`, and
    `lcm`.
  - Refactored `arithmetics.k` to focus purely on arithmetic operations.

### Polymorphic Lists

- **Polymorphic List Library (`Examples/poly.k`)**:
  - Encapsulated list constructors and destructors (`list?`, `nil`,
    `cons`, `car`, `cdr`, `singleton`, `nil?`) directly in `poly.k`.
  - Updated benchmark suites (`harness/suites/poly.mjs`,
    `scripts/perf-poly.mjs`) to import only arithmetic symbols from
    `arithmetics.k`.

### Web REPL & Codecs

- **VFS Codec Subfolder Organization**:
  - Reorganized all codec files in the Virtual File System under the
    `codecs/` subfolder (`codecs/int.mjs`, `codecs/json.mjs`, etc.).
  - Added backward-compatible resolution in `repl-codecs.mjs`.
  - Added `karatsuba-mult.k` to the VFS and example picker in `repl.html`.

---

## [6.10.4] — 2026-10-06 — Karatsuba Multiplication, Multi-Backend Harness, and CLI Help

### Arithmetic & Algorithms

- **Karatsuba Multiplication (`Examples/karatsuba-mult.k`)**:
  - Implemented standalone, minimal Karatsuba integer multiplication with
    asymptotic time complexity $O(n^{\log_2 3}) \approx O(n^{1.585})$.
  - Utilizes unary counter (`$unat`) splitting with a 512-bit threshold
    switching to grade-school multiplication (`times_bits`) for small
    inputs.
  - Implements direct bit-level arithmetic (`plus_bits`, `minus_bits`,
    `times_bits`) and direct $2m$ bit shifting (`shift2_bits_u`).
  - Added dedicated test suite in `tests/test-karatsuba.mjs` verifying
    squaring cases and mixed-sign pair multiplications against BigInt
    oracle.

### Performance & Benchmarking

- **Multiplication Performance Harness**
  (`scripts/perf-multiplication.mjs`):
  - Added multi-backend performance runner comparing `times` and
    `karatsuba` across LLVM, Wasm, kVM, and JS engines.
  - Supports `--mode squaring` (doubling bit width per step) and
    `--mode sizes` (random operands of fixed bit lengths).
  - Includes per-step timeout protection and process RSS memory guards.
  - Added `npm run perf:mult` script in `package.json`.

### CLI Usability & Backend Enhancements

- **Unified `-h` and `--help` CLI Documentation**:
  - Added comprehensive option and environment variable documentation
    across all benchmark, performance, and test scripts in `scripts/`
    and `backends/*/scripts/`.
- **LLVM Direct `.kvm` Bytecode Compilation**:
  - Added `compileKVMToExecutable` in `backends/llvm/src/executable.mjs`,
    enabling direct binary compilation from lowered `.kvm` IR.
- **Runtime Mark Compaction Fixes**:
  - Updated LLVM runtime compaction tracking (`%k_rt_tail_mark`) to
    accurately preserve base and last compaction arena marks in
    tail loops.

---

## [6.10.3] — 2026-10-04 — Unified File Formats Specification and Documentation Modernization

### Documentation & Core Architecture

- **Unified File Formats Specification (`DOCS/FILE_FORMATS.md`)**:
  - Added comprehensive specification for all primary file formats: `.k`
    (source), `.ko` (executable object), `.klib` (library object), and
    `.kvm` (polymorphic register-IR template), plus target artifacts
    (`.wasm`, native binary).
  - Added Mermaid transformation flowchart mapping compilation, linking,
    specialization, and execution workflows across CLI tools.
- **AOT Type Checking & Canonical Content-Addressing**:
  - Formally specified that AOT type checking performs relation expansion,
    structural type derivation, and constraint convergence in advance.
  - Clarified canonical content-addressed hashes (`@hash`) vs. local aliases,
    confirming there is no global symbol namespace, and documented explicit
    `--export` semantics for `--lib`.
- **Relations as Values & Absence of Built-in Numbers**:
  - Documented that numerical literals do not exist in `k`; names like `5`
    or `10` are nullary relations mapping `${} -> $bits`. Arithmetic relations
    operate on signed integer variants (`$int`), converting via `5 int`.
  - Clarified stream transformers (open domain) vs. closed constant relations
    (unit input domain `${}`).
- **Documentation Reformatting**:
  - Systematically updated and wrapped prose across `README.md` and all
    documents in `DOCS/`, `codecs/`, `objects/`, and `tests/` to <= 74
    characters per line.

---

## [6.10.2] — 2026-10-03 — Stack-Safe Value Serializer for REPL and Web REPL

### REPL & Codecs

- **Stack-Safe `valueToK()` Serializer**: Rewrote `valueToK()` in `codecs/runtime/show-value.mjs` using an explicit iterative worklist stack instead of JavaScript call-stack recursion. This prevents `RangeError: Maximum call stack size exceeded` crashes when displaying or previewing large, deep data structures (such as long lists) in the terminal REPL and Web REPL (`repl.html`).
- **Web REPL Tests**: Added end-to-end browser tests in `tests/test-repl-html.mjs` verifying list sorting (`poly.k`) and 10,000-element tail-loop compaction in `repl.html` under the `wasm` engine.

---

## [6.10.1] — 2026-10-02 — Fix Compaction Mark Reset and False Tail Calls in LLVM & WASM Backends

### LLVM & WebAssembly Backends

- **Compaction Mark Reset**: Fixed an issue in both LLVM (`krt.c`) and WebAssembly (`kvm2wasm.mjs`) where tail-loop compaction never reset the baseline arena mark after compacting live objects. Once the threshold was reached, compaction was erroneously triggered on every subsequent iteration, turning $O(N)$ execution into $O(N^2)$ and causing call-stack overflow on large inputs.
- **Product Branch Tail-Call Fix**: Fixed LLVM lowering in `kvm2llvm.mjs` where recursive calls inside product constructor fields were incorrectly classified as self-tail calls.

---

## [6.10.0] — 2026-10-02 — Dual Evaluation Engines (WASM & JS) and REPL Command Modernization

### REPL & Evaluation Engines

- **Dual Evaluation Engines**: The REPL now supports two evaluation modes:
  - `wasm` (default): Lowers expressions via polymorphic kVM to WebAssembly AOT bytecode for near-native performance, tail-call optimization, and stack safety.
  - `js`: Direct tree-walking JavaScript interpreter evaluating parsed relations via `run_rel` with pattern constraints for instant interpretation without compilation latency.
- **Engine Switching & CLI**:
  - REPL commands `:engine [wasm|js]`, `:wasm`, and `:js` dynamically inspect or switch the active evaluation engine.
  - CLI options `--engine=wasm`, `--engine=js`, `--wasm`, and `--js` added to `k-repl`.
  - Active engine displayed in execution timing annotations (`/* comp: Xms, exec: Yms (wasm) */` or `(js)`).
- **Web REPL (`repl.html`) Integration**:
  - Added clickable navbar engine badge (`wasm-in-process` <-> `js-in-process`) for one-click engine toggling in the browser.
  - Exported `getEngine()` and `setEngine()` on `window.kRepl`.
- **Command Modernization**:
  - Removed deprecated REPL commands: `:run expr`, `:eval expr`, `:time expr`, and `:t name`.
  - Renamed `:codes` to `:types` (listing type aliases).
  - Renamed `:d name` to `:rel name` (displaying relation definitions).

---

## [6.9.0] — 2026-10-01 — Reusable Codecs, Dynamic Pattern Derivation & Unified SDK

### Codecs & Type System

- **Dynamic Pattern Derivation**: All codecs derive their closed pattern graphs through `k`'s type system from filter and type expressions via `patternFromFilter`. Handwritten property-list JSON arrays have been completely eliminated from codecs.
- **Unified Codec SDK**: Added `codecs/runtime/codec-sdk.mjs` exporting a standard CLI harness (`runCodecCLI`), `Value` API, wire codecs, and `patternFromFilter`.
- **Recipe-Based REPL Codecs**: Refactored the REPL to use explicit recipe-driven input syntax (`:input <codec.mjs> [text]`) and multi-codec output formatting. Removed universal catch-all fallback and ungrounded types.
- **Self-Contained Web REPL VFS**: The browser REPL compiler (`scripts/build-repl-html.mjs`) bundles verified codecs into zero-import ES modules for the virtual file system, delegating `patternFromFilter` dynamically to the browser's bundled `k` engine.
- **Dead Code Clean-Up**: Removed dead files (`ieee-pattern.mjs`, `test-codec.mjs`, `typeFromValue.mjs`, `example-pipeline.mjs`).

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
