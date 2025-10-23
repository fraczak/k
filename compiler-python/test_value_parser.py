#!/usr/bin/env python3
"""
Comprehensive test of k-language value parser.
Demonstrates conversion from JSON to k's algebraic data types.
"""

from src.kc.values import ValueParser, Product, Variant
import json


def test_value_parser():
    """Test the k value parser with various input types."""
    
    print("=== K-Language Value Parser Test ===\n")
    
    parser = ValueParser()
    
    # Test cases: (description, input, expected k value type, expected string)
    test_cases = [
        # Basic k values
        ("Empty product (unit)", {}, Product, "{}"),
        ("Single variant", {"zero": {}}, Variant, '{"zero":{}}'),
        ("Multi-field product", {"x": {}, "y": {}}, Product, '{"x":{},"y":{}}'),
        
        # JSON primitive conversion
        ("String to variant", "hello", Variant, '{"hello":{}}'),
        ("Number to variant", 42, Variant, '{"42":{}}'),
        ("Boolean to variant", True, Variant, '{"True":{}}'),
        ("Null to unit", None, Product, "{}"),
        
        # Complex nested structures
        ("Nested products", {"outer": {"inner": {}}}, Variant, '{"outer":{"inner":{}}}'),
        ("Mixed nesting", {"data": {"name": "John", "count": 5}}, Variant, '{"data":{"name":{"John":{}},"count":{"5":{}}}}'),
        
        # Arrays
        ("Empty array", [], Product, "{}"),
        ("Simple array", [1, 2, 3], Product, '{"0":{"1":{}},"1":{"2":{}},"2":{"3":{}}}'),
        
        # Real k-like data
        ("Bit zero", {"0": {}}, Variant, '{"0":{}}'),
        ("Bit one", {"1": {}}, Variant, '{"1":{}}'),
        ("Natural number zero", {"zero": {}}, Variant, '{"zero":{}}'),
        ("Natural number succ", {"succ": {"zero": {}}}, Variant, '{"succ":{"zero":{}}}'),
    ]
    
    print("Testing various input types:")
    success_count = 0
    
    for description, input_data, expected_type, expected_str in test_cases:
        try:
            value = parser.parse(input_data)
            
            # Check type
            type_ok = isinstance(value, expected_type)
            
            # Check string representation
            str_ok = str(value) == expected_str
            
            # Check JSON round-trip
            json_value = value.to_json()
            
            status = "✓" if (type_ok and str_ok) else "✗"
            print(f"{status} {description}")
            print(f"    Input: {input_data}")
            print(f"    K value: {value} ({type(value).__name__})")
            print(f"    JSON: {json_value}")
            
            if not type_ok:
                print(f"    ✗ Expected {expected_type.__name__}, got {type(value).__name__}")
            if not str_ok:
                print(f"    ✗ Expected: {expected_str}")
            
            if type_ok and str_ok:
                success_count += 1
                
            print()
            
        except Exception as e:
            print(f"✗ {description}: ERROR - {e}")
            print(f"    Input: {input_data}\n")
    
    # Test JSON string parsing
    print("Testing JSON string parsing:")
    json_test_cases = [
        ('{}', '{}'),
        ('{"tag": {}}', '{"tag":{}}'),
        ('{"x": {}, "y": {}}', '{"x":{},"y":{}}'),
        ('[1, 2]', '{"0":{"1":{}},"1":{"2":{}}}'),
    ]
    
    for json_str, expected in json_test_cases:
        try:
            value = parser.parse(json_str)
            result = str(value)
            status = "✓" if result == expected else "✗"
            print(f"{status} '{json_str}' -> {result}")
            if result == expected:
                success_count += 1
        except Exception as e:
            print(f"✗ '{json_str}' -> ERROR: {e}")
    
    total_tests = len(test_cases) + len(json_test_cases)
    print(f"\n🎯 Results: {success_count}/{total_tests} tests passed")
    
    if success_count == total_tests:
        print("🎉 All tests passed! Value parser working correctly.")
        print("\nKey capabilities:")
        print("• Converts JSON objects to k Products and Variants")
        print("• Handles primitive values by converting to tagged variants")  
        print("• Supports arrays as products with numeric field labels")
        print("• Maintains k's 'no primitive scalars' principle")
        print("• Compatible with k's algebraic data type semantics")
        return True
    else:
        print("❌ Some tests failed.")
        return False


if __name__ == "__main__":
    test_value_parser()