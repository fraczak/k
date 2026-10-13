# Transducer & Polymorphic Execution Journal

Branch: `transducer`
Repository: `@fraczak/k`

## Objective

Design, specify, and implement an efficient compilation and execution
model for polymorphic functions in K.

The architecture bridges two fundamental physical data representations:
1. **Sequential Prefix-Free Streams** (Wire / Bitstream) operated by
   **Streaming Pushdown Transducers** for linear/erasing access.
2. **Random-Access Memory Tables** (Arena Nodes) operated by
   **Layout Witnesses** (Offset Dictionaries) and specialized
   monomorphic kernels (`?S F`).
3. **The Hybrid Dual-Form Pointer** (`KVal` / `KChild`), allowing values
   to remain compact wire slices by default, with on-demand **Spine
   Promotion** when non-linear (repeated / out-of-order) access occurs.

---

## Architecture Log & Decisions

### 2026-10-12: Architectural Foundations & TDD Initiation

- **Core Duality Formalized**:
  - *Witness Approach*: Operates on indexed random-access memory tables.
    Static offset vector $\Omega(S, F)$ resolves field access without
    dynamic string lookups.
  - *Transducer Approach*: Operates on sequential prefix-free code
    streams. State transitions over choice bits navigate variants and
    skip unneeded product fields without materialization or re-encoding.
- **Linearity vs Non-Linearity**:
  - Linear/affine access (erasing access: each field read $\le 1$ time in
    stream order) runs entirely in streaming Transducer mode in
    $O(\text{depth})$ stack memory with zero node allocations.
  - Non-linear access (duplication `{()x, ()x}`, out-of-order reads) is
    handled via:
    - Zero-copy slice duplication for independent linear readers.
    - Demand-driven **Spine Promotion**: materializing only the immediate
      outer product spine into an arena node with child pointers
      remaining as serialized wire slices.
- **TDD Test Suite Planned & Implemented**:
  - Initial suite created in `tests/test-polymorphic-tdd.mjs` (all 6
    tests passing).
  - Targets 6 orthogonal polymorphic patterns:
    1. Filtered Search (`search`): Opaque payload preservation &
       non-linear condition testing.
    2. Search with Field Reordering: Varied syntax and memory ordering.
    3. Boundary Cases: Empty lists, zero matches, all match.
    4. Multi-Variant Dispatch (`extract_id`): Variable byte offsets
       across variants.
    5. Dual-Stream Zip (`zip`): Concurrent independent polymorphic
       streams.
    6. Polymorphic Reverse (`poly_rev`): Accumulator and spine
       reconstruction.

### 2026-10-12: State-Indexed Access Table (`access-table.mjs`)

- **Algorithm Implemented (`buildAccessTable`)**:
  - Implemented in `access-table.mjs`.
  - Maps any input value schema $S$ to a function's structural access
    profile $P$.
  - Generates a state-indexed table of `NodeDescriptor` entries:
    - Products: maps logical field slots to physical slots, byte offsets,
      skip counts, and child states.
    - Unions: maps physical discriminators to branch indices and child
      states.
  - Zero runtime string lookups; single-array-load machine instruction
    dispatch.
- **Unit Verification (`tests/test-access-table.mjs`)**:
  - All tests passing: verifies offset calculation for `search` and
    `extract_id`.
  - Simulates in-memory payload navigation with zero string comparisons.

### 2026-10-12: Formal Specification of PKIR (`DOCS/POLYMORPHIC_IR.md`)

- Specified the Polymorphic K Intermediate Representation (PKIR):
  - Abstract state-indexed, slot-addressed instruction set.
  - Dual execution strategy: direct interpretation with `AccessTable`
    and fast monomorphic specialization.
  - Pure partial function semantics with failure propagation.

### 2026-10-12: PKIR Implementation & Specialization (`pkir.mjs`)

- **Compiler Lowering (`compileRelationToPKIR`)**:
  - Traverses relational AST and produces state-indexed PKIR instructions.
  - Automatically derives `accessProfile` per pattern node.
