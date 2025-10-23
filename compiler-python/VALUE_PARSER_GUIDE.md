# K-Language Value Parser Integration

The k-language Python compiler now includes a complete value parser that enables running k programs on real data.

## Value Format

K uses algebraic data types with no primitive scalars:

- **Products**: `{field1: value1, field2: value2}` - records/structs
- **Variants**: `{tag: value}` - tagged unions (single-field products)  
- **Unit**: `{}` - empty product, the base value

## JSON to K Value Conversion

The value parser converts JSON data into k's algebraic data types:

```python
from src.kc.values import ValueParser

parser = ValueParser()

# Empty object -> unit value
parser.parse('{}')                    # -> {}

# Single-field object -> variant  
parser.parse('{"zero": {}}')          # -> {"zero":{}}

# Multi-field object -> product
parser.parse('{"x": {}, "y": {}}')    # -> {"x":{},"y":{}}

# Primitives -> tagged variants
parser.parse('"hello"')               # -> {"hello":{}}
parser.parse('42')                    # -> {"42":{}}

# Arrays -> products with numeric labels
parser.parse('[1, 2, 3]')             # -> {"0":{"1":{}},"1":{"2":{}},"2":{"3":{}}}
```

## CLI Integration

Run k programs with input values:

```bash
# Command line value
kc run --expr "zero" '{"input": {}}'

# Read from JSON file  
kc run program.k --value-file data.json

# Read from stdin
echo '{"zero": {}}' | kc run --expr "{ {} zero }"

# Run k file with value
kc run examples/nat.k '{"succ": {"zero": {}}}'
```

## Examples

### Natural Numbers
```bash
# Zero
kc run --expr "zero" '{}'
# Input: {} -> K value: {}

# Successor of zero  
kc run --expr "{ {} succ }" '{"zero": {}}'
# Input: {"zero": {}} -> K value: {"succ": {"zero": {}}}
```

### Bit Values
```bash
# Bit 0
kc run --expr "{ {} 0 }" '{}'
# Input: {} -> K value: {"0": {}}

# Bit 1  
kc run --expr "{ {} 1 }" '{}'
# Input: {} -> K value: {"1": {}}
```

### Complex Data
```bash
# Person record
kc run --expr "{ name first, age second }" '{"name": "John", "age": 30}'
# Input: {"name": "John", "age": 30} 
# -> K value: {"first": {"John": {}}, "second": {"30": {}}}
```

The value parser maintains k's fundamental principle that there are no primitive scalar values - everything is either a product (record) or a variant (tagged union).

This enables the k compiler to process real-world JSON data while preserving the language's elegant algebraic type system.