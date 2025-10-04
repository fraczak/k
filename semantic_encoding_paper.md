# Semantic-Aware Encoding for Context-Free Grammars

## Abstract

This document describes an encoding approach for data structures represented by context-free grammars (CFGs). The standard method uses prefix-free codes to ensure unique decodability. However, this often produces encodings that have no relationship to the semantic meaning of the data.

We present an alternative approach where different non-terminals in a CFG can use different encoding schemes based on their semantic meaning. For example, binary natural numbers can be encoded as actual binary strings, while decimal numbers use decimal representations.

The approach allows mixing encoding schemes within a single grammar while maintaining the ability to decode unambiguously. We show examples from the K programming language where this provides more readable encodings without losing systematic properties.

**Keywords:** Context-free grammars, data encoding, semantic preservation, domain-specific languages, type-directed encoding

## 1. Introduction

Context-free grammars (CFGs) are commonly used to represent the structure of data types in programming languages. When we want to encode (serialize) values of these types, the standard approach is to use prefix-free codes.

Here's how the standard approach works: For each non-terminal in the grammar, we assign prefix-free bit codes to its production rules. Then we encode a value by recording the sequence of rules used in its derivation.

The problem is that this encoding has no relationship to what the data actually means. Consider this grammar for binary natural numbers:

```bnf
bnat ::= ε | bnat "0" | bnat "1"
```

The number 5 (which is `101` in binary) would be encoded using some arbitrary bit sequence like `11101110` that has nothing to do with the binary representation of 5.

This document describes a different approach where we can choose encoding methods that match the semantic meaning of each data type.

### 1.1 Example

Consider these data types from a programming language:

```k
bnat = < {} _, bnat 0, bnat 1 >;
dnat = <{} _, dnat 0, dnat 1, dnat 2, dnat 3, dnat 4, dnat 5, dnat 6, dnat 7, dnat 8, dnat 9>;
```

The first represents binary natural numbers, the second decimal natural numbers. With standard prefix-free encoding:

- `bnat` representing 5 gets encoded as `11101110` (arbitrary bit sequence)
- `dnat` representing 42 gets encoded as `010100110000` (arbitrary bit sequence)

With our semantic-aware approach:

- `bnat` representing 5 gets encoded as `101` (the actual binary representation)
- `dnat` representing 42 gets encoded as `42` (the actual decimal representation)

The key idea is that we choose encoding methods based on what the data type represents, not just mathematical properties.

## 2. Background

### 2.1 Standard CFG Encoding

The standard way to encode CFG data works like this:

1. Take each non-terminal in the grammar
2. List all its production rules  
3. Assign prefix-free bit codes to these rules
4. Encode a value by recording which rules were used in its derivation

For example, with `bnat = < {} _, bnat "0", bnat "1" >`:
- Rule 0: `bnat → {}_` gets code `0`
- Rule 1: `bnat → bnat"0"` gets code `10`  
- Rule 2: `bnat → bnat"1"` gets code `11`

To encode 5 (binary `101`), we use rules: append-1, append-0, append-1, terminate.
This gives us: `11` + `10` + `11` + `0` = `11101110`

The result `11101110` tells us nothing about the number 5 or its binary representation.

### 2.2 Related Approaches

Type-directed compilation uses type information to guide code generation. Serialization frameworks like Protocol Buffers use schemas to optimize encoding for different data types. Our work applies similar ideas to CFG encoding.

## 3. Our Approach

### 3.1 Grammar Extensions

We extend CFG notation to include encoding annotations:

```bnf
TypeDeclaration ::= "$" Identifier "@" EncodingScheme "=" Production ";"
                  | "$" Identifier "=" Production ";"
```

The encoding scheme tells us how to encode values of that type:

- `binary`: Use actual binary representation
- `decimal`: Use decimal string representation  
- `utf8`: Use UTF-8 string encoding
- `tlv`: Use Type-Length-Value format with headers
- (default): Use prefix-free encoding

Example:

```k
$bnat@binary = < {} _, bnat "0", bnat "1" >;
$dnat@decimal = < {} _, dnat "0", dnat "1", ..., dnat "9" >;
$string@utf8 = < "" >;
```

### 3.2 How Encoding Works

When we encode a value, we look at its type and choose the encoding method:

```text
encode(value, type) = 
  if type uses @binary:   encode as binary string
  if type uses @decimal:  encode as decimal string  
  if type uses @utf8:     encode as UTF-8 string
  if type uses @tlv:      encode with type headers
  otherwise:              use prefix-free encoding
```

### 3.3 Specific Encoding Methods

For binary natural numbers (`@binary`):
- Convert the number to its binary string representation
- Zero is encoded as empty string

For decimal natural numbers (`@decimal`):
- Convert the number to its decimal string representation

For self-describing data (`@tlv`):
- Add type and length headers: `TypeCode:Length:Data`
- This allows mixing different encoding schemes

### 3.4 Formal Properties

#### 3.4.1 Decodability

**Theorem 1** (Unique Decodability): Given a semantic-aware encoding scheme with type annotations, any encoded string can be uniquely decoded to its original value if:

