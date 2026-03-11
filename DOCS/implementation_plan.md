# K Compiler Implementation Plan & Architecture

This document outlines the strategy for implementing the `k` compiler, adopting a hybrid approach to leverage the existing stable JavaScript logic for frontend tasks while building a new Python-based backend for LLVM generation. It also details the architectural solution for handling polymorphism via a Type Registry.

## 1. Hybrid Architecture Overview

The compiler is split into two distinct phases, communicating via a serialized JSON intermediate format.

1.  **Frontend (JavaScript):** Reuses the existing, robust `k` interpreter codebase (`parser.jison`, `typing.mjs`, `patterns.mjs`) to parse source code, perform type inference, and generate a fully annotated Abstract Syntax Tree (AST).
2.  **Backend (Python):** Consumes the annotated AST, translates it into an Intermediate Representation (IR), and generates LLVM IR.

This separation allows us to bypass the complexity of porting the unification and normalization logic immediately, focusing instead on code generation and runtime integration.

## 2. Phase 1: The JavaScript Frontend Bridge

**Goal:** Extract the fully analyzed program structure from the JS engine.

*   **New Component:** `k_compiler/js_frontend.mjs`
*   **Responsibilities:**
    *   Accept `k` source code from `stdin`.
    *   Invoke `k.annotate(script)` (from `index.mjs`) to perform parsing, type registration, and pattern derivation.
    *   Serialize the result to `stdout`. The output includes:
        *   **`rels`**: The normalized relations/functions, where every expression is annotated with input/output type patterns.
        *   **`codes`**: The type registry containing canonical definitions and hashes.
        *   **`relAlias`**: Map of relation names to their canonical hashes.

## 3. Phase 2: The Python Backend

**Goal:** Generate executable machine code (LLVM IR) from the annotated AST.

*   **Components:** `k_compiler/ir.py`, `k_compiler/codegen.py`
*   **Responsibilities:**
    *   **Load:** Deserialize the JSON provided by the frontend.
    *   **IR Translation:** Convert the annotated AST into the compiler's internal IR (`SEQ`, `PROJECT`, `CALL`, etc.).
    *   **LLVM Emission:** Translate internal IR to LLVM IR.
        *   Polymorphic operations (e.g., `project_x` on variable input types) are compiled as calls to the generic runtime library (`krt`).

## 4. Handling Polymorphism: The Type Registry & Runtime

A key challenge is compiling **polymorphic functions** (e.g., a function that accepts any record with field `.x`) when the specific input type is unknown at compile time.

### 4.1 The Challenge
In a static compilation model, accessing `.x` usually requires knowing the memory offset of `x`. If the input type varies at runtime (e.g., `{x, y}` vs `{z, x}`), the offset varies.

### 4.2 The Solution: Registry-Backed Runtime
Instead of generating specialized code for every possible type (monomorphization), the compiled code remains generic and relies on the **Runtime System** backed by a **Type Registry**.

**Workflow:**

1.  **The Type Registry (Global/Remote):**
    *   Acts as the universal source of truth.
    *   Stores canonical type definitions (Automata) indexed by their stable Hash.
    *   *Example:* Stores that `@Hash1` is `{x, y}` and `@Hash2` is `{z, x}`.

2.  **The Compiled Program (Local):**
    *   Does *not* hardcode offsets for polymorphic accesses.
    *   Calls runtime primitives: `k_project(value, "x")`.

3.  **The Runtime Library (`krt`):**
    *   **Initialization:** When the program starts (or receives data), it identifies the type Hash of the input.
    *   **Lazy Resolution:**
        *   Checks if `@Hash` is in the local cache.
        *   If missing, queries the **Type Registry** to retrieve the canonical definition.
        *   Builds a local **Metadata Table** (VTable equivalent) for that hash.
            *   *Entry:* `OFFSET("x") = 0` for `@Hash1`.
            *   *Entry:* `OFFSET("x") = 1` for `@Hash2`.
    *   **Execution:** `k_project` looks up the offset in the Metadata Table using the value's type hash and performs the access.

### 4.3 Advantages
*   **Flexibility:** The compiled code supports any future type that satisfies the structural requirements (e.g., having field `.x`), without recompilation.
*   **Safety:** Canonical hashes ensure that the data received matches the expected structure.
*   **Performance:** Metadata lookups are cached; subsequent accesses are `O(1)` array lookups, not hash map lookups.

## 5. Implementation Roadmap

1.  **Setup Frontend:** Implement `k_compiler/js_frontend.mjs` to export `annotate()` results.
2.  **Connect Backend:** Update `k_compiler/main.py` to use `js_frontend.mjs`.
3.  **Verify Pipeline:** Run `Examples/nat.k` through the hybrid pipeline and inspect the generated LLVM.
4.  **Expand Support:** Verify with `Examples/bnat.k` and other complex examples.
5.  **Runtime Stub:** Create a C/C++ runtime stub that implements the Registry lookup logic (mocked at first) to allow compiled binaries to run.
