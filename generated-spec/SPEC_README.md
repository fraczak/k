# Type Derivation Algorithm - Formal Specification Suite

This is a complete, implementation-agnostic formal specification of the type derivation algorithm for the k programming language.

## Purpose

Transform the current JavaScript implementation into a formal specification that can be:
- Implemented in any programming language
- Used as documentation
- Verified for correctness
- Extended and modified systematically

## Quick Start

**For implementers:** Read [SPEC.md](SPEC.md) - it contains everything you need.

**For understanding:** Read [SPEC_ABSTRACT.md](SPEC_ABSTRACT.md) first, then [SPEC_EXAMPLE.md](SPEC_EXAMPLE.md).

**For theory:** Read [SPEC_MATHEMATICAL.md](SPEC_MATHEMATICAL.md).

## Document Structure

### Core Documents

1. **[SPEC.md](SPEC.md)** (5.2 KB)
   - **Complete specification** - start here for implementation
   - Covers: patterns, unification, typing rules, algorithm, complexity
   - Self-contained and implementation-agnostic

2. **[SPEC_ABSTRACT.md](SPEC_ABSTRACT.md)** (3.3 KB)
   - High-level overview of the algorithm
   - Core concepts without implementation details
   - Good introduction before diving into SPEC.md

3. **[SPEC_MATHEMATICAL.md](SPEC_MATHEMATICAL.md)** (2.3 KB)
   - Formal mathematical treatment
   - Typing judgments and inference rules
   - Soundness and termination properties

4. **[SPEC_EXAMPLE.md](SPEC_EXAMPLE.md)** (3.7 KB)
   - Worked examples showing algorithm in action
   - Step-by-step derivations
   - Illustrates key concepts concretely

### Supporting Documents

5. **[SPEC_DRAFT_01_UNDERSTANDING.md](SPEC_DRAFT_01_UNDERSTANDING.md)** (2.7 KB)
   - Analysis of current JavaScript implementation
   - Maps concepts to existing code

6. **[SPEC_DRAFT_02_DATA_STRUCTURES.md](SPEC_DRAFT_02_DATA_STRUCTURES.md)** (2.9 KB)
   - Formal definitions of all data structures
   - Type signatures and invariants

7. **[SPEC_DRAFT_03_UNIFICATION.md](SPEC_DRAFT_03_UNIFICATION.md)** (4.7 KB)
   - Complete unification rules with detailed table
   - All pattern combination cases
   - Error conditions

8. **[SPEC_DRAFT_04_LOCAL_RULES.md](SPEC_DRAFT_04_LOCAL_RULES.md)** (4.4 KB)
   - Typing rules for each expression type
   - Detailed constraints and initialization
   - Summary table

9. **[SPEC_DRAFT_05_ALGORITHM.md](SPEC_DRAFT_05_ALGORITHM.md)** (4.5 KB)
   - Complete algorithm with all phases
   - Compression and canonicalization
   - Convergence criteria

10. **[SPEC_INDEX.md](SPEC_INDEX.md)** (3.3 KB)
    - Navigation guide for all documents
    - Quick reference by use case

## Key Concepts

### Patterns (Type Constraints)

Patterns represent sets of types:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `(...)` | Open unknown | Any type with at least specified fields |
| `{...}` | Open product | Product with at least specified fields |
| `<...>` | Open union | Union with at least specified tags |
| `()` | Closed unknown | Exactly specified fields, constructor unknown |
| `{}` | Closed product | Exactly these fields |
| `<>` | Closed union | Exactly these tags |
| `T` | Named type | Reference to code definition |

### Algorithm Overview

```
1. INITIALIZE
   - Create [input, output] pattern pairs for each AST node
   - Apply local typing rules

2. ANALYZE DEPENDENCIES
   - Compute strongly connected components (SCCs)
   - Topologically sort

3. ITERATE TO FIXED POINT
   - For each SCC (bottom-up):
     * Inline referenced function types (clone)
     * Unify patterns according to constraints
     * Compress graph (bisimulation equivalence)
     * Repeat until stable

4. CANONICALIZE
   - Assign names based on derived types
```

### Unification

The core operation that merges patterns:

- Computes **least upper bound** (most specific common pattern)
- **Fails** on incompatible patterns (e.g., product vs union)
- **Recursively** unifies field destinations
- **Monotonic** refinement ensures termination

## Implementation Checklist

- [ ] Define pattern data structure
- [ ] Implement union-find forest
- [ ] Implement pattern graph with labeled edges
- [ ] Implement unification with complete rule table
- [ ] Implement local typing rules for each expression type
- [ ] Implement clone operation
- [ ] Implement SCC computation
- [ ] Implement fixed-point iteration
- [ ] Implement compression via bisimulation
- [ ] Implement error reporting with traces
- [ ] Add tests for each expression type
- [ ] Add tests for recursive definitions
- [ ] Add tests for error cases

## Differences from Current Implementation

This specification:

1. **Clarifies** pattern semantics (open vs closed)
2. **Formalizes** unification rules (complete table)
3. **Specifies** compression algorithm (bisimulation)
4. **Documents** complexity bounds
5. **Standardizes** error handling
6. **Makes explicit** all implicit assumptions

## Testing Strategy

1. **Unit tests** for unification (all pattern combinations)
2. **Unit tests** for each local typing rule
3. **Integration tests** for simple non-recursive functions
4. **Integration tests** for mutually recursive definitions
5. **Error tests** for incompatible patterns
6. **Performance tests** for large programs

## Future Extensions

- Vector/array types
- List comprehensions
- Built-in primitive types
- Type annotations and checking
- Polymorphism
- Subtyping

## References

- Current implementation: [patterns.mjs](patterns.mjs), [typing.mjs](typing.mjs)
- Existing documentation: [TYPING.md](TYPING.md)
- Language overview: [README.md](README.md)

## Questions?

For questions about:
- **Concepts**: See [SPEC_ABSTRACT.md](SPEC_ABSTRACT.md)
- **Details**: See [SPEC.md](SPEC.md)
- **Examples**: See [SPEC_EXAMPLE.md](SPEC_EXAMPLE.md)
- **Theory**: See [SPEC_MATHEMATICAL.md](SPEC_MATHEMATICAL.md)
- **Current code**: See [SPEC_DRAFT_01_UNDERSTANDING.md](SPEC_DRAFT_01_UNDERSTANDING.md)

---

**Total specification size:** ~35 KB across 10 documents  
**Created:** 2025-11-21  
**Status:** Complete formal specification ready for implementation
