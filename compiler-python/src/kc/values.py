"""
Value representation and parser for k-language.

This module implements k's algebraic data types (Product and Variant values)
and provides parsing of JSON-like input data into these types.
"""

import json
from typing import Dict, Any, Union as TypingUnion
from dataclasses import dataclass
from abc import ABC, abstractmethod


class Value(ABC):
    """Base class for k values."""
    
    @abstractmethod
    def to_json(self) -> Any:
        """Convert to JSON representation."""
        pass
    
    @abstractmethod
    def __str__(self) -> str:
        """String representation."""
        pass


@dataclass(frozen=True)
class Product(Value):
    """Product value: {field1: value1, field2: value2, ...}"""
    fields: Dict[str, Value]
    
    def to_json(self) -> Dict[str, Any]:
        """Convert to JSON object."""
        return {field: value.to_json() for field, value in self.fields.items()}
    
    def __str__(self) -> str:
        if not self.fields:
            return "{}"
        field_strs = [f'"{field}":{value}' for field, value in self.fields.items()]
        return "{" + ",".join(field_strs) + "}"


@dataclass(frozen=True) 
class Variant(Value):
    """Variant value: {tag: value} (single-field product representing a tagged union)"""
    tag: str
    value: Value
    
    def to_json(self) -> Dict[str, Any]:
        """Convert to JSON object with single field."""
        return {self.tag: self.value.to_json()}
    
    def __str__(self) -> str:
        return "{" + f'"{self.tag}":{self.value}' + "}"


class ValueParser:
    """Parser for converting JSON-like data to k values."""
    
    def parse(self, data: TypingUnion[str, Dict, Any]) -> Value:
        """Parse JSON string or object into k value."""
        if isinstance(data, str):
            # Check if it looks like JSON (starts with { or [)
            if data.strip().startswith(('{', '[')):
                try:
                    json_obj = json.loads(data)
                    return self._parse_object(json_obj)
                except json.JSONDecodeError as e:
                    raise ValueError(f"Invalid JSON: {e}")
            else:
                # Treat as primitive string value
                return self._parse_object(data)
        else:
            # Already parsed object
            return self._parse_object(data)
    
    def _parse_object(self, obj: Any) -> Value:
        """Convert Python object to k value."""
        if obj is None:
            # null -> empty product (unit)
            return Product(fields={})
        
        elif isinstance(obj, dict):
            if not obj:
                # Empty dict -> empty product (unit)
                return Product(fields={})
            
            # Convert each field to k value
            fields = {}
            for field, value in obj.items():
                fields[field] = self._parse_object(value)
            
            # Single-field dict -> Variant (tagged union value)
            if len(fields) == 1:
                tag, value = next(iter(fields.items()))
                return Variant(tag=tag, value=value)
            
            # Multi-field dict -> Product
            return Product(fields=fields)
        
        elif isinstance(obj, list):
            # Convert list to product with numeric indices
            fields = {}
            for i, item in enumerate(obj):
                fields[str(i)] = self._parse_object(item)
            return Product(fields=fields)
        
        elif isinstance(obj, (str, int, float, bool)):
            # Primitive values -> single-field product with value as field name
            # This follows k's principle of "no primitive scalars"
            return Variant(tag=str(obj), value=Product(fields={}))
        
        else:
            raise ValueError(f"Cannot convert {type(obj)} to k value: {obj}")
    
    def from_json_file(self, filename: str) -> Value:
        """Parse JSON file into k value."""
        with open(filename, 'r') as f:
            json_obj = json.load(f)
        return self._parse_object(json_obj)


def from_object(obj: Any) -> Value:
    """Convenience function to convert object to k value."""
    parser = ValueParser()
    return parser.parse(obj)


# Example usage and testing
if __name__ == "__main__":
    parser = ValueParser()
    
    # Test cases
    test_cases = [
        # Unit value
        ({}, "{}"),
        
        # Variant values (single-field products)
        ({"tag": {}}, '{"tag":{}}'),
        ({"zero": {}}, '{"zero":{}}'),
        
        # Product values (multi-field)
        ({"x": {}, "y": {}}, '{"x":{},"y":{}}'),
        ({"first": {"a": {}}, "second": {"b": {}}}, '{"first":{"a":{}},"second":{"b":{}}}'),
        
        # Primitives converted to variants
        ("hello", '{"hello":{}}'),
        (42, '{"42":{}}'),
        (True, '{"True":{}}'),
    ]
    
    print("Testing value parser:")
    for obj, expected in test_cases:
        try:
            value = parser.parse(obj)
            result = str(value)
            status = "✓" if result == expected else "✗"
            print(f"{status} {obj} -> {result}")
            if result != expected:
                print(f"   Expected: {expected}")
        except Exception as e:
            print(f"✗ {obj} -> ERROR: {e}")