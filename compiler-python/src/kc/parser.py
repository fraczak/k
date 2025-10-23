"""
Parser for k-language source code.

This module implements a parser that converts k source text into AST nodes.
It follows the grammar defined in the main k repository's parser.jison file.
"""

import re
from typing import List, Dict, Optional, Iterator, Tuple
from dataclasses import dataclass
from .nodes import *


class TokenType:
    """Token types for k-language lexer."""
    # Literals
    STRING = "STRING"
    NAME = "NAME"
    
    # Operators and punctuation
    DOT = "DOT"           # .
    COMMA = "COMMA"       # ,
    SEMICOLON = "SC"      # ;
    COLON = "COL"         # :
    EQUALS = "EQ"         # =
    DOTS = "DOTS"         # ...
    
    # Brackets
    LPAREN = "LP"         # (
    RPAREN = "RP"         # )
    LBRACE = "LC"         # {
    RBRACE = "RC"         # }
    LANGLE = "LA"         # <
    RANGLE = "RA"         # >
    
    # Special
    DOLLAR = "DOLLAR"     # $
    QMARK = "QMARK"       # ?
    AT = "AT"             # @
    
    # End of file
    EOF = "EOF"


@dataclass
class Token:
    """A lexical token."""
    type: str
    value: str
    line: int
    column: int
    
    def __str__(self) -> str:
        return f"{self.type}({self.value}) at {self.line}:{self.column}"


class Lexer:
    """Lexical analyzer for k-language."""
    
    def __init__(self, source: str):
        self.source = source
        self.pos = 0
        self.line = 1
        self.column = 1
        self.tokens: List[Token] = []
        self._tokenize()
    
    def _current_char(self) -> Optional[str]:
        """Get current character or None if at end."""
        return self.source[self.pos] if self.pos < len(self.source) else None
    
    def _advance(self) -> None:
        """Advance position and update line/column."""
        if self.pos < len(self.source):
            if self.source[self.pos] == '\n':
                self.line += 1
                self.column = 1
            else:
                self.column += 1
            self.pos += 1
    
    def _skip_whitespace(self) -> None:
        """Skip whitespace characters."""
        while self._current_char() and self._current_char().isspace():
            self._advance()
    
    def _skip_comment(self) -> None:
        """Skip comments (// or # or % or --) to end of line, or /* ... */ multi-line."""
        ch = self._current_char()
        if ch == '/':
            if self.pos + 1 < len(self.source) and self.source[self.pos + 1] == '/':
                # Single line comment
                while self._current_char() and self._current_char() != '\n':
                    self._advance()
            elif self.pos + 1 < len(self.source) and self.source[self.pos + 1] == '*':
                # Multi-line comment
                self._advance()  # skip /
                self._advance()  # skip *
                while self.pos < len(self.source) - 1:
                    if self.source[self.pos] == '*' and self.source[self.pos + 1] == '/':
                        self._advance()  # skip *
                        self._advance()  # skip /
                        break
                    self._advance()
        elif ch in '#%':
            # Single line comment
            while self._current_char() and self._current_char() != '\n':
                self._advance()
        elif ch == '-' and self.pos + 1 < len(self.source) and self.source[self.pos + 1] == '-':
            # Single line comment
            while self._current_char() and self._current_char() != '\n':
                self._advance()
    
    def _read_string(self) -> str:
        """Read a quoted string literal."""
        quote_char = self._current_char()  # " or '
        self._advance()  # skip opening quote
        
        value = ""
        while self._current_char() and self._current_char() != quote_char:
            ch = self._current_char()
            if ch == '\\':
                self._advance()
                escape_ch = self._current_char()
                if escape_ch == 'n':
                    value += '\n'
                elif escape_ch == 't':
                    value += '\t'
                elif escape_ch == 'r':
                    value += '\r'
                elif escape_ch == '\\':
                    value += '\\'
                elif escape_ch == quote_char:
                    value += quote_char
                else:
                    value += escape_ch or ''
                self._advance()
            else:
                value += ch
                self._advance()
        
        if self._current_char() == quote_char:
            self._advance()  # skip closing quote
        
        return value
    
    def _read_name(self) -> str:
        """Read an identifier/name (can include digits)."""
        value = ""
        while (self._current_char() and 
               (self._current_char().isalnum() or self._current_char() in '_?!')):
            value += self._current_char()
            self._advance()
        return value
    
    def _tokenize(self) -> None:
        """Tokenize the entire source into a list of tokens."""
        while self.pos < len(self.source):
            self._skip_whitespace()
            
            if self.pos >= len(self.source):
                break
                
            ch = self._current_char()
            start_line, start_col = self.line, self.column
            
            # Comments
            if ch in '/##%-' or (ch == '-' and self.pos + 1 < len(self.source) and self.source[self.pos + 1] == '-'):
                self._skip_comment()
                continue
            
            # String literals
            elif ch in '"\'':
                value = self._read_string()
                self.tokens.append(Token(TokenType.STRING, value, start_line, start_col))
            
            # Multi-character operators
            elif ch == '.' and self.pos + 2 < len(self.source) and self.source[self.pos:self.pos+3] == '...':
                self.tokens.append(Token(TokenType.DOTS, '...', start_line, start_col))
                self._advance()
                self._advance()
                self._advance()
            
            # Single character tokens
            elif ch == '.':
                self.tokens.append(Token(TokenType.DOT, ch, start_line, start_col))
                self._advance()
            elif ch == ',':
                self.tokens.append(Token(TokenType.COMMA, ch, start_line, start_col))
                self._advance()
            elif ch == ';':
                self.tokens.append(Token(TokenType.SEMICOLON, ch, start_line, start_col))
                self._advance()
            elif ch == ':':
                self.tokens.append(Token(TokenType.COLON, ch, start_line, start_col))
                self._advance()
            elif ch == '=':
                self.tokens.append(Token(TokenType.EQUALS, ch, start_line, start_col))
                self._advance()
            elif ch == '(':
                self.tokens.append(Token(TokenType.LPAREN, ch, start_line, start_col))
                self._advance()
            elif ch == ')':
                self.tokens.append(Token(TokenType.RPAREN, ch, start_line, start_col))
                self._advance()
            elif ch == '{':
                self.tokens.append(Token(TokenType.LBRACE, ch, start_line, start_col))
                self._advance()
            elif ch == '}':
                self.tokens.append(Token(TokenType.RBRACE, ch, start_line, start_col))
                self._advance()
            elif ch == '<':
                self.tokens.append(Token(TokenType.LANGLE, ch, start_line, start_col))
                self._advance()
            elif ch == '>':
                self.tokens.append(Token(TokenType.RANGLE, ch, start_line, start_col))
                self._advance()
            elif ch == '$':
                self.tokens.append(Token(TokenType.DOLLAR, ch, start_line, start_col))
                self._advance()
            elif ch == '?':
                self.tokens.append(Token(TokenType.QMARK, ch, start_line, start_col))
                self._advance()
            elif ch == '@':
                self.tokens.append(Token(TokenType.AT, ch, start_line, start_col))
                self._advance()
            
            # Names/identifiers (including those starting with digits)
            elif ch.isalpha() or ch == '_' or ch.isdigit():
                value = self._read_name()
                self.tokens.append(Token(TokenType.NAME, value, start_line, start_col))
            
            else:
                raise SyntaxError(f"Unexpected character '{ch}' at {start_line}:{start_col}")
        
        # Add EOF token
        self.tokens.append(Token(TokenType.EOF, "", self.line, self.column))


class ParseError(Exception):
    """Exception raised during parsing."""
    pass


class Parser:
    """Recursive descent parser for k-language."""
    
    def __init__(self):
        self.tokens: List[Token] = []
        self.pos = 0
    
    def parse(self, source: str) -> Program:
        """Parse k source code and return AST."""
        lexer = Lexer(source)
        self.tokens = lexer.tokens
        self.pos = 0
        return self._parse_program()
    
    def _current_token(self) -> Token:
        """Get current token."""
        return self.tokens[self.pos] if self.pos < len(self.tokens) else self.tokens[-1]
    
    def _peek_token(self, offset: int = 1) -> Token:
        """Peek ahead at token."""
        index = self.pos + offset
        return self.tokens[index] if index < len(self.tokens) else self.tokens[-1]
    
    def _advance(self) -> Token:
        """Consume and return current token."""
        token = self._current_token()
        if token.type != TokenType.EOF:
            self.pos += 1
        return token
    
    def _expect(self, token_type: str) -> Token:
        """Consume token of expected type or raise error."""
        token = self._current_token()
        if token.type != token_type:
            raise ParseError(f"Expected {token_type}, got {token.type} at {token.line}:{token.column}")
        return self._advance()
    
    def _parse_program(self) -> Program:
        """Parse complete program: definitions* expression EOF"""
        type_defs: List[TypeDefinition] = []
        func_defs: List[FunctionDefinition] = []
        
        # Parse definitions
        while self._current_token().type != TokenType.EOF:
            if self._current_token().type == TokenType.DOLLAR:
                # Type definition
                type_defs.append(self._parse_type_definition())
            elif self._current_token().type == TokenType.NAME and self._peek_token().type == TokenType.EQUALS:
                # Function definition
                func_defs.append(self._parse_function_definition())
            else:
                # Main expression
                break
        
        # Parse main expression
        if self._current_token().type == TokenType.EOF:
            # Empty program, use identity function
            main_expr = Composition(functions=[])
        else:
            main_expr = self._parse_expression()
        
        self._expect(TokenType.EOF)
        
        return Program(
            type_definitions=type_defs,
            function_definitions=func_defs,
            main_expression=main_expr
        )
    
    def _parse_type_definition(self) -> TypeDefinition:
        """Parse type definition: $name = type;"""
        self._expect(TokenType.DOLLAR)
        name_token = self._expect(TokenType.NAME)
        self._expect(TokenType.EQUALS)
        type_expr = self._parse_type_expression()
        self._expect(TokenType.SEMICOLON)
        
        return TypeDefinition(name=name_token.value, type_expr=type_expr)
    
    def _parse_function_definition(self) -> FunctionDefinition:
        """Parse function definition: name = expression;"""
        name_token = self._expect(TokenType.NAME)
        self._expect(TokenType.EQUALS)
        expr = self._parse_expression()
        self._expect(TokenType.SEMICOLON)
        
        return FunctionDefinition(name=name_token.value, expression=expr)
    
    def _parse_type_expression(self) -> TypeExpr:
        """Parse type expression."""
        if self._current_token().type == TokenType.NAME:
            name = self._advance().value
            return TypeRef(name=name)
        elif self._current_token().type == TokenType.LBRACE:
            return self._parse_product_type()
        elif self._current_token().type == TokenType.LANGLE:
            return self._parse_union_type()
        else:
            raise ParseError(f"Expected type expression at {self._current_token().line}:{self._current_token().column}")

    def _parse_labelled_type_list(self) -> Dict[str, TypeExpr]:
        """Parse comma-separated list of 'type label' pairs."""
        fields: Dict[str, TypeExpr] = {}
        
        if self._current_token().type in [TokenType.RBRACE, TokenType.RANGLE]:
            return fields  # Empty list
        
        # Parse first item
        type_expr = self._parse_type_expression()
        label_token = self._expect(TokenType.NAME)
        fields[label_token.value] = type_expr
        
        # Parse remaining items
        while self._current_token().type == TokenType.COMMA:
            self._advance()
            if self._current_token().type in [TokenType.RBRACE, TokenType.RANGLE]:
                break  # Trailing comma
            type_expr = self._parse_type_expression()
            label_token = self._expect(TokenType.NAME)
            if label_token.value in fields:
                raise ParseError(f"Duplicate label '{label_token.value}' at {label_token.line}:{label_token.column}")
            fields[label_token.value] = type_expr
        
        return fields
    
    def _parse_product_type(self) -> ProductType:
        """Parse product type: { T1 label1, T2 label2, ... }"""
        self._expect(TokenType.LBRACE)
        fields = self._parse_labelled_type_list()
        self._expect(TokenType.RBRACE)
        return ProductType(fields=fields)
    
    def _parse_union_type(self) -> UnionType:
        """Parse union type: < T1 tag1, T2 tag2, ... >"""
        self._expect(TokenType.LANGLE)
        variants = self._parse_labelled_type_list()
        self._expect(TokenType.RANGLE)
        return UnionType(variants=variants)
    
    def _parse_expression(self) -> Expression:
        """Parse expression (partial function)."""
        return self._parse_union_expression()
    
    def _parse_union_expression(self) -> Expression:
        """Parse union expression with comma-separated alternatives."""
        alternatives = [self._parse_composition_expression()]
        
        while self._current_token().type == TokenType.COMMA:
            self._advance()
            alternatives.append(self._parse_composition_expression())
        
        if len(alternatives) == 1:
            return alternatives[0]
        else:
            return Union(alternatives=alternatives)
    
    def _parse_composition_expression(self) -> Expression:
        """Parse composition (space-separated functions)."""
        functions = []
        
        # Parse first term
        functions.append(self._parse_primary_expression())
        
        # Continue parsing terms until we hit a delimiter
        # Note: be careful not to consume NAME tokens that could be product labels
        while (self._current_token().type not in [TokenType.EOF, TokenType.COMMA, TokenType.RPAREN, 
                                                   TokenType.RBRACE, TokenType.RANGLE, TokenType.SEMICOLON]):
            # If we see a NAME token, we need to be careful - it might be a product label
            # For now, let's be conservative and only continue with non-NAME tokens
            # or NAME tokens that are clearly part of expressions (like after DOT)
            if self._current_token().type == TokenType.NAME:
                # Don't consume standalone NAME tokens - they might be labels
                break
            elif self._current_token().type in [TokenType.DOT, TokenType.DOLLAR, 
                                              TokenType.QMARK, TokenType.LPAREN, TokenType.LBRACE]:
                functions.append(self._parse_primary_expression())
            else:
                break
        
        if len(functions) == 1:
            return functions[0]
        else:
            return Composition(functions=functions)
    
    def _parse_primary_expression(self) -> Expression:
        """Parse primary expression (atoms and bracketed expressions)."""
        if self._current_token().type == TokenType.DOT:
            # Projection .field
            self._advance()
            field_token = self._expect(TokenType.NAME)
            return Projection(field=field_token.value)
            
        elif self._current_token().type == TokenType.NAME:
            # Name reference
            name_token = self._advance()
            return NameRef(name=name_token.value)
            
        elif self._current_token().type == TokenType.DOLLAR:
            # Type restriction $T
            self._advance()
            type_expr = self._parse_type_expression()
            return TypeRestriction(type_expr=type_expr)
            
        elif self._current_token().type == TokenType.QMARK:
            # Filter restriction ?filter
            self._advance()
            filter_expr = self._parse_filter_expression()
            return FilterRestriction(filter_expr=filter_expr)
            
        elif self._current_token().type == TokenType.LPAREN:
            # Parenthesized expression or empty composition
            self._advance()
            if self._current_token().type == TokenType.RPAREN:
                # Empty composition ()
                self._advance()
                return Composition(functions=[])
            else:
                expr = self._parse_expression()
                self._expect(TokenType.RPAREN)
                return expr
                
        elif self._current_token().type == TokenType.LBRACE:
            # Product {f label1, g label2, ...} or value literal
            return self._parse_product_or_value()
            
        elif self._current_token().type == TokenType.LANGLE:
            # Union < expr label, expr label, ... >
            self._advance()
            alternatives: Dict[str, Expression] = {}
            
            if self._current_token().type == TokenType.RANGLE:
                # Empty union <>
                self._advance()
                return Union(alternatives={})
            
            # Parse components - each must be expr label (same as products)
            while True:
                # Parse expression first
                expr = self._parse_expression()
                
                # Must be followed by a label (name)
                if self._current_token().type != TokenType.NAME:
                    raise ParseError(f"Expected label (NAME) after expression in union at {self._current_token().line}:{self._current_token().column}")
                
                label_token = self._advance()
                if label_token.value in alternatives:
                    raise ParseError(f"Duplicate label '{label_token.value}' at {label_token.line}:{label_token.column}")
                
                alternatives[label_token.value] = expr
                
                # Check for continuation
                if self._current_token().type == TokenType.COMMA:
                    self._advance()
                    continue
                elif self._current_token().type == TokenType.RANGLE:
                    self._advance()
                    break
                else:
                    raise ParseError(f"Expected ',' or '>' after component in union at {self._current_token().line}:{self._current_token().column}")
            
            return Union(alternatives=alternatives)
            
        else:
            raise ParseError(f"Unexpected token {self._current_token().type} at {self._current_token().line}:{self._current_token().column}")
    
    def _parse_product_or_value(self) -> Expression:
        """Parse product function {expr label, expr label, ...} - always expr label pairs."""
        self._advance()  # consume {
        components: Dict[str, Expression] = {}
        
        if self._current_token().type == TokenType.RBRACE:
            # Empty product function {} - takes input, produces unit value
            self._advance()
            return Product(components={})
        
        # Parse components - each must be expr label
        while True:
            # Parse expression first
            expr = self._parse_expression()
            
            # Must be followed by a label (name)
            if self._current_token().type != TokenType.NAME:
                raise ParseError(f"Expected label (NAME) after expression in product at {self._current_token().line}:{self._current_token().column}")
            
            label_token = self._advance()
            if label_token.value in components:
                raise ParseError(f"Duplicate label '{label_token.value}' at {label_token.line}:{label_token.column}")
            
            components[label_token.value] = expr
            
            # Check for continuation
            if self._current_token().type == TokenType.COMMA:
                self._advance()
                continue
            elif self._current_token().type == TokenType.RBRACE:
                self._advance()
                break
            else:
                raise ParseError(f"Expected ',' or '}}' after component in product at {self._current_token().line}:{self._current_token().column}")
        
        return Product(components=components)
    
    def _parse_filter_expression(self) -> 'FilterExpr':
        """Parse filter expression (simplified for now)."""
        # This is a stub - full filter parsing would be more complex
        if self._current_token().type == TokenType.NAME:
            name = self._advance().value
            return FilterVar(name=name)
        elif self._current_token().type == TokenType.DOLLAR:
            self._advance()
            type_expr = self._parse_type_expression()
            return FilterType(type_expr=type_expr)
        else:
            # Default to wildcard filter
            return FilterVar(name="...")


# Testing function
if __name__ == "__main__":
    # Simple test
    source = """
    $bool = < {} true, {} false >;
    neg = $bool < .true {{ } false}, .false {{ } true} > $bool;
    .x
    """
    
    parser = Parser()
    try:
        ast = parser.parse(source)
        print("Parse successful!")
        print(print_ast(ast))
    except Exception as e:
        print(f"Parse error: {e}")