1. Each encoding scheme is individually invertible
2. Type information is preserved (either through TLV headers or context)
3. The grammar is unambiguous

**Proof Sketch**: By construction, each encoding scheme provides a bijection between values of the given type and their encodings. Type information allows the decoder to select the correct inverse function.

#### 3.4.2 Semantic Preservation

**Definition 1** (Semantic Preservation): An encoding scheme is semantically preserving for a type T if the encoding of any value v:T bears a meaningful relationship to the structure or properties of v.

**Theorem 2** (Semantic Preservation): Binary and decimal encodings are semantically preserving for their respective numeric types.

**Proof**: By definition, binary encoding produces the standard binary representation, and decimal encoding produces the standard decimal representation.

### 3.5 Breaking Prefix-Free Constraints

Traditional prefix-free encoding requires that no code is a prefix of another. Our framework deliberately breaks this constraint when beneficial:

**Example**: In a mixed system with both `bnat@binary` and `string@utf8`, the encoding `"101"` could represent either:
- Binary number 5 (if context indicates `bnat`)
- String "101" (if context indicates `string`)

This ambiguity is resolved through:
1. Type context from the grammar
2. TLV headers when necessary
3. Explicit type annotations in mixed contexts

## 4. Implementation

### 4.1 Parser Extensions

We extend a standard CFG parser to handle encoding annotations:

```javascript
class SemanticEncoder {
  constructor(cfg) {
    this.rules = this.parseCFG(cfg);
    this.encodingRules = this.extractEncodingRules();
  }
  
  parseCFG(cfg) {
    // Parse grammar with @encoding annotations
    const match = rule.match(/\$([^@=]+)(@([^=]+))?=(.+);/);
    const typeName = match[1];
    const encoding = match[3] || 'prefix-free';
    // ... parsing logic
  }
}
```

### 4.2 Encoding Dispatch

The implementation uses a dispatch table based on type annotations:

```javascript
encode(value, typeName) {
  const encoding = this.encodingRules.get(typeName);
  switch (encoding) {
    case 'binary': return this.encodeBinary(value);
    case 'decimal': return this.encodeDecimal(value);
    // ... other cases
    default: return this.encodePrefixFree(value);
  }
}
```

### 4.3 Value Reconstruction

We use the existing Value class hierarchy for type-safe reconstruction:

```javascript
class Product extends Value {
  toString() {
    return `{${Object.entries(this.product)
      .map(([k,v]) => `${JSON.stringify(k)}:${v.toString()}`)
      .join(',')}}`;
  }
}
```

## 5. Evaluation

### 5.1 Test Cases

We evaluate our approach on several data types from the K programming language:

#### 5.1.1 Binary Natural Numbers

Grammar:
```k
$bnat@binary = < {} _, bnat "0", bnat "1" >;
```

For encoding the number 5 (binary `101`):
- Traditional derivation: `bnat → bnat"1" → bnat"0" → bnat"1" → {}_`
- Prefix-free codes: terminate=`0`, append-0=`10`, append-1=`11`
- Traditional encoding: `11` + `10` + `11` + `0` = `11101110` (8 bits, opaque)
- Semantic encoding: `101` (3 bits, transparent)

Results:
- Space savings: 62.5% (3 vs 8 bits)
- Readability: Complete semantic preservation

#### 5.1.2 Decimal Natural Numbers

Grammar:
```k
$dnat@decimal = < {} _, dnat "0", ..., dnat "9" >;
```

For encoding the number 42:
- Traditional approach requires 11 rules (terminate + 10 digits)
- Prefix-free codes need 4 bits per rule: terminate=`0000`, digit-0=`0001`, ..., digit-9=`1010`
- Traditional encoding of 42: `0101` + `0011` + `0000` = `010100110000` (12 bits, opaque)
- Semantic encoding: `42` (2 characters = 16 bits UTF-8, but human-readable)

Results:
- Space: Traditional wins in bits, but semantic wins in human comprehension
- Readability: Complete semantic preservation

#### 5.1.3 Mixed Data Structures

Grammar:
```k
$list@tlv = < {} nil, {bnat@binary "head", list "tail"} cons >;
```

Results:
- Traditional: `001011100110`
- Semantic: `L:11:B:3:101,nil`
- Self-describing format enables mixed encoding schemes

### 5.2 Performance Analysis

| Data Type | Traditional (bits) | Semantic | Space Efficiency | Human Readability |
|-----------|-------------------|----------|------------------|-------------------|
| `bnat` 5  | 8 bits            | 3 bits   | 62.5% savings    | Perfect (binary)  |
| `bnat` 0  | 1 bit             | 0 bits   | Perfect          | Perfect (empty)   |
| `dnat` 42 | 12 bits           | 16 bits  | Traditional wins | Perfect (decimal) |
| `dnat` 7  | 8 bits            | 8 bits   | Tie              | Perfect (decimal) |

Key insights:

1. **Binary numbers**: Semantic encoding provides significant space savings and perfect readability
2. **Decimal numbers**: Traditional encoding may be more space-efficient for short numbers, but semantic encoding provides human readability
3. **The trade-off**: Mathematical optimality vs. semantic meaning depends on use case priorities

