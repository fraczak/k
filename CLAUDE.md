# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

k is an experimental language for describing algebraic data shapes and composing typed transformations over them. Data descriptions and transformations share one syntax; the native k-like notation is canonical, and a JSON-like notation is available as a convenience for textual values.

## Essential Commands

**Build/Parser Generation:**
```bash
npm run prepare  # Generate parsers from Jison grammar files
```

**Testing:**
```bash
npm test  # Run comprehensive test suite (unit tests, derivation tests, shell tests)
```

**Running k programs:**
```bash
./k.mjs -k <file.k>   # Execute k script
./repl.mjs            # Start interactive REPL (or: k-repl)
```

## Architecture

### Core Language Concepts
- **Partial Functions**: Functions may be undefined for some inputs (e.g., `.field` projection)
- **Function Composition**: `(f g h)` - sequential application
- **Union/Merge**: `<f, g>` - try f first, fallback to g
- **Product**: `{f label1, g label2}` - parallel application building records
- **Types (Codes)**: Finite tree automata defining value sets, no built-in types
- **Notation**: Prefer native k-like for products `{A l, ...}` and unions `<A t, ...>`; JSON-like `{l: A, ...}` and `<t: A, ...>` is supported for convenience
- **Variant value literals**: Use single-field product notation. Unit: `{{} tag}`; with payload `v`: `{ v tag }`. Angle brackets are for types/merge, not value literals.

### Key Implementation Files
- `parser.mjs` / `parser.jison` - Language parser (generated from Jison grammar)
- `run.mjs` - Runtime execution engine for partial functions
- `codes.mjs` - Type/code management and canonicalization
- `TypePatternGraph.mjs` - Core pattern graph data structure for type derivation
- `typing.mjs` - Type compression and advanced type system operations
- `Value.mjs` - Value representation and operations
- `index.mjs` - Main library entry point

### Multi-Stage Processing Pipeline
1. **Parsing**: Text → AST via Jison-generated parser
2. **Type Derivation**: Pattern-based type inference across expressions
3. **Canonicalization**: Types/functions get hash-based canonical names
4. **Execution**: Runtime evaluation with partial function semantics

### Type System
- **Product types**: `{type1 label1, type2 label2}` with projections `.label1`
- **Union types**: `<type1 label1, type2 label2>` with variant selection
- **Pattern matching**: Sophisticated constraint derivation system
- **Canonical names**: Hash-based universal registry for content-addressed modules

## Development Notes

- No external runtime dependencies (only jiwson for parser generation)
- Uses ES6 modules (.mjs files) throughout
- Extensive test suite in `tests/code-derivation/` for type system validation
- REPL supports commands like `:C name` (show canonical type), `:t name` (show relation type), and `:d name` (show relation definition)
