# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [8.3.0] — 2026-10-22 — Content-Addressable Patterns & Aliasing

### Content-Addressable Canonical Patterns

- **Canonical Pattern Derivation & Minimal Automata**:
  - All pattern definitions compile to minimal regular tree automata
    identified by deterministic content-addressed hashes (`@hash`).
  - Canonical patterns take the full arity of all discovered variable
    nodes (e.g. `@hash[X0, X1] = {X0 x, X1 y};`).
  - Open wildcards `(...)` lower to open type holes equivalent to
    unbound variables, sharing canonical templates across definitions.
- **Named Patterns as Parameter Routing Aliases**:
  - Named patterns (`p[X] = {X x, Y y};`) are lexical aliases routing
    caller arguments to canonical parameter slots, padding unexposed
    internal ports with wildcards: `p[X] = @hash[X, (...)];`.
  - Isomorphic pattern permutations (`a[]`, `b[X]`, `c[X,Y]`, `d[Y,X]`)
    share the identical canonical hash, enabling deduplication.
  - Multi-level nested template applications and parameter reorderings
    resolve and decompile accurately.
- **Unification Preservation for Wildcards**:
  - Repeated internal existential variables in canonical templates
    preserve structural type-equality constraints when instantiated
    with wildcard arguments (`(...)`), preventing type pollution.
- **Knot Safety**:
  - The grammar strictly rejects parameter names that conflict with
    recursive knot variables (`= Knot`), preserving cycle semantics
    ($\mu$-fixpoints) and preventing recursion destruction.
- **REPL & Persistence**:
  - `:pats` lists all defined aliases and their canonical port routing.
  - `:pat <name>` decompiles and displays canonical definitions.
  - Saving to `.klib` preserves parameter and alias routing metadata
    origins without duplication.
- **Documentation**:
  - Authored `DOCS/CANONICAL_PATTERNS.md` and updated `README.md` and
    `DOCS/REPL.md`.

## [8.2.0] — 2026-10-21 — Canonical Pattern Decompilation & Parameters

### Interactive REPL & Tooling

- **Canonical Pattern Decompilation (`:pattern`, `:pat`)**:
  - `:pattern <name>` (or `:pat <name>`) prints the canonical pattern
    definition decompiled from its underlying minimal automaton,
    rather than echoing user-defined construction syntax.
  - Automatically erases author-chosen parameter and knot names,
    introducing canonical variables (`X0`, `X1`, `X2`, ...) in
    deterministic traversal (discovery) order.
  - Open type holes (`(...)`) are recorded as introduced parameters
    in the pattern header in discovery order:
    * `pair[X0, X1] = {X0 first, X1 second};  -- @hash`
    * `list[X1] = <{X1 car, X0 cdr} cons, {} nil>=X0;  -- @hash`
    * `same_pair[X0] = {X0 first, X0 second};  -- @hash`
    * `dict[X1, X2] = <{{X1 first, X2 second} car, X0 cdr} cons,`
      `{} nil>=X0;  -- @hash`
  - Added `patternGraphToCanonical` to `pretty.mjs` for decompiling
    pattern graphs with introduced canonical variables.
  - Supports direct pattern lookup by content-addressed hash
    (`:pattern @hash`, `:pat @hash`).
  - Displays canonical content-addressed digest comments (`-- @hash`).
  - Added comprehensive unit tests in `tests/test-repl.mjs`.
  - Updated documentation across `DOCS/REPL.md`,
    `DOCS/NAMED_PATTERNS.md`, and `DOCS/PATTERNS.md`.

## [8.1.0] — 2026-10-20 — Dynamic JSON Bit-Trie & json? Standard Library

### Dynamic JSON (djson) Consolidation

- **Unified Binary Bit-Trie Representation**:
  - Consolidated all dynamic JSON approaches onto the binary bit-trie
    implementation (`btrie[V]`), eliminating linear cons-lists and
    heap allocations in dynamic document navigation.
  - Standardized `Examples/djson.k` as the single dynamic JSON
    specification and `codecs/djson.mjs` (`k-djson`) as its codec.
  - Retired obsolete cons-list and Patricia trie dynamic JSON
    variants (`djson-btrie.k`, `djson-ptrie.k`, `djson-btrie.mjs`,
    `djson-ptrie.mjs`, `k-djson-btrie`, `k-djson-ptrie`).
