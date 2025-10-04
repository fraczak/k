# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

k-language is an experimental programming language for building and manipulating JSON-like data structures. It defines first-order partial functions operating on typed tree structures, with a sophisticated type system based on finite tree automata.

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
./k.mjs <file.k>      # Execute k script
./repl.mjs            # Start interactive REPL
```

## Architecture

### Core Language Concepts
- **Partial Functions**: Functions may be undefined for some inputs (e.g., `.field` projection)
- **Function Composition**: `(f g h)` - sequential application
- **Union/Merge**: `<f, g>` - try f first, fallback to g
- **Product**: `{f label1, g label2}` - parallel application building records
- **Types (Codes)**: Finite tree automata defining value sets, no built-in types

### Key Implementation Files
- `parser.mjs` / `parser.jison` - Language parser (generated from Jison grammar)
- `run.mjs` - Runtime execution engine for partial functions
- `codes.mjs` - Type/code management and canonicalization
- `patterns.mjs` - Type pattern derivation system
- `typing.mjs` - Advanced type system implementation
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
- Extensive test suite in `Code-derivation-tests/` for type system validation
- REPL supports commands like `--C name` (show canonical type) and `--R name` (show type derivation)