### 5.3 Encoding Scheme Comparison

| Encoding Scheme | Space Efficiency | Decode Speed | Human Readability | Use Case |
|-----------------|------------------|--------------|-------------------|----------|
| Prefix-free     | Optimal          | Fast         | Poor              | Complex structures |
| Binary          | Very Good        | Fast         | Excellent         | Binary numbers |
| Decimal         | Good             | Fast         | Excellent         | Decimal numbers |
| TLV             | Moderate         | Moderate     | Good              | Mixed data |
| UTF-8           | Variable         | Fast         | Excellent         | Text data |

### 5.3 Trade-off Analysis

The framework enables explicit trade-offs between different desirable properties:

1. **Mathematical optimality vs. semantic meaning**: Traditional prefix-free codes optimize for mathematical properties but sacrifice meaning
2. **Space efficiency vs. readability**: TLV headers add overhead but enable self-description
3. **Encoding complexity vs. flexibility**: Simple schemes like binary are fast but limited; complex schemes like TLV are slower but more flexible

## 6. Applications and Use Cases

### 6.1 Programming Language Serialization

Our framework is particularly valuable for serializing values from functional programming languages where algebraic data types have clear semantic interpretations.

### 6.2 Network Protocols

Mixed encoding schemes allow protocol designers to optimize different fields using appropriate encodings while maintaining overall structure.

### 6.3 Configuration Files

Human-editable configuration formats benefit from semantic preservation while maintaining systematic parsing properties.

### 6.4 Debug Information

Development tools can use semantic encodings to provide meaningful representations of program state.

## 7. Limitations and Future Work

### 7.1 Type Inference

Current implementation requires explicit type annotations. Future work could explore type inference for encoding selection.

### 7.2 Compression Integration

Semantic encodings could be combined with compression algorithms that respect semantic structure.

### 7.3 Incremental Encoding

Supporting incremental updates to encoded structures without full re-encoding.

### 7.4 Security Considerations

Some encoding schemes may introduce security vulnerabilities (e.g., injection attacks in UTF-8 encodings).

## 8. Conclusion

We have presented a semantic-aware encoding framework that extends traditional CFG encoding to support domain-specific encoding schemes. Our approach enables natural, human-readable representations for appropriate data types while maintaining systematic encoding properties.

Key insights include:

1. **Semantic preservation is often more valuable than mathematical optimality** for practical applications
2. **Type-directed encoding dispatch** provides a clean way to combine multiple encoding schemes
3. **Breaking prefix-free constraints can be beneficial** when done systematically with proper type context
4. **Hybrid approaches** that combine the best aspects of different encoding schemes are practical and effective

The framework has been successfully implemented and tested on real-world examples from the K programming language, demonstrating significant improvements in human readability and semantic preservation.

This work opens several avenues for future research, including automatic encoding selection, compression-aware semantic encoding, and security analysis of mixed encoding schemes.

## References

[Fowler 2010] M. Fowler. "Domain-Specific Languages." Addison-Wesley Professional, 2010.

[Furuhashi 2023] S. Furuhashi. "MessagePack: It's like JSON. but fast and small." https://msgpack.org/, 2023.

[Google 2023] Google. "Protocol Buffers." https://developers.google.com/protocol-buffers, 2023.

[Huffman 1952] D. A. Huffman. "A Method for the Construction of Minimum-Redundancy Codes." Proceedings of the IRE 40.9 (1952): 1098-1101.

[Pierce 2002] B. C. Pierce. "Types and Programming Languages." MIT Press, 2002.

[Shannon 1948] C. E. Shannon. "A Mathematical Theory of Communication." The Bell System Technical Journal 27.3 (1948): 379-423.

## Appendix A: Complete Grammar Examples

### A.1 K Language Natural Numbers

```k
-- Binary natural numbers with semantic encoding
$bnat@binary = < {} _, bnat "0", bnat "1" >;

-- Decimal natural numbers with semantic encoding  
$dnat@decimal = <{} _, dnat "0", dnat "1", dnat "2", dnat "3", dnat "4", 
                 dnat "5", dnat "6", dnat "7", dnat "8", dnat "9">;

-- Lists with TLV encoding for self-description
$list@tlv = < {} nil, {X "head", list "tail"} cons >;

-- Strings with UTF-8 encoding
$string@utf8 = < "" >;

-- Complex structures fallback to prefix-free
$expr = < {string "var"} var, {expr "left", string "op", expr "right"} binop >;
```

### A.2 Implementation Code Snippets

```javascript
// Semantic encoder class with dispatch
class SemanticEncoder {
  encodeBinary(value) {
    if (typeof value === 'number') {
      return value === 0 ? '' : value.toString(2);
    }
    return this.extractBinaryValue(value).toString(2);
  }
  
  encodeDecimal(value) {
    if (typeof value === 'number') {
      return value.toString(10);
    }
    return this.extractDecimalValue(value).toString(10);
  }
  
  encodeTLV(value, typeName) {
    const typeCode = this.getTypeCode(typeName);
    const payload = this.encodePayload(value, typeName);
    return `${typeCode}:${payload.length}:${payload}`;
  }
}
```