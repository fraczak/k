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
