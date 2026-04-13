# K Binary Codecs

This directory contains the binary codec system for k-language values, enabling efficient serialization/deserialization and interoperability through a canonical binary format.

## Architecture Overview

The k codec system follows a **pipes and filters** architecture:

```
TEXT → parse.mjs → BINARY → compiled-k-program → BINARY → print.mjs → TEXT
```

### Components

1. **Binary Interchange Format** (`BINARY_FORMAT.md`): Specification for the canonical binary representation
2. **Runtime Codec** (`runtime/codec.mjs`): Core encoder/decoder implementing Chapter 14 canonical serialization
3. **Format-Specific Codecs** (future): UTF-8, IEEE 754, JSON, etc.

## Binary Format

Every binary value has the structure:

```
[32-byte type hash][canonical payload]
```

### Type Hash

- SHA-256 hash of the canonical type definition
- Encoded in base56 (alphabet: `23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz`)
- Prefixed with `@` in text form (e.g., `@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c`)

### Canonical Payload

Bit-packed representation following these rules:

- **Products**: Emit no tag bits, just fields in sorted label order
- **Unions**: Emit ⌈log₂(n)⌉ bits for variant tag (where n = number of variants), then payload
- **Bits**: Packed MSB-first into bytes, LSB first in tag value representation

### Examples

**Unit type** `{}`
```
32 bytes: type hash only
0 bytes: payload (empty product)
```

**Bool type** `<{} false, {} true>` with value `false`
```
32 bytes: type hash  
1 byte:   0x00 (tag bit = 0, MSB of first byte)
```

**Bool type** with value `true`
```
32 bytes: type hash
1 byte:   0x80 (tag bit = 1, MSB of first byte)
```

## Usage

### Encoding

```javascript
import { encode } from './runtime/codec.mjs';
import { Product, Variant } from '../Value.mjs';

// Define types
const types = {
  '@NiDZ...': { code: 'product', product: {} },  // unit
  '@QeR4...': { code: 'union', union: { false: '@NiDZ...', true: '@NiDZ...' } }  // bool
};

function resolveType(name) {
  return types[name];
}

// Create value
const value = new Variant('true', new Product({}));

// Encode
const buffer = encode(
  value,                    // k value
  '@QeR4...',              // type name
  types['@QeR4...'],       // type definition
  resolveType              // type resolver
);
```

### Decoding

```javascript
import { decode } from './runtime/codec.mjs';

// Decode
const { typeName, value } = decode(buffer, resolveType);

console.log(typeName);  // '@QeR4...'
console.log(value);     // Variant { tag: 'true', value: Product { product: {} } }
```

## Type Resolution

The codec system requires a type resolver function to handle type references:

```javascript
function resolveType(typeName) {
  // Look up type definition by canonical name
  // Can query registry, read from disk, etc.
  return typeDefinition;
}
```

Type definitions follow the structure:

```javascript
// Product type: {fieldType1 label1, fieldType2 label2, ...}
{
  code: 'product',
  product: {
    label1: '@typeHash1',
    label2: '@typeHash2',
    // ...
  }
}

// Union type: <variantType1 tag1, variantType2 tag2, ...>
{
  code: 'union',
  union: {
    tag1: '@typeHash1',
    tag2: '@typeHash2',
    // ...
  }
}

// Reference type (resolved during encoding/decoding)
{
  code: 'ref',
  ref: '@typeHash'
}
```

## Testing

Run the codec tests:

```bash
node runtime/test-codec.mjs
```

Expected output shows encoding/decoding of unit and bool values with correct binary representations.

## Future Work

### Format-Specific Codecs

Define codecs for common types:

- **$unicode**: UTF-8 ↔ Unicode codepoint lists
- **$ieee**: IEEE 754 double ↔ binary64
- **$ieees**: List of doubles
- **$utf8s**: UTF-8 string ↔ Unicode lists

### Codec Metadata

Each codec should include `codec.json`:

```json
{
  "name": "utf8",
  "version": "1.0.0",
  "inputType": "@...",     // canonical type name for input
  "outputType": "@...",    // canonical type name for output
  "parser": "./parse.mjs",
  "printer": "./print.mjs"
}
```

### Registry Integration

Codecs should query a type registry to resolve canonical names:

```bash
# Parser reads text, writes binary
echo "Hello" | ./utf8/parse.mjs > /tmp/value.bin

# Program reads/writes binary
cat /tmp/value.bin | ./my-program > /tmp/output.bin

# Printer reads binary, writes text
cat /tmp/output.bin | ./utf8/print.mjs
```

## References

- Binary format spec: `BINARY_FORMAT.md`
- Chapter 14 (canonical serialization): `../DOCS/book/14-canonical-serialization.md`
- Hash implementation: `../hash.mjs`
- Type system: `../codes.mjs`
- Value representation: `../Value.mjs`
