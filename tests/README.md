# k Test Suite

This directory contains the automated tests, type-derivation validation cases, and integration test scripts for the `k` compiler and runtime.

## Running the Tests

### 1. Run Unit and Integration Test Suite
To run all core unit tests, type-derivation checks, and integration tests:
```bash
npm test
```
This executes `node scripts/run-tests.mjs`, which discovers and runs the test scripts sequentially.

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

### WebAssembly Benchmarks

The WebAssembly execution benchmark moved to the separate
[`fraczak/k-wasm`](https://github.com/fraczak/k-wasm) backend repository.

### Type Derivation Suites
- **[code-derivation/](file:///Users/wojtek/gits/k/tests/code-derivation)**: Houses individual files (each containing a focused test scenario) validating type-derivation convergence and pattern-envelope generation.

### Integration Scripts
- **[integration.sh](file:///Users/wojtek/gits/k/tests/integration.sh)**: Shell script checking boundary data pipelines (`k-parse`, `k-show`, `k-print`) against binary outputs.