- **Fat-Pointer Runtime (`KVal` / `valueToKVal` / `kvalToValue`)**:
  - Materialized arena node simulation with dual-form support.
  - Lossless round-trip conversion preserving arbitrary nested payloads.
- **Direct Execution (`executePKIR`)**:
  - Evaluates PKIR instructions using `AccessTable` descriptors.
  - Supports recursive relation invocation (`call_rel`) and failure
    backtracking across union branches.
- **Monomorphic Specialization (`specializePKIR`)**:
  - Bakes concrete `AccessTable` into specialized instructions
    (`project_offset`, `match_tag_imm`).
  - Dead branch elimination: prunes non-matching union branches.
  - Direct execution of specialized artifacts without `AccessTable`.
- **Test Verification (`tests/test-pkir.mjs`)**:
  - Comprehensive 8-test suite verifying lowering, recursive search,
    multi-variant dispatch, specialization, and error handling.
  - Full project test suite (`npm test`) passes with 100% green status.

### 2026-10-12: Performance Evaluation (Previous Work vs PKIR)

- **Multi-Variant Dispatch Benchmark (`extract_id`, 200k iterations)**:
  - AST Interpreter (`run.mjs`): 225.98 ms (885,035 ops/s)
    [1.00x baseline].
  - kVM Interpreter (`kvm.mjs`): 78.36 ms (2,552,456 ops/s)
    [2.88x speedup].
  - PKIR Generic (`AccessTable`): 74.69 ms (2,677,615 ops/s)
    [3.03x speedup].
  - PKIR Specialized (`specializePKIR`): 62.23 ms (3,214,079 ops/s)
    [3.63x speedup].
- **Elimination of the Envelope Tax**:
  - In previous work (`scripts/perf-poly.mjs`), polymorphic envelope
    wrapping suffered a 26x performance penalty (31.74 ms envelope-aware
    vs 1.21 ms envelope-free).
  - The Layout Witness approach eliminates envelopes completely: layout
    witnesses index heterogeneous physical records directly without
    boxing or re-encoding.
- **Sub-30µs Specialization Latency**:
  - `buildAccessTable`: 2.28 µs per table.
  - `specializePKIR`: 24.87 µs per relation specialization.
  - Total Specialization Overhead: ~27.15 µs (compared to 100-1500 ms for
    traditional Wasm/LLVM AOT compilation), enabling instant runtime
    JIT tiering.
- **Zero Payload Re-encoding in Recursive Traversals (`search_`)**:
  - Evaluated on 100-element lists with arbitrary heterogeneous payloads.
  - Throughput: 404,703 items/sec (0.247 ms per 100-item pass).
  - Opaque payload slices (`data: payload_i`) are forwarded by fat-pointer
    references without traversing, unpacking, or re-serializing them.

### 2026-10-12: WebAssembly Integration in REPL (`repl.mjs` & `repl.html`)

- **PKIR-to-KVM Lowering (`lowerPKIRToKVM`)**:
  - Implemented and exported `lowerPKIRToKVM(pkir)` in `pkir.mjs` and
    `backend-api.mjs`.
  - Translates state-indexed PKIR instructions (`id`, `filter`,
    `project_slot`, `match_variant`, `make_variant`, `product`, `union`,
    `call_rel`) into machine-level KVM instructions for `lowerToWasm`.
  - Maps top-level input register and branch-local input registers to
    `%in`, enabling seamless integration with Wasm register allocation.
- **WebAssembly Compilation Pipeline**:
  - Extended `compileModule`, `compileWasmArtifactFromDefs`, and
    `compileWasmArtifactFromObject` in `backends/wasm/src/wasm.mjs` with
    the `usePKIR` option.
  - Implemented and exported `compileWasmArtifactFromPKIR(pkirInput)`.