- **Complete Standard Library on `json?`**:
  - Implemented standard dynamic JSON methods in `Examples/djson.k`
    operating directly on the universal `json?` type:
    * Object operations: `get`, `has?`, `set`, `del`
    * List operations: `nth`, `has_index?`, `set_nth`, `del_nth`,
      `push`
    * Enumerations: `keys`, `keys_raw`, `values`, `values_raw`
    * Cardinality: `length` (JSON float64 number), `length_nat`
      (`bits?`)
    * Type inspection: `type_of` and `is_*?` predicates

## [8.0.0] — 2026-10-20 — Named Patterns, Type Schemes & Trie Codecs

### Language & Type System

- **Named Patterns & Parameterized Schemes (`named-patterns.mjs`)**:
  - Introduced first-class syntax for closed named patterns:
    `byte[] = { bit 0, bit 1, ... };` and `bool[] = < bit false, ... >;`.
  - Added parameterized type schemes with explicit type variables:
    `list[X] = < X head, (list[X]) tail >;` and
    `pair[A, B] = { A first, B second };`.
  - Implemented monomorphic expansion with cycle detection and sharing.
  - Full object file support: `.ko` and `.klib` payloads serialize and
    deserialize named pattern tables alongside relations.

- **Standard Library & Examples Refactoring**:
  - Adopted named patterns throughout `core.k` (`bit[]`, `byte[]`,
    `pair[A, B]`, `either[A, B]`, `option[X]`).
  - Refactored `Examples/*.k` (`djson.k`, `arithmetics.k`, `bnat.k`,
    `nat.k`, `code.k`, `karatsuba-mult.k`, `poly.k`, `vhdl_to_k.k`)
    for clarity and conciseness using named patterns.

### Dynamic JSON Codecs

- **Bit-Trie Codec (`codecs/djson-btrie.mjs`, `k-djson-btrie`)**:
  - Added binary bit-trie dynamic JSON codec with variable-length
    bit prefixing for compact wire encodings.
  - Accompanied by formal K specification in `Examples/djson-btrie.k`.

- **Packed Nibble-Trie Codec (`codecs/djson-ptrie.mjs`)**:
  - Added packed 4-bit nibble trie codec (`k-djson-ptrie`) for
    optimized traversal.
  - Accompanied by formal K specification in `Examples/djson-ptrie.k`.

- **JSON Approaches Comparison & Benchmarks**:
  - Added comparative architecture and benchmark documentation in
    `DOCS/JSON_APPROACHES_COMPARISON.md`.
  - Added benchmark suite in `scripts/perf-djson.mjs` and
    `tests/bench-djson-tries.mjs`.

### Interactive REPL & Tooling

- **Pattern Inspection & Persistence in REPL**:
  - Added `:patterns` / `:pat` commands to inspect loaded patterns.
  - Display canonical type code / relation hashes:
    `name[] = ...  -- @hash`.
  - Added pattern lookup by `@hash` (`:pattern @hash`, `:pat @hash`).
  - Tab-completion support for pattern names and canonical `@hashes`.
  - Full pattern persistence across REPL sessions via `.klib` files.

---

## [7.2.0] — 2026-10-17 — Dynamic JSON Codec (djson) & Lazy Wire Decoding

### Features & Performance Improvements

- **Universal Dynamic JSON Codec (`codecs/djson.mjs`, `k-djson`)**:
  - Added a standalone dynamic JSON codec (`djson.mjs` / `k-djson`)
    based on a single 29-node recursive pattern `JSON = < number,
    string, bool, null, list, object >`, where arrays are encoded as
    arbitrary-length `cons`/`nil` lists and objects as `cons`/`nil`
    lists of `{ key, val }` pairs.
  - Kept the existing schema-specializing `json.mjs` (`k-json`) as an
    alternative record-oriented JSON codec.
  - Integrated `djson.mjs` into the CLI, REPL, and Web REPL (`repl.html`
    VFS).

- **Lazy Prefix-Free Wire Decoding & Fast Bitstream I/O**:
  - Implemented lazy wire decoding (`LazyGeneralProduct` and
    `LazyGeneralVariant`) with precomputed fixed-width bit sizes and
    static field offsets on pattern graphs.
  - Optimized bitstream reading/writing (`BitReader` / `BitWriter`) with
    word-level operations, pre-encoded closed pattern bytes, and direct
    bitstream-to-codepoint UTF-8 string decoding without intermediate
    AST allocations.

