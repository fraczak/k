"""
Basic tests for k-language Python compiler.
"""

import pytest
from kc.parser import Parser, Lexer, TokenType
from kc.nodes import *
from kc.types import TypeSystem
from kc import parse_k_program, compile_to_llvm


class TestLexer:
    """Test the lexer component."""
    
    def test_basic_tokens(self):
        """Test basic token recognition."""
        source = ". , ; : = ( ) { } < > $ ? @"
        lexer = Lexer(source)
        
        expected_types = [
            TokenType.DOT, TokenType.COMMA, TokenType.SEMICOLON, TokenType.COLON,
            TokenType.EQUALS, TokenType.LPAREN, TokenType.RPAREN, TokenType.LBRACE,
            TokenType.RBRACE, TokenType.LANGLE, TokenType.RANGLE, TokenType.DOLLAR,
            TokenType.QMARK, TokenType.AT, TokenType.EOF
        ]
        
        actual_types = [token.type for token in lexer.tokens]
        assert actual_types == expected_types
    
    def test_string_literals(self):
        """Test string literal parsing."""
        source = '"hello" \'world\''
        lexer = Lexer(source)
        
        assert lexer.tokens[0].type == TokenType.STRING
        assert lexer.tokens[0].value == "hello"
        assert lexer.tokens[1].type == TokenType.STRING
        assert lexer.tokens[1].value == "world"
    
    def test_names(self):
        """Test identifier parsing."""
        source = "hello world_123 test?"
        lexer = Lexer(source)
        
        assert lexer.tokens[0].type == TokenType.NAME
        assert lexer.tokens[0].value == "hello"
        assert lexer.tokens[1].type == TokenType.NAME
        assert lexer.tokens[1].value == "world_123"
        assert lexer.tokens[2].type == TokenType.NAME
        assert lexer.tokens[2].value == "test?"
    
    def test_comments(self):
        """Test comment handling."""
        source = """
        // This is a comment
        hello # Another comment
        /* Multi-line
           comment */
        world
        """
        lexer = Lexer(source)
        
        # Only hello, world, EOF should remain
        assert len(lexer.tokens) == 3
        assert lexer.tokens[0].value == "hello"
        assert lexer.tokens[1].value == "world"


class TestParser:
    """Test the parser component."""
    
    def test_simple_projection(self):
        """Test parsing simple projection."""
        source = ".x"
        parser = Parser()
        ast = parser.parse(source)
        
        assert isinstance(ast, Program)
        assert isinstance(ast.main_expression, Projection)
        assert ast.main_expression.field == "x"
    
    def test_type_definition(self):
        """Test parsing type definition."""
        source = "$bool = < {} true, {} false >;"
        parser = Parser()
        ast = parser.parse(source)
        
        assert len(ast.type_definitions) == 1
        typedef = ast.type_definitions[0]
        assert typedef.name == "bool"
        assert isinstance(typedef.type_expr, UnionType)
        assert "true" in typedef.type_expr.variants
        assert "false" in typedef.type_expr.variants
    
    def test_function_definition(self):
        """Test parsing function definition.""" 
        source = "neg = .x;"
        parser = Parser()
        ast = parser.parse(source)
        
        assert len(ast.function_definitions) == 1
        funcdef = ast.function_definitions[0]
        assert funcdef.name == "neg"
        assert isinstance(funcdef.expression, Projection)
    
    def test_composition(self):
        """Test parsing composition."""
        source = "(.x .y)"
        parser = Parser()
        ast = parser.parse(source)
        
        assert isinstance(ast.main_expression, Composition)
        assert len(ast.main_expression.functions) == 2


class TestTypeSystem:
    """Test the type system."""
    
    def test_basic_type_analysis(self):
        """Test basic type canonicalization."""
        source = """
        $bool = < {} true, {} false >;
        $pair = { bool x, bool y };
        """
        
        ast = parse_k_program(source)
        type_system = TypeSystem()
        typed_program = type_system.analyze(ast)
        
        # Should have unit, bool, and pair types
        types = typed_program.get_canonical_types()
        assert len(types) >= 3  # unit + bool + pair
        
        # Check that bool is registered
        bool_id = typed_program.type_context.lookup_name("bool")
        assert bool_id is not None
        
        bool_type = typed_program.type_context.lookup_type(bool_id)
        assert bool_type.kind == "union"
        assert "true" in bool_type.fields
        assert "false" in bool_type.fields


class TestCodeGeneration:
    """Test LLVM IR code generation."""
    
    def test_simple_compilation(self):
        """Test compiling a simple program."""
        source = """
        $bool = < {} true, {} false >;
        neg = .x;
        neg
        """
        
        llvm_ir = compile_to_llvm(source)
        
        # Check that basic structure is present
        assert "define %Value*" in llvm_ir  # Function definition
        assert "declare %Value*" in llvm_ir  # Runtime declarations
        assert "%Value = type" in llvm_ir    # Value type definition
    
    def test_main_function_generation(self):
        """Test that main function is generated."""
        source = ".x"
        llvm_ir = compile_to_llvm(source)
        
        assert "define i32 @main" in llvm_ir
        assert "ret i32 0" in llvm_ir


class TestIntegration:
    """Integration tests."""
    
    def test_full_pipeline(self):
        """Test complete parse -> analyze -> compile pipeline."""
        source = """
        $unit = {};
        identity = $unit;
        identity
        """
        
        # Should not raise exceptions
        ast = parse_k_program(source)
        assert isinstance(ast, Program)
        
        type_system = TypeSystem()
        typed_program = type_system.analyze(ast)
        assert typed_program is not None
        
        llvm_ir = compile_to_llvm(source)
        assert isinstance(llvm_ir, str)
        assert len(llvm_ir) > 0


if __name__ == "__main__":
    pytest.main([__file__])