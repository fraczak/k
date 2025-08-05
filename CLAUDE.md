# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **k-language** - a functional programming language for building and manipulating JSON-like data. It describes first-order partial functions on tree-structured values (similar to JSON/XML), with a unique type system based on finite tree automata.

## Key Architecture

- **Core Language**: Defines partial functions via composition, union (merge), and product operations
- **Type System**: Based on finite tree automata with two constructs: product types `{t1 l1, t2 l2}` and union types `<t1 l1, t2 l2>`
- **Code Derivation**: Static type analysis using pattern graphs to derive canonical type representations
- **Universal Registry**: Hash-based canonical naming for types and functions

## Development Commands

### Build & Setup
```bash
npm install           # Install dependencies
npm run prepare       # Generate parsers from jison files
```

### Testing
```bash
npm test              # Run all tests
node test.mjs         # Run core tests
./tests.sh            # Run integration tests
for f in Code-derivation-tests/*.mjs; do node $f; done  # Run derivation tests
```

### Running Code
```bash
./k.mjs '{.toto TOTO}' data.json     # Run k expression on JSON data
./k.mjs -k Examples/nat.k -1 data.json  # Run k script file
./repl.mjs                           # Interactive REPL
```

### Common Development Tasks
```bash
node index.mjs                       # Test core compilation
node run.mjs                         # Test runtime
node typing.mjs                      # Test type derivation
```

## Key Files & Structure

- **index.mjs**: Main API - compilation and execution
- **k.mjs**: CLI interpreter for running k programs
- **repl.mjs**: Interactive REPL with debugging features
- **parser.mjs**: Generated parser for k language syntax
- **run.mjs**: Runtime execution engine
- **codes.mjs**: Type system and canonical code representation
- **patterns.mjs**: Type pattern derivation system
- **valueParser.mjs**: JSON value parser

## Language Syntax Highlights

- **Composition**: `(f1 f2 ... fn)` - function composition
- **Union/Merge**: `<f1, f2, ...>` - alternative functions
- **Product**: `{f1 label1, f2 label2, ...}` - parallel functions
- **Projection**: `.fieldname` - field access
- **Type definitions**: `$typename = <type expression>;`
- **Function definitions**: `name = expression;`

## Examples Directory

Contains sample k programs:
- `nat.k`: Natural numbers and arithmetic
- `list.k`: List operations
- `byte.k`: Byte manipulation
- `ieee.k`: IEEE floating point
- `vhdl_to_k.k`: VHDL conversion example

## Testing Framework

- **Code-derivation-tests/**: Individual type derivation test cases
- **test.mjs**: Core functionality tests
- **test-fingerprint.mjs**: Type canonicalization tests
- **test-filters.mjs**: Pattern/filter system tests