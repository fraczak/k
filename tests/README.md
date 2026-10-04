# k Test Suite

This directory contains automated tests, type-derivation validation
cases, and integration test scripts for the `k` compiler and runtime.

## Running the Tests

### 1. Run Unit and Integration Test Suite
To run all core unit tests, type-derivation checks, and integration tests:
```bash
npm test
```
This executes `node scripts/run-tests.mjs`, which discovers and runs the
test scripts sequentially.

## Test Directory Structure

### Core Test Files
- **[test.mjs](test.mjs)**: Verifies basic parser and runtime
  execution behavior.
- **[test-kvm.mjs](test-kvm.mjs)**: Conformance testing for the kVM
  register compiler and interpreter in envelope-aware and envelope-free
  modes.
- **[test-kvm-polymorphic.mjs](test-kvm-polymorphic.mjs)**: Tests for
  polymorphic `.kvm` templates (`layer: "KVM-P"`) and runtime input
  envelope specialization (`specializeKVM`).
- **[test-ieee-arithmetic.mjs](test-ieee-arithmetic.mjs)**: Verifies
  IEEE-754 double precision float arithmetic (`Examples/ieee.k`).
- **[test-repl.mjs](test-repl.mjs)**: Tests interactive REPL commands,
  state transitions, imports, `.klib` and `.ko` exports.
- **[test-k-object.mjs](test-k-object.mjs)**: Tests serialization,
  compilation, and loading of `.ko` binary objects and `.klib` libraries.
- **[test-fingerprint.mjs](test-fingerprint.mjs)**: Tests semantic
  expression and relation hashing/fingerprinting (`@hash`).
- **[test-hash-normalization.mjs](test-hash-normalization.mjs)**:
  Verifies consistent normalization of type pattern graphs and hashes.
- **[test-hash-fuzz.mjs](test-hash-fuzz.mjs)**: Fuzzes expression and
  relation hashing to guard against collisions.

### Type Derivation Suites
- **[code-derivation/](code-derivation/)**: Individual files validating
  type-derivation convergence and pattern-envelope generation.

### Integration Scripts
- **[integration.sh](integration.sh)**: Shell script checking boundary
  data pipelines (`k-parse`, `k-show`, `k-print`) against binary outputs.
