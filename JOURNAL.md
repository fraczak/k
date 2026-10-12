# Transducer & Polymorphic Execution Journal

Branch: `transducer`
Repository: `@fraczak/k`

## Objective

Design, specify, and implement an efficient compilation and execution model
for polymorphic functions in K.

The architecture bridges two fundamental physical data representations:
1. **Sequential Prefix-Free Streams** (Wire / Bitstream) operated by
   **Streaming Pushdown Transducers** for linear/erasing access.
2. **Random-Access Memory Tables** (Arena Nodes) operated by
   **Layout Witnesses** (Offset Dictionaries) and specialized monomorphic
   kernels (`?S F`).
3. **The Hybrid Dual-Form Pointer** (`KVal` / `KChild`), allowing values to
   remain compact wire slices by default, with on-demand **Spine Promotion**
   when non-linear (repeated / out-of-order) access is required.

---

## Architecture Log & Decisions

### 2026-10-12: Architectural Foundations & TDD Initiation

- **Core Duality Formalized**:
  - *Witness Approach*: Operates on indexed random-access memory tables.
    Static offset vector $\Omega(S, F)$ resolves field access without
    dynamic string lookups.
  - *Transducer Approach*: Operates on sequential prefix-free code streams.
    State transitions over choice bits navigate variants and skip unneeded
    product fields without materialization or re-encoding.
- **Linearity vs Non-Linearity**:
  - Linear/affine access (erasing access: each field read $\le 1$ time in
    stream order) runs entirely in streaming Transducer mode in $O(\text{depth})$
    stack memory with zero node allocations.
  - Non-linear access (duplication `{()x, ()x}`, out-of-order reads) is
    handled via:
    - Zero-copy slice duplication for independent linear readers.
    - Demand-driven **Spine Promotion**: materializing only the immediate
      outer product spine into an arena node with child pointers remaining
      as serialized wire slices.
- **TDD Test Suite Planned**:
  - Initial suite created in `tests/test-polymorphic-tdd.mjs`.
  - Targets 5 orthogonal polymorphic patterns:
    1. Filtered Search (`search`): Opaque payload preservation & non-linear
       condition testing.
    2. Field Update (`toggle_flag`): Open product modification while
       preserving untouched field slices.
    3. Dual-Stream Zip (`zip`): Concurrent polymorphic streams with
       independent schemas.
    4. Multi-Variant Dispatch (`extract_id`): Variable byte offsets for
       a common field across distinct union branches.
    5. Tree Branching (`tree_lookup`): Non-linear recursion over nested
       structures.

---

## Work Items & Progress

- [x] Branch creation (`transducer`)
- [x] Execution model & duality analysis documented
- [x] Initialize `JOURNAL.md`
- [ ] Create `tests/test-polymorphic-tdd.mjs` test harness
- [ ] Establish evaluator & kVM baseline passes
- [ ] Prototype `KVal` fat-pointer representation
- [ ] Implement Spine Promotion primitive
- [ ] Implement Layout Witness & Transducer dispatch
