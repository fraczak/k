"""
AST (Abstract Syntax Tree) definitions for k-language.

Following the compiler architecture from Chapter 9 of the k-language book,
this module defines the AST nodes for representing parsed k programs.
"""

from typing import Dict, List, Optional, Union as TypingUnion, Any
from dataclasses import dataclass


@dataclass
class Position:
    """Source code position information."""
    line: int
    column: int
    
    def __str__(self) -> str:
        return f"{self.line}:{self.column}"


@dataclass 
class SourceLocation:
    """Source location span."""
    start: Position
    end: Position
    
    def __str__(self) -> str:
        return f"{self.start}...{self.end}"


# Base AST node
class ASTNode:
    """Base class for all AST nodes."""
    def __init__(self, location: Optional[SourceLocation] = None):
        self.location = location


# Type definitions
@dataclass
class TypeRef(ASTNode):
    """Reference to a named type."""
    name: str


@dataclass
class ProductType(ASTNode):
    """Product type: { T1 label1, T2 label2, ... }"""
    fields: Dict[str, 'TypeExpr']


@dataclass
class UnionType(ASTNode):
    """Union type: < T1 tag1, T2 tag2, ... >"""
    variants: Dict[str, 'TypeExpr']


# Type expressions
TypeExpr = TypingUnion[TypeRef, ProductType, UnionType]


@dataclass
class TypeDefinition(ASTNode):
    """Type definition: $name = type;"""
    name: str
    type_expr: TypeExpr


# Expressions (partial functions)
@dataclass
class NameRef(ASTNode):
    """Reference to a named function."""
    name: str


@dataclass
class Projection(ASTNode):
    """Field projection: .field"""
    field: str


@dataclass
class Composition(ASTNode):
    """Function composition: (f g h)"""
    functions: List['Expression']


@dataclass
@dataclass
class Union(ASTNode):
    """Function union with labeled alternatives: < expr label, expr label, ... >"""
    alternatives: Dict[str, 'Expression']


@dataclass
class Product(ASTNode):
    """Function product: { f label1, g label2, ... }"""
    components: Dict[str, 'Expression']


@dataclass
class TypeRestriction(ASTNode):
    """Type restriction: $type"""
    type_expr: TypeExpr


@dataclass
class FilterRestriction(ASTNode):
    """Filter restriction: ?filter"""
    filter_expr: 'FilterExpr'


# Expressions
Expression = TypingUnion[
    NameRef, Projection, Composition, Union, Product, 
    TypeRestriction, FilterRestriction
]


@dataclass
class FunctionDefinition(ASTNode):
    """Function definition: name = expression;"""
    name: str
    expression: Expression


# Filter expressions (for pattern matching and type constraints)
@dataclass
class FilterVar(ASTNode):
    """Filter variable: X"""
    name: str


@dataclass
class FilterType(ASTNode):
    """Type filter: $type"""
    type_expr: TypeExpr


@dataclass
class FilterProduct(ASTNode):
    """Product filter: { Filter1 field1, ... }"""
    fields: Dict[str, 'FilterExpr']
    open: bool = False  # True if contains ...


@dataclass
class FilterUnion(ASTNode):
    """Union filter: < Filter1 tag1, ... >"""
    variants: Dict[str, 'FilterExpr']
    open: bool = False  # True if contains ...


@dataclass
class FilterBinding(ASTNode):
    """Filter binding: Filter = X"""
    filter_expr: 'FilterExpr'
    variable: str


# Filter expressions
FilterExpr = TypingUnion[
    FilterVar, FilterType, FilterProduct, FilterUnion, FilterBinding
]


@dataclass
class Program(ASTNode):
    """Complete k program: definitions + main expression."""
    type_definitions: List[TypeDefinition]
    function_definitions: List[FunctionDefinition]
    main_expression: Expression


# Utility functions
def ast_to_dict(node: ASTNode) -> Dict[str, Any]:
    """Convert AST node to dictionary representation."""
    if hasattr(node, '__dataclass_fields__'):
        result = {'_type': node.__class__.__name__}
        for field_name, field_def in node.__dataclass_fields__.items():
            value = getattr(node, field_name)
            if isinstance(value, ASTNode):
                result[field_name] = ast_to_dict(value)
            elif isinstance(value, list):
                result[field_name] = [ast_to_dict(item) if isinstance(item, ASTNode) else item for item in value]
            elif isinstance(value, dict):
                result[field_name] = {k: ast_to_dict(v) if isinstance(v, ASTNode) else v for k, v in value.items()}
            else:
                result[field_name] = value
        return result
    else:
        return node


def print_ast(node: ASTNode, indent: int = 0) -> str:
    """Pretty print AST for debugging."""
    spaces = "  " * indent
    if isinstance(node, Program):
        lines = [f"{spaces}Program:"]
        lines.append(f"{spaces}  Types:")
        for typedef in node.type_definitions:
            lines.append(print_ast(typedef, indent + 2))
        lines.append(f"{spaces}  Functions:")
        for funcdef in node.function_definitions:
            lines.append(print_ast(funcdef, indent + 2))
        lines.append(f"{spaces}  Main:")
        lines.append(print_ast(node.main_expression, indent + 2))
        return "\n".join(lines)
    elif isinstance(node, TypeDefinition):
        return f"{spaces}{node.name} = {print_ast(node.type_expr, 0)}"
    elif isinstance(node, FunctionDefinition):
        return f"{spaces}{node.name} = {print_ast(node.expression, 0)}"
    elif isinstance(node, ProductType):
        fields = ", ".join(f"{print_ast(t, 0)} {name}" for name, t in node.fields.items())
        return f"{{ {fields} }}"
    elif isinstance(node, UnionType):
        variants = ", ".join(f"{print_ast(t, 0)} {name}" for name, t in node.variants.items())
        return f"< {variants} >"
    elif isinstance(node, TypeRef):
        return f"${node.name}"
    elif isinstance(node, Projection):
        return f".{node.field}"
    elif isinstance(node, NameRef):
        return node.name
    else:
        return f"{spaces}{node.__class__.__name__}(...)"