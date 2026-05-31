# k Test Suite

This directory contains the automated tests, type-derivation validation cases, integration test scripts, and benchmarks for the `k` compiler and runtime.

## Running the Tests

### 1. Run Unit and Integration Test Suite
To run all core unit tests, type-derivation checks, and integration tests:
```bash
npm test
```
This executes `node scripts/run-tests.mjs`, which discovers and runs the test scripts sequentially.

### 2. Run IEEE Arithmetic Performance Benchmark
To run the performance benchmark and evaluator conformance checks:
```bash
# Run with default (5 iterations)
npm run perf:ieee

# Run with custom iterations (e.g. 10)
ITERATIONS=10 npm run perf:ieee
```

---

## Test Directory Structure

### Core Test Files
- **[test.mjs](file:///Users/wojtek/gits/k/tests/test.mjs)**: Verifies basic parser and runtime execution behavior.
- **[test-kvm.mjs](file:///Users/wojtek/gits/k/tests/test-kvm.mjs)**: Comprehensive conformance testing for the kVM register compiler and interpreter under both envelope-aware and envelope-free modes.
- **[test-ieee-arithmetic.mjs](file:///Users/wojtek/gits/k/tests/test-ieee-arithmetic.mjs)**: Verifies IEEE-754 double precision float arithmetic implementation (`Examples/ieee.k`).
- **[test-repl.mjs](file:///Users/wojtek/gits/k/tests/test-repl.mjs)**: Tests interactive REPL commands, state transitions, imports, and auto-completions.
- **[test-k-object.mjs](file:///Users/wojtek/gits/k/tests/test-k-object.mjs)**: Tests serialization, compilation, and loading of `.ko` binary objects.
- **[test-fingerprint.mjs](file:///Users/wojtek/gits/k/tests/test-fingerprint.mjs)**: Tests semantic expression and relation hashing/fingerprinting.
- **[test-hash-normalization.mjs](file:///Users/wojtek/gits/k/tests/test-hash-normalization.mjs)**: Verifies consistent normalization of type pattern graphs and hashes.
- **[test-hash-fuzz.mjs](file:///Users/wojtek/gits/k/tests/test-hash-fuzz.mjs)**: Fuzzes expression/relation hashing to guard against collisions.

### Performance Benchmarks
- **[test-ieee-perf.mjs](file:///Users/wojtek/gits/k/tests/test-ieee-perf.mjs)**: Performs comparative benchmarks and outputs timings between the native JS evaluator and the kVM interpreter in both envelope-aware and envelope-free modes.

#### Envelope-Aware vs. Envelope-Free Execution Modes
In `k`, an **"envelope"** is the pattern metadata (type information) associated with a value. The benchmarks run in two distinct modes:

* **Envelope-Aware Mode (Default):** Values carry their dynamic pattern graphs, and every operation (projections, tag matching, etc.) performs runtime pattern checks, intersections, and propagates metadata. This ensures maximum runtime safety but incurs high overhead, especially during heavy bit-level arithmetic operations.
* **Envelope-Free Mode (Optimized):** If type derivation has converged (`isConverged === true`), we statically guarantee type safety. The interpreter strips away all internal runtime checks and pattern graph modifications (projections become direct layout index lookups), yielding a **~10x to 20x performance speedup**. The derived output pattern is only re-attached at the relation's execution boundaries.

### Type Derivation Suites
- **[code-derivation/](file:///Users/wojtek/gits/k/tests/code-derivation)**: Houses individual files (each containing a focused test scenario) validating type-derivation convergence and pattern-envelope generation.

### Integration Scripts
- **[integration.sh](file:///Users/wojtek/gits/k/tests/integration.sh)**: Shell script checking boundary data pipelines (`k-parse`, `k-show`, `k-print`) against binary outputs.
