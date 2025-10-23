"""
k-language Python Compiler

A Python implementation of the k-language compiler following Appendix A of the k-language book.
This compiler translates k programs into LLVM IR code.
"""

__version__ = "0.1.0"

from .parser import Parser
from .parser import Parser
from .nodes import *
from .types import TypeSystem
from .codegen import CodeGenerator

__all__ = [
    "Parser",
    "TypeSystem", 
    "CodeGenerator",
    "compile_to_llvm",
    "parse_k_program"
]

def parse_k_program(source: str):
    """Parse k source code into an AST."""
    parser = Parser()
    return parser.parse(source)

def compile_to_llvm(source: str, optimize: bool = True) -> str:
    """Compile k source code to LLVM IR."""
    # Parse the source
    ast = parse_k_program(source)
    
    # Type analysis and canonicalization
    type_system = TypeSystem()
    typed_ast = type_system.analyze(ast)
    
    # Generate LLVM IR
    codegen = CodeGenerator()
    return codegen.generate(typed_ast, optimize=optimize)