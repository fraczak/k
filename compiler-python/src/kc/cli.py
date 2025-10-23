"""
Command-line interface for k-language Python compiler.
"""

import argparse
import sys
import json
from pathlib import Path
from typing import Optional

from . import parse_k_program, compile_to_llvm
from .nodes import print_ast
from .types import TypeSystem
from .values import ValueParser, Value


def cmd_parse(args) -> None:
    """Parse k source and show AST."""
    source = Path(args.input).read_text()
    try:
        ast = parse_k_program(source)
        print("Parse successful!")
        print(print_ast(ast))
    except Exception as e:
        print(f"Parse error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_analyze(args) -> None:
    """Parse and analyze types."""
    source = Path(args.input).read_text()
    try:
        ast = parse_k_program(source)
        type_system = TypeSystem()
        typed_program = type_system.analyze(ast)
        
        print("Type analysis successful!")
        print(typed_program.print_type_table())
        print(f"\nMain expression type: {typed_program.main_input_type} -> {typed_program.main_output_type}")
    except Exception as e:
        print(f"Analysis error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_compile(args) -> None:
    """Compile k source to LLVM IR."""
    source = Path(args.input).read_text()
    try:
        llvm_ir = compile_to_llvm(source, optimize=args.optimize)
        
        if args.output:
            Path(args.output).write_text(llvm_ir)
            print(f"Compiled to: {args.output}")
        else:
            print(llvm_ir)
    except Exception as e:
        print(f"Compilation error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_test_examples(args) -> None:
    """Test compilation of examples from the main k repository."""
    examples_dir = Path("../Examples")  # Relative to compiler-python/
    if not examples_dir.exists():
        print(f"Examples directory not found: {examples_dir}")
        sys.exit(1)
    
    success_count = 0
    total_count = 0
    
    for k_file in examples_dir.glob("*.k"):
        total_count += 1
        print(f"Testing {k_file.name}...")
        
        try:
            source = k_file.read_text()
            llvm_ir = compile_to_llvm(source)
            
            # Write output to examples/ directory
            output_file = Path("examples") / f"{k_file.stem}.ll"
            output_file.parent.mkdir(exist_ok=True)
            output_file.write_text(llvm_ir)
            
            print(f"  ✓ Success -> {output_file}")
            success_count += 1
            
        except Exception as e:
            print(f"  ✗ Failed: {e}")
    
    print(f"\nResults: {success_count}/{total_count} examples compiled successfully")
    if success_count < total_count:
        sys.exit(1)


def cmd_run(args) -> None:
    """Run k program with input value."""
    # Get k source
    if args.expr:
        source = args.input  # Treat as expression
    else:
        source = Path(args.input).read_text()  # Read from file
    
    # Get input value
    value_parser = ValueParser()
    try:
        if args.value_file:
            # Read from JSON file
            input_value = value_parser.from_json_file(args.value_file)
        elif args.value:
            # Parse command line value
            input_value = value_parser.parse(args.value)
        else:
            # Read from stdin
            stdin_data = sys.stdin.read().strip()
            if not stdin_data:
                input_value = value_parser.parse("{}")  # Empty/unit value
            else:
                input_value = value_parser.parse(stdin_data)
        
        print(f"Input value: {input_value}")
        
        # TODO: Actually run the k program on the input value
        # For now, just show that we can parse both the program and input
        print("K program parsing and value parsing successful!")
        print("Note: Actual execution not yet implemented - need runtime system.")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="k-language Python compiler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  kc parse examples/simple.k           # Show AST
  kc analyze examples/simple.k         # Show type analysis  
  kc compile examples/simple.k         # Compile to LLVM IR
  kc compile input.k -o output.ll      # Compile to file
  kc run examples/simple.k '{}'        # Run with input value
  kc run --expr 'x' '{"hello": {}}'    # Run expression with value
  kc run program.k --value-file data.json  # Run with JSON file input
  kc test-examples                     # Test all examples
        """
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Parse command
    parse_parser = subparsers.add_parser("parse", help="Parse k source and show AST")
    parse_parser.add_argument("input", help="Input k source file")
    parse_parser.set_defaults(func=cmd_parse)
    
    # Analyze command  
    analyze_parser = subparsers.add_parser("analyze", help="Parse and analyze types")
    analyze_parser.add_argument("input", help="Input k source file")
    analyze_parser.set_defaults(func=cmd_analyze)
    
    # Compile command
    compile_parser = subparsers.add_parser("compile", help="Compile k source to LLVM IR")
    compile_parser.add_argument("input", help="Input k source file")
    compile_parser.add_argument("-o", "--output", help="Output file (default: stdout)")
    compile_parser.add_argument("--no-optimize", dest="optimize", action="store_false",
                               help="Disable optimizations")
    compile_parser.set_defaults(func=cmd_compile)
    
    # Test examples command
    test_parser = subparsers.add_parser("test-examples", help="Test compilation of all examples")
    test_parser.set_defaults(func=cmd_test_examples)
    
    # Run command
    run_parser = subparsers.add_parser("run", help="Run k program with input value")
    run_parser.add_argument("input", help="Input k source file or expression")
    run_parser.add_argument("value", nargs="?", help="Input value as JSON (default: stdin)")
    run_parser.add_argument("-f", "--value-file", help="Read input value from JSON file")
    run_parser.add_argument("--expr", action="store_true", help="Treat input as k expression, not file")
    run_parser.set_defaults(func=cmd_run)
    
    # Parse arguments
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    # Run command
    args.func(args)


if __name__ == "__main__":
    main()