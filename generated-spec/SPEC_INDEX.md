# Type Derivation Specification - Document Index

This directory contains a formal specification of the type derivation algorithm for the k language, suitable for implementation in any programming language.

## Documents

### Main Specification
- **[SPEC.md](SPEC.md)** - Complete implementation-agnostic specification
  - Start here for a full understanding
  - Covers all aspects: patterns, unification, rules, algorithm
  - Suitable for implementers

### Abstract Overview
- **[SPEC_ABSTRACT.md](SPEC_ABSTRACT.md)** - High-level conceptual overview
  - Core ideas and intuition
  - Algorithm overview without details
  - Good for understanding the approach

### Mathematical Formulation
- **[SPEC_MATHEMATICAL.md](SPEC_MATHEMATICAL.md)** - Formal mathematical specification
  - Typing judgments and inference rules
  - Pattern lattice and unification theory
  - Soundness and termination properties

### Detailed Components
- **[SPEC_DRAFT_01_UNDERSTANDING.md](SPEC_DRAFT_01_UNDERSTANDING.md)** - Current implementation analysis
- **[SPEC_DRAFT_02_DATA_STRUCTURES.md](SPEC_DRAFT_02_DATA_STRUCTURES.md)** - Formal data structure definitions
- **[SPEC_DRAFT_03_UNIFICATION.md](SPEC_DRAFT_03_UNIFICATION.md)** - Complete unification rules and table
- **[SPEC_DRAFT_04_LOCAL_RULES.md](SPEC_DRAFT_04_LOCAL_RULES.md)** - Typing rules for each expression type

## Quick Reference

### For Implementers
1. Read [SPEC_ABSTRACT.md](SPEC_ABSTRACT.md) for overview
2. Study [SPEC.md](SPEC.md) for complete algorithm
3. Reference [SPEC_DRAFT_03_UNIFICATION.md](SPEC_DRAFT_03_UNIFICATION.md) for unification details
4. Reference [SPEC_DRAFT_04_LOCAL_RULES.md](SPEC_DRAFT_04_LOCAL_RULES.md) for expression rules

### For Theorists
1. Read [SPEC_MATHEMATICAL.md](SPEC_MATHEMATICAL.md) for formal foundations
2. Reference [SPEC.md](SPEC.md) for algorithmic details

### For Understanding Current Code
1. Read [SPEC_DRAFT_01_UNDERSTANDING.md](SPEC_DRAFT_01_UNDERSTANDING.md)
2. Compare with [patterns.mjs](patterns.mjs) and [typing.mjs](typing.mjs)

## Key Concepts

### Patterns
Type constraints representing sets of types:
- Open patterns: `(...)`, `{...}`, `<...>` - may have more fields
- Closed patterns: `()`, `{}`, `<>` - exact fields known
- Named types: `T` - reference to code definition

### Pattern Graph
- Nodes: patterns in union-find forest
- Edges: labeled by field names
- Representatives: equivalence class roots

### Unification
Merging patterns that must represent the same type:
- Computes least upper bound (most specific common pattern)
- Fails on incompatible patterns (e.g., product vs union)
- Recursively unifies field destinations

### Fixed-Point Iteration
For mutually recursive definitions:
1. Compute dependency SCCs
2. Process bottom-up
3. Inline referenced types
4. Iterate until stable
5. Compress via bisimulation

## Differences from Current Implementation

The specification clarifies and formalizes:
- Pattern representation and semantics
- Unification rules (complete table)
- Compression algorithm (bisimulation equivalence)
- Error handling and reporting
- Complexity bounds

## Future Work

- Extend to handle vectors/arrays
- Add support for list comprehensions
- Specify built-in type handling
- Add examples and test cases
- Prove termination and soundness formally