- **REPL CLI Support (`repl.mjs`)**:
  - Added `pkir` engine mode: `--pkir`, `--engine=pkir`, `:pkir`,
    `:engine pkir`, and autocompletion in `:engine [wasm|pkir|js]`.
  - In `executeExpressionWithWasm`: routes compilation through PKIR when
    the engine is set to `pkir`.
- **Browser Web REPL (`repl.html`)**:
  - Updated `browser/repl-browser.mjs` with a 3-way engine badge toggle
    (`wasm-in-process` -> `pkir-wasm` -> `js-in-process`).
  - Added `.engine-badge.pkir-mode` badge styling in
    `scripts/build-repl-html.mjs` and rebuilt `repl.html`.
- **Verification**:
  - Verified evaluation of arithmetic, boolean logic, and lists via
    PKIR-generated WebAssembly.
  - Test suites (`tests/test-pkir.mjs`, `tests/test-repl.mjs`,
    `tests/test-repl-html.mjs`, and `npm test`) pass with 100% green.

### 2026-10-12: Integration into Performance Harnesses (`perf:*`)

- **Benchmark Integration**:
  - Integrated `pkir` execution lane into:
    - `scripts/perf-int.mjs`: Big Integer ops and 10-step squaring scale.
    - `scripts/perf-ieee.mjs`: IEEE 754 float ops across 144 evaluations.
    - `scripts/perf-multiplication.mjs`: Multi-backend squaring benchmark.
    - `scripts/perf-poly.mjs`: Polymorphic list ops and macro tracing.
  - Generates and compiles WebAssembly artifacts via
    `compileWasmArtifactFromObject(rel.object, { usePKIR: true })`.
- **Target Backend Selection**:
  - Added support for `BACKENDS=pkir`, `PKIR_ONLY=1`, and `--pkir-only`.
  - When unrestricted, all backends (`llvm`, `wasm`, `pkir`, `kvm`, `js`)
    execute concurrently for direct side-by-side comparison.
- **Convenience NPM Scripts (`package.json`)**:
  - Added `perf:int:pkir`: `BACKENDS=pkir node scripts/perf-int.mjs`
  - Added `perf:ieee:pkir`: `BACKENDS=pkir node scripts/perf-ieee.mjs`
  - Added `perf:mult:pkir`:
    `node scripts/perf-multiplication.mjs --backends pkir`
  - Added `perf:poly:pkir`: `BACKENDS=pkir node scripts/perf-poly.mjs`
- **Verification**:
  - All benchmarks verify 100% output conformance against native K
    oracle values.
  - Squaring benchmarks reach full 10/10 steps with matching outputs.

---

## Work Items & Progress

- [x] Branch creation (`transducer`)
- [x] Execution model & duality analysis documented
- [x] Initialize `JOURNAL.md`
- [x] Create `tests/test-polymorphic-tdd.mjs` test harness (passing)
- [x] Establish evaluator & kVM baseline passes
- [x] Design & implement `buildAccessTable` algorithm (`access-table.mjs`)
- [x] Create `tests/test-access-table.mjs` test suite (passing)
- [x] Formal PKIR specification (`DOCS/POLYMORPHIC_IR.md`)
- [x] Prototype `KVal` fat-pointer representation (`pkir.mjs`)
- [x] Implement PKIR compiler lowering (`compileRelationToPKIR`)
- [x] Implement PKIR execution engine (`executePKIR`)
- [x] Implement Monomorphic Specializer with dead branch elimination
- [x] Create `tests/test-pkir.mjs` test suite (passing)
- [x] Integrate with test runner (`scripts/run-tests.mjs`) & verify
- [x] Benchmark performance against previous work (AST & kVM baselines)
- [x] Integrate PKIR into Wasm lowering (`lowerPKIRToKVM`)
- [x] Enable PKIR in `repl.mjs` (`--pkir`, `:engine pkir`)
- [x] Enable PKIR in `repl.html` (3-way engine badge toggle)
- [x] Add PKIR to perf:* harnesses (perf:int, perf:ieee, perf:mult, poly)
