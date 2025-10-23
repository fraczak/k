"""
Type system implementation for k-language.

This module implements type canonicalization and the pattern/filter system
following Chapters 3-5 of the k-language book.
"""

from typing import Dict, List, Set, Optional, Union as TypingUnion, Tuple, Any
from dataclasses import dataclass, field
from .nodes import *
import hashlib


@dataclass
class CanonicalType:
    """A canonical type with a unique hash-based identifier."""
    id: str  # Hash-based canonical name
    kind: str  # 'product' or 'union'
    fields: Dict[str, str]  # field/tag name -> canonical type id
    
    def __str__(self) -> str:
        if self.kind == 'product':
            fields_str = ', '.join(f"{tid} {name}" for name, tid in self.fields.items())
            return f"{{ {fields_str} }}"
        else:  # union
            variants_str = ', '.join(f"{tid} {name}" for name, tid in self.fields.items())
            return f"< {variants_str} >"


@dataclass 
class TypeContext:
    """Context for type analysis and canonicalization."""
    types: Dict[str, CanonicalType] = field(default_factory=dict)  # id -> canonical type
    names: Dict[str, str] = field(default_factory=dict)  # user name -> canonical id
    
    def register_type(self, name: str, canonical_type: CanonicalType) -> str:
        """Register a type and return its canonical id."""
        self.types[canonical_type.id] = canonical_type
        self.names[name] = canonical_type.id
        return canonical_type.id
    
    def lookup_name(self, name: str) -> Optional[str]:
        """Look up canonical id by user-defined name."""
        return self.names.get(name)
    
    def lookup_type(self, type_id: str) -> Optional[CanonicalType]:
        """Look up canonical type by id."""
        return self.types.get(type_id)


class TypeSystem:
    """Type system for k-language with canonicalization."""
    
    def __init__(self):
        self.context = TypeContext()
        # Add built-in unit type
        unit_type = CanonicalType(
            id=self._compute_type_hash('product', {}),
            kind='product',
            fields={}
        )
        self.context.register_type('unit', unit_type)
    
    def _compute_type_hash(self, kind: str, fields: Dict[str, str]) -> str:
        """Compute canonical hash for a type."""
        # Sort fields by name for deterministic hashing
        sorted_fields = sorted(fields.items())
        content = f"{kind}:{','.join(f'{name}:{tid}' for name, tid in sorted_fields)}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    def _canonicalize_type_expr(self, type_expr: TypeExpr) -> str:
        """Convert type expression to canonical type id."""
        if isinstance(type_expr, TypeRef):
            # Look up named type
            canonical_id = self.context.lookup_name(type_expr.name)
            if canonical_id is None:
                raise TypeError(f"Undefined type '{type_expr.name}'")
            return canonical_id
        
        elif isinstance(type_expr, ProductType):
            # Canonicalize each field type
            canonical_fields = {}
            for field_name, field_type in type_expr.fields.items():
                canonical_fields[field_name] = self._canonicalize_type_expr(field_type)
            
            # Compute canonical id
            type_hash = self._compute_type_hash('product', canonical_fields)
            
            # Register if new
            if type_hash not in self.context.types:
                canonical_type = CanonicalType(
                    id=type_hash,
                    kind='product',
                    fields=canonical_fields
                )
                self.context.types[type_hash] = canonical_type
            
            return type_hash
        
        elif isinstance(type_expr, UnionType):
            # Canonicalize each variant type
            canonical_variants = {}
            for variant_name, variant_type in type_expr.variants.items():
                canonical_variants[variant_name] = self._canonicalize_type_expr(variant_type)
            
            # Compute canonical id
            type_hash = self._compute_type_hash('union', canonical_variants)
            
            # Register if new
            if type_hash not in self.context.types:
                canonical_type = CanonicalType(
                    id=type_hash,
                    kind='union',
                    fields=canonical_variants
                )
                self.context.types[type_hash] = canonical_type
            
            return type_hash
        
        else:
            raise TypeError(f"Unknown type expression: {type_expr}")
    
    def analyze_type_definitions(self, type_defs: List[TypeDefinition]) -> None:
        """Analyze and register all type definitions."""
        # First pass: create placeholders for recursive types
        for typedef in type_defs:
            # Create a temporary id for forward references
            temp_id = f"temp_{typedef.name}"
            self.context.names[typedef.name] = temp_id
        
        # Second pass: canonicalize all types
        for typedef in type_defs:
            canonical_id = self._canonicalize_type_expr(typedef.type_expr)
            # Update the mapping to the real canonical id
            self.context.names[typedef.name] = canonical_id
    
    def analyze_expression(self, expr: Expression) -> Tuple[str, str]:
        """
        Analyze expression and return (input_type_constraint, output_type).
        
        This is a simplified version of the pattern derivation system from Chapter 5.
        A full implementation would handle complex filter patterns.
        """
        if isinstance(expr, NameRef):
            # Function reference - would need function type table
            return "any", "any"
        
        elif isinstance(expr, Projection):
            # .field : {? field, ...} -> ?
            return "any_product", "any"
        
        elif isinstance(expr, TypeRestriction):
            # $T : any -> T (identity on type T)
            canonical_id = self._canonicalize_type_expr(expr.type_expr)
            return canonical_id, canonical_id
        
        elif isinstance(expr, Composition):
            # (f g) : domain(f) ∩ {x | f(x) ∈ domain(g)} -> range(g)
            if not expr.functions:
                # Empty composition is identity
                return "any", "any"
            
            # For now, simplified analysis
            return "any", "any"
        
        elif isinstance(expr, Union):
            # <f, g> : domain(f) ∪ domain(g) -> range(f) ∪ range(g)
            return "any", "any"
        
        elif isinstance(expr, Product):
            # {f label1, g label2} : domain(f) ∩ domain(g) -> {range(f) label1, range(g) label2}
            return "any", "any"
        
        else:
            return "any", "any"
    
    def analyze(self, program: Program) -> 'TypedProgram':
        """Perform complete type analysis on a program."""
        # Analyze type definitions first
        self.analyze_type_definitions(program.type_definitions)
        
        # Analyze function definitions
        typed_functions = {}
        for func_def in program.function_definitions:
            input_type, output_type = self.analyze_expression(func_def.expression)
            typed_functions[func_def.name] = {
                'input_type': input_type,
                'output_type': output_type,
                'expression': func_def.expression
            }
        
        # Analyze main expression
        main_input_type, main_output_type = self.analyze_expression(program.main_expression)
        
        return TypedProgram(
            type_context=self.context,
            typed_functions=typed_functions,
            main_expression=program.main_expression,
            main_input_type=main_input_type,
            main_output_type=main_output_type
        )


@dataclass
class TypedProgram:
    """A program with complete type information."""
    type_context: TypeContext
    typed_functions: Dict[str, Dict[str, Any]]
    main_expression: Expression
    main_input_type: str
    main_output_type: str
    
    def get_canonical_types(self) -> Dict[str, CanonicalType]:
        """Get all canonical types used in the program."""
        return self.type_context.types.copy()
    
    def print_type_table(self) -> str:
        """Print the canonical type table for debugging."""
        lines = ["Type Table:"]
        for type_id, canonical_type in self.type_context.types.items():
            lines.append(f"  {type_id}: {canonical_type}")
        return "\n".join(lines)


# Utility functions for working with types
def is_unit_type(type_id: str, context: TypeContext) -> bool:
    """Check if a type is the unit type {}."""
    canonical_type = context.lookup_type(type_id)
    return (canonical_type and 
            canonical_type.kind == 'product' and 
            len(canonical_type.fields) == 0)


def is_product_type(type_id: str, context: TypeContext) -> bool:
    """Check if a type is a product type."""
    canonical_type = context.lookup_type(type_id)
    return canonical_type and canonical_type.kind == 'product'


def is_union_type(type_id: str, context: TypeContext) -> bool:
    """Check if a type is a union type."""
    canonical_type = context.lookup_type(type_id)
    return canonical_type and canonical_type.kind == 'union'


def get_field_names(type_id: str, context: TypeContext) -> Set[str]:
    """Get field/variant names for a type."""
    canonical_type = context.lookup_type(type_id)
    return set(canonical_type.fields.keys()) if canonical_type else set()


# Testing function
if __name__ == "__main__":
    from .parser import Parser
    
    # Test type system
    source = """
    $bool = < {} true, {} false >;
    $pair = { bool x, bool y };
    """
    
    parser = Parser()
    ast = parser.parse(source)
    
    type_system = TypeSystem()
    typed_program = type_system.analyze(ast)
    
    print("Type analysis complete!")
    print(typed_program.print_type_table())