- **Stack-Safe & Bounded Value Rendering**:
  - Converted `valueToK`, `valueWithEnvelopeToK`, and wire serialization
    to iterative stack-safe algorithms with early character truncation
    (`maxChars`).
  - Added `:limit [num|none]` command and `--limit=<num>` CLI flag in
    `repl.mjs` (default: `4096` chars) and bounded DOM tree previews in
    `repl.html`.
  - Handled broken pipe (`EPIPE`) cleanly across codec CLI entrypoints.

## [7.1.0] — 2026-10-16 — Polymorphic K IR (PKIR) & CLI Standardization

### Features & Architecture Improvements

- **Polymorphic K IR (PKIR) & Access Table Engine**:
  - Implemented `pkir.mjs` providing an intermediate representation
    tailored for polymorphic relations with variant dispatch, projection
    tables, and partial function failure semantics.
  - Implemented `access-table.mjs` (`buildAccessTable`) for resolving
    field offsets and variant selectors across arbitrary schemas.
  - Added PKIR specialization (`specializePKIR`) eliminating dead
    branches and baking in direct physical offsets.
  - Supported PKIR execution and standalone executable generation across
    both WebAssembly and LLVM backends.
  - Added dedicated test suites: `tests/test-pkir.mjs`,
    `tests/test-access-table.mjs`, and `tests/test-polymorphic-tdd.mjs`.
  - Added specification and documentation in `DOCS/POLYMORPHIC_IR.md`
    and updated `DOCS/FILE_FORMATS.md`.

- **Web REPL (`repl.html`) & Wasm Integration**:
  - Enabled `.pkir` generation and lowering to WebAssembly in
    `repl.mjs` and `repl.html`.
  - Promoted Web REPL visibility in `README.md` (top banner,
    zero-install section, further reading).

- **Multi-Backend CLI Standardization & Help Completeness**:
  - Standardized CLI syntax, argument parsing, options, and help text
    (`-h` / `--help`) across tools in `backends/*/bin/` and
    `objects/`.
  - Consolidated `backends/llvm/bin/` (`k-llvm.mjs`, `k-llvm-build.mjs`,
    `k-llvm-compile.mjs`) to mirror `backends/wasm/bin/`.
  - Aligned `--lib` and `--export` options across LLVM, Wasm, and object
    tools.
  - Documented explicit defaults (such as cache directories, Clang
    optimization levels, and runtime modes) in CLI help texts.

- **Concurrent Multi-Backend Performance Benchmarks**:
  - Added concurrent `llvm` and `llvm-pkir` execution lanes across all
    performance suites (`perf:ieee`, `perf:int`, `perf:poly`,
    `perf:mult`).
  - Documented benchmark findings and throughput in `JOURNAL.md`.

## [7.0.2] — 2026-10-13 — LLVM Squaring Scaling & Backend Streamlining

### Features & Performance Improvements

- **Multiplication Algorithm Scaling Benchmark (LLVM & Multi-Backend)**:
  - Added successive squaring scale benchmark comparing standard long
    multiplication (`times`) and Karatsuba multiplication (`karatsuba`)
    across bit lengths doubling up to 7,650+ bits.
  - Added support for squaring execution and memory (peak RSS / heap)
    tracking across LLVM, WebAssembly, and interpreter lanes.
  - Aligned product field layouts and offset indexing in `kvm2llvm.mjs`.

### Bug Fixes & Compatibility

- **LLVM Open/Closed Pattern Compatibility on Wire Input**:
  - Allowed open and closed pattern compatibility when validating and
    unpacking wire inputs in the LLVM runtime (`krt.c` and
    `executable.mjs`).
  - Gracefully accepts framed inputs matching open-product schemas.

### Chores & Maintenance

- **Backend Streamlining (Wasm & LLVM Focus)**:
  - Removed legacy experimental ARM64 backend (`backends/arm64`) to focus
    on WebAssembly (portable) and LLVM (native) backends.
  - Updated documentation (`DOCS/FILE_FORMATS.md`,
    `DOCS/PROFILING_AND_TRACING.md`) and benchmark suites.
  - Enhanced pattern graph specialization and KIR monomorphization in
    `kir.mjs`.

## [7.0.1] — 2026-10-10 — Call-Graph Pattern Graph Specialization

### Bug Fixes & Backend Alignments

- **Pattern Graph Specialization Across Call Graphs**:
  - Implemented `specializeObjectRelations` in `kir.mjs` to propagate input
    schemas across relation call graphs via monomorphization.
  - Statically resolves field projection offsets for open product and
    polymorphic helper relations without dynamic fallback (`@k_product_get_n`).
  - Fixed WASM predicted field index calculation and aligned product header
    memory layout (`tagId` at header slots).
  - Resolved polymorphic list and open product projection alignment across
    LLVM, WASM, and Web REPL.
- **Filter Relation Naming Convention (`?` Suffix)**:
  - Standardized naming convention for all filter and schema relations to use
    the `?` suffix (e.g. `int?`, `bits?`, `bit?`, `string?`, `pattern?`,
    `bnat?`, `nat?`, `bool?`, matching `list?`).
  - Separated integer filter schema `int? = ?<...>` from constructor
    `int = nat | '+'` in `Examples/arithmetics.k`, removing symbol collision.

## [7.0.0] — 2026-10-10 — Unified Schemas, Relational Contracts, and Pure Syntax

### Breaking Language & Syntax Changes

- **Pure Relation Syntax (Removal of `$`)**:
  - Removed type declaration syntax (`$name = ...;`) and type expressions
    from the grammar (`parser.jison`).
  - All definitions in `.k` source files are now uniformly defined as
    relations: `name = relExpr;`.
  - Data shapes and types are defined as algebraic schemas via filter
    expressions (`?schema`) acting as partial identity relations.
  - Removed `:type` and `:types` REPL commands in favor of `:rel`,
    `:show`, and `:env`.

### Conceptual Architecture & Narrative

- **Schemas, Contracts, and Framed Payloads**:
  - **Schema**: Algebraic finite tree automata defining acceptable labeled
    tree payloads (replacing "codes" and "type patterns").
  - **Contract**: Connected $(input, output)$ schema graphs with shared
    vertices ($=X$) proving structure preservation across relations.
  - **Filter**: Syntactic operator `?schema` acting as a partial identity
    relation and inductive termination witness.
  - **Framed Payload `(schema, payload)`**: Universal self-describing
    wire framing representation.
  - **Canonical Schema**: Deterministic normal form of schema automata;
    hashes (`@hash`) serve as fixed-width content-addressable digests in
    the Schema Registry.

### Standard Library & Documentation

- **Library & Codec Migration**:
  - Updated `core.k`, `Examples/`, and test suites to pure relational
    syntax.
  - Updated string codecs and Web REPL VFS data.
- **Documentation Overhaul**:
  - Overhauled `README.md`, `DOCS/BIG_PICTURE.md`, `DOCS/DICTIONARY.md`,
    `DOCS/PATTERNS.md`, `DOCS/book.md`, and *The k Book* chapters 1–5.

---

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

[8.0.0]: https://github.com/fraczak/k/releases/tag/v8.0.0
[7.2.0]: https://github.com/fraczak/k/releases/tag/v7.2.0
[7.1.0]: https://github.com/fraczak/k/releases/tag/v7.1.0
[7.0.2]: https://github.com/fraczak/k/releases/tag/v7.0.2
[7.0.1]: https://github.com/fraczak/k/releases/tag/v7.0.1
[7.0.0]: https://github.com/fraczak/k/releases/tag/v7.0.0
[6.10.6]: https://github.com/fraczak/k/releases/tag/v6.10.6
[6.10.5]: https://github.com/fraczak/k/releases/tag/v6.10.5
[6.10.4]: https://github.com/fraczak/k/releases/tag/v6.10.4
[6.10.3]: https://github.com/fraczak/k/releases/tag/v6.10.3
[6.10.2]: https://github.com/fraczak/k/releases/tag/v6.10.2
[6.10.1]: https://github.com/fraczak/k/releases/tag/v6.10.1
[6.10.0]: https://github.com/fraczak/k/releases/tag/v6.10.0
[6.9.0]: https://github.com/fraczak/k/releases/tag/v6.9.0
[6.5.0]: https://github.com/fraczak/k/releases/tag/v6.5.0
[6.2.3]: https://github.com/fraczak/k/releases/tag/v6.2.3
[6.1.0]: https://github.com/fraczak/k/releases/tag/v6.1.0
[6.0.0]: https://github.com/fraczak/k/releases/tag/v6.0.0
