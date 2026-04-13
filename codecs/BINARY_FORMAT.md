# K Binary Interchange Format Specification

## Overview

The binary format for k values consists of two parts:
1. **Type header**: Identifies the canonical type of the value
2. **Value payload**: DAG representation following canonical serialization (Chapter 14)

## Format Structure

```
┌─────────────────┬────────────────────────────────┐
│  Type Header    │     Value Payload              │
│  (variable)     │     (variable)                 │
└─────────────────┴────────────────────────────────┘
```

### Type Header

The type is identified by its **canonical name** (content-addressed hash), which is a base58-encoded SHA-256 hash prefixed with `@`.

**Format Options:**

**Option A: Length-prefixed ASCII**
```
[1 byte: length N][N bytes: ASCII type hash including '@']
```
Example: `\x2d@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c`

**Option B: Fixed 32-byte hash**
```
[32 bytes: raw SHA-256 hash]
```
No '@' prefix, no base58 encoding - pure binary.

**Option C: No header (rely on context)**
```
[Value payload only]
```
The decoder must know the expected type from context.

**Decision: Option B** - Fixed 32-byte raw hash
- Predictable size (easier to parse)
- Compact (no encoding overhead)
- Fast to validate (direct hash comparison)

### Value Payload (Canonical Serialization)

Following Chapter 14, the value is encoded as a bit sequence where:

1. **Product nodes** emit no tag bits; children are encoded in canonical field order
2. **Union nodes** emit a fixed-width tag (⌈log₂(n)⌉ bits for n variants), then the child
3. **Unit** (empty product) emits nothing
4. **Empty union** cannot be encoded

The bit sequence is packed into bytes (LSB first, padding with 0s to byte boundary).

### Complete Format

```
┌──────────────────┬────────────────────────────────┐
│  32 bytes        │     Variable length            │
│  Type Hash       │     Canonical payload          │
│  (SHA-256)       │     (bit-packed)               │
└──────────────────┴────────────────────────────────┘
```

## Examples

### Example 1: Unit type `{}`

Type: `$unit = {}`
Canonical name: `@KL...` (hash computed by compiler)

Binary:
```
[32 bytes: hash of $unit]
[]  (empty payload - unit has no children)
```

### Example 2: Boolean

Type: `$bool = < {} false, {} true >`
Value: `{true {}}`

Canonical form assigns indices: false=0 (binary: 0), true=1 (binary: 1)

Binary:
```
[32 bytes: hash of $bool]
[1 bit: 1]  // variant index for "true"
[padding to byte boundary]
→ 0x80 (1 followed by 7 zeros)
```

### Example 3: Natural number

Type: `$nat = < {} zero, {nat succ} >`
Value: `{{{{} zero} succ} succ}` (represents 2)

Variant indices: zero=0 (binary: 0), succ=1 (binary: 1)

Binary:
```
[32 bytes: hash of $nat]
[1 bit: 1]  // succ
[1 bit: 1]  // succ  
[1 bit: 0]  // zero
[padding: 00000]
→ 0xC0 (11000000)
```

## Implementation Requirements

### Encoder Interface

```javascript
/**
 * Encode a k value to binary format
 * @param {Object} value - k value (Product/Variant from Value.mjs)
 * @param {string} typeName - Canonical type name (e.g., "@ABC123...")
 * @param {Object} typeDef - Type definition from compiler
 * @returns {Buffer} Binary representation
 */
function encode(value, typeName, typeDef);
```

### Decoder Interface

```javascript
/**
 * Decode a k value from binary format
 * @param {Buffer} buffer - Binary data
 * @returns {Object} {typeName: string, value: Value}
 */
function decode(buffer);
```

## Validation

The decoder MUST:
1. Read the 32-byte type hash
2. Verify the hash is known/valid (optional, but recommended)
3. Parse the payload according to the type's canonical structure
4. Fail if the bit sequence doesn't match the type's automaton

## Extension: Streaming Format

For streaming multiple values:

```
┌─────────────┬──────────┬─────────────┬──────────┬───
│  32B hash   │  payload │  32B hash   │  payload │ ...
└─────────────┴──────────┴─────────────┴──────────┴───
```

Each value is independently parseable.
