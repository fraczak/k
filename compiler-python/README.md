# k-language Python Compiler

A Python implementation of the k-language compiler following Appendix A of the k-language book.

This compiler translates k programs into LLVM IR code, implementing the architecture described in Chapters 6-12 of the book.

## Installation

```bash
# From the compiler-python directory
pip install -e .

# Or install dependencies directly
pip install -r requirements.txt
```

## Usage

### Command Line Interface

```bash
# Compile a k program to LLVM IR
python -m kc.cli compile examples/simple.k -o output.ll

# Parse and show AST
python -m kc.cli parse examples/simple.k

# Show type analysis
python -m kc.cli analyze examples/simple.k
```

### Python API

```python
import kc

# Parse k source code
ast = kc.parse_k_program("""
$bool = < {} true, {} false >;
neg = .x;
neg
""")

# Compile to LLVM IR
llvm_ir = kc.compile_to_llvm(source)
print(llvm_ir)
```

## Architecture

This compiler follows the multi-stage architecture from Chapter 9:

1. **Parsing** (`parser.py`) - Converts source text to AST
2. **Type Analysis** (`types.py`) - Canonicalizes types and derives patterns
3. **Code Generation** (`codegen.py`) - Produces LLVM IR following the runtime ABI

## File Structure

```
src/kc/
├── __init__.py       # Main API
├── parser.py         # Lexer and recursive descent parser
├── ast.py           # AST node definitions
├── types.py         # Type system and canonicalization
├── codegen.py       # LLVM IR code generation
└── cli.py           # Command-line interface
```

## Runtime ABI

The generated LLVM IR follows the runtime ABI described in Chapters 6-8:

- **Values**: Represented as `%Value = { i32 type_id, i8* data }`
- **Functions**: Take `%Value*` input, return `%Value*` or null (undefined)
- **Types**: Canonical hash-based identifiers with metadata tables
- **Memory**: Reference counting with `k_retain`/`k_release`

## Examples

See the `examples/` directory for generated LLVM IR from simple k programs.

## Testing

```bash
# Run basic tests
python -m pytest tests/

# Test individual modules
python src/kc/parser.py
python src/kc/types.py
python src/kc/codegen.py
```

## Relation to Main k Implementation

This Python compiler shares:
- The same k-language syntax and semantics
- Compatible type canonicalization (hash-based)
- Same examples from `../Examples/` directory
- Aligned with the book's theoretical framework

Differences:
- Target: LLVM IR (this) vs. JavaScript runtime (main)
- Implementation: Python (this) vs. Node.js (main)  
- Purpose: Compilation (this) vs. interpretation (main)

## Next Steps

- [ ] Implement complete pattern/filter derivation system
- [ ] Add proper error handling and source location tracking
- [ ] Generate runtime library implementations
- [ ] Add optimization passes
- [ ] Support for external type definitions
- [ ] Integration with LLVM compilation pipeline