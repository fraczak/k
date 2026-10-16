# Polymorphic K Intermediate Representation (PKIR)

## 1. Overview

PKIR (Polymorphic K Intermediate Representation) is the target execution
contract for polymorphic `k` relations.

Unlike the high-level relational AST or traditional bytecode that
relies on runtime string lookups for field names and variant tags, PKIR
is a **state-indexed, slot-addressed intermediate representation**.

PKIR operates in two cooperating execution modes:
1. **Generic Polymorphic Mode**: Instructions execute against a
   precomputed `AccessTable` (Layout Witness), accessing fields and
   variants via static slot numbers and array lookups with zero string
   comparisons.
2. **Specialized Monomorphic Mode**: Given an `AccessTable`, a fast linear
   pass (`specializePKIR`) inlines offsets directly into immediate machine
   instructions, pruning unreachable union branches for peak LLVM/Wasm
   performance.

---

## 2. Core Concepts

### 2.1 The Structural Access Profile

Every PKIR relation is accompanied by an **Access Profile** derived from
its pattern graph:
- For every product pattern node $u$: a list of accessed field labels
  defining dense, zero-based **logical slots**:
  $$\text{fields}(u) = [ f_0, f_1, \dots, f_{k-1} ]$$
  where slot $i$ corresponds to field $f_i$.
- For every union pattern node $u$: a list of matched variant tags
  defining dense **branch targets**:
  $$\text{variants}(u) = [ v_0, v_1, \dots, v_{m-1} ]$$
  where branch $j$ corresponds to variant $v_j$.

### 2.2 Dual-Form Values (`KVal`)

Values in PKIR conform to the hybrid representation:
- **Serialized (Wire Slice)**: A pointer into an immutable prefix-free
  bitstream, carrying a bit offset and schema state.
- **Materialized (Arena Node)**: An allocated record in memory containing
  word-aligned pointers to child values.

---

## 3. Instruction Set

PKIR instructions operate over a register file (`%v0`, `%v1`, ...):

### 3.1 Field & Variant Operations

- **`project_slot dest, src, state, slot`**:
  Projects field at logical `slot` of pattern `state` from `src`.
  At runtime with `AccessTable`:
  ```c
  dest.ptr = src.ptr + table[src.state].slotToByteOffset[slot];
  dest.state = table[src.state].slotToChildState[slot];
  ```
- **`match_tag src, state, branches`**:
  Evaluates variant discriminator of `src` against pattern `state`.
  At runtime with `AccessTable`:
  ```c
  branch_idx = table[src.state].branchMap[src.tag];
  dest.state = table[src.state].childStateMap[src.tag];
  jump branches[branch_idx];
  ```
- **`make_variant dest, src, tag_id`**:
  Wraps `src` into a tagged union with discriminator `tag_id`.
- **`make_product dest, [src0, src1, ...]`**:
  Allocates a product node whose fields are registers `[src0, src1, ...]`.

### 3.2 Memory & Control Operations

- **`promote_spine dest, src`**:
  If `src` is in serialized wire form, materializes only its immediate
  outer record in the arena; children remain serialized wire slices.
  If `src` is already materialized, acts as identity.
- **`dup dest1, dest2, src`**:
  Zero-copy duplication of a value handle.
- **`call_rel dest, rel_name, src`**:
  Invokes relation `rel_name` with input `src`.
- **`id dest, src`**:
  Identity move.
- **`fail`**:
  Signals partial function failure (backtracking or branch exit).

---

## 4. Execution Pipeline

```text
[AOT Phase]
k source -> AST -> Type Pattern Graph -> PKIR Relation

[Runtime Invocation with (Schema S, Payload V)]
  1. AccessTable = buildAccessTable(S, PKIR.patternGraph)
  2. Choose execution tier:
     - Tier 0 (Interpreter): executePKIR(PKIR, V, AccessTable)
     - Tier 1 (Specialized AOT/JIT): specializePKIR(PKIR, AccessTable)
       -> direct emission to LLVM / WebAssembly
```
