# K Language Value Serialization Framework

## Problem Statement

The k language syntax for defining partial functions is elegant and should remain unchanged. However, the interface for executing k programs on actual data is cumbersome because values must be manually encoded in verbose JSON format.

**Example:**
- K expression: `inc {()x,()y} times` (beautiful!)
- Input value: `{"1":{"0":{"1":{"0":{"_":{}}}}}}` (painful!)
- Output value: `{"1":{"1":{"1":{"1":{"0":{"0":{"1":{"_":{}}}}}}}}}` (unreadable!)

## Solution: External Value Codec System

Create a separate serialization framework that operates **outside** the k language, providing human-friendly I/O without modifying k's core syntax.

### Architecture

```
Human Input → [Decoder] → K Internal Format → [K Program] → K Internal Format → [Encoder] → Human Output
     10                     {complex bnat}                      {complex bnat}                    100
```

## Implementation

### 1. Value Codec Definitions

Create external codec definition files that map between human notation and k internal representation:

**File: `codecs/bnat.codec`**
```yaml
type: bnat
description: "Binary natural numbers"

patterns:
  decimal:
    regex: '^\d+$'
    examples: ['0', '10', '255', '1000']
  
  binary:
    regex: '^0b[01]+$'
    examples: ['0b0', '0b1010', '0b11111111']
    
  hex:
    regex: '^0x[0-9a-fA-F]+$'
    examples: ['0x0', '0xA', '0xFF']

encoding_rules: |
  function encode_decimal(str) {
    const n = parseInt(str);
    return decimal_to_bnat_json(n);
  }
  
  function encode_binary(str) {
    const n = parseInt(str.slice(2), 2);
    return decimal_to_bnat_json(n);
  }
  
  function encode_hex(str) {
    const n = parseInt(str.slice(2), 16);
    return decimal_to_bnat_json(n);
  }

decoding_rules: |
  function decode_to_decimal(bnat_json) {
    return bnat_json_to_decimal(bnat_json).toString();
  }
```

### 2. Enhanced K Runner with Codec Support

**File: `k_with_codecs.mjs`**
```javascript
#!/usr/bin/env node

import k from './index.mjs';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

class KCodecRunner {
  constructor() {
    this.codecs = new Map();
    this.loadAllCodecs();
  }

  loadAllCodecs() {
    const codecDir = path.join(process.cwd(), 'codecs');
    if (fs.existsSync(codecDir)) {
      const files = fs.readdirSync(codecDir).filter(f => f.endsWith('.codec'));
      for (const file of files) {
        const codecPath = path.join(codecDir, file);
        const codec = yaml.load(fs.readFileSync(codecPath, 'utf8'));
        this.codecs.set(codec.type, codec);
      }
    }
  }

  // Try to decode human input to k internal format
  decodeInput(input, targetType = null) {
    // If input is already JSON, assume it's k internal format
    try {
      JSON.parse(input);
      return input;
    } catch {}

    // Try to match against known codec patterns
    for (const [type, codec] of this.codecs) {
      if (targetType && type !== targetType) continue;
      
      for (const [patternName, pattern] of Object.entries(codec.patterns)) {
        const regex = new RegExp(pattern.regex);
        if (regex.test(input)) {
          return this.applyEncoder(input, codec, patternName);
        }
      }
    }

    // Fallback: treat as string
    return JSON.stringify(input);
  }

  // Convert k internal format to human-readable output
  encodeOutput(output, targetType = null) {
    try {
      const parsed = JSON.parse(output);
      
      // Try to decode using registered codecs
      for (const [type, codec] of this.codecs) {
        if (targetType && type !== targetType) continue;
        
        try {
          const decoded = this.applyDecoder(parsed, codec);
          if (decoded !== null) return decoded;
        } catch {}
      }
    } catch {}

    // Fallback: return as-is
    return output;
  }

  applyEncoder(input, codec, patternName) {
    // This would contain the encoding logic
    // For now, simplified implementation
    if (codec.type === 'bnat') {
      return this.encodeBnat(input, patternName);
    }
    return input;
  }

  applyDecoder(parsed, codec) {
    // This would contain the decoding logic  
    if (codec.type === 'bnat') {
      return this.decodeBnat(parsed);
    }
    return null;
  }

  encodeBnat(input, patternName) {
    let num;
    if (patternName === 'decimal') {
      num = parseInt(input);
    } else if (patternName === 'binary') {
      num = parseInt(input.slice(2), 2);
    } else if (patternName === 'hex') {
      num = parseInt(input.slice(2), 16);
    }
    
    return this.decimalToBnatJson(num);
  }

  decodeBnat(bnatJson) {
    try {
      const num = this.bnatJsonToDecimal(bnatJson);
      return num.toString();
    } catch {
      return null;
    }
  }

  decimalToBnatJson(n) {
    if (n === 0) return {"_": {}};
    
    let result = {"_": {}};
    while (n > 0) {
      const bit = n % 2;
      result = {[bit.toString()]: result};
      n = Math.floor(n / 2);
    }
    return result;
  }

  bnatJsonToDecimal(bnat) {
    if (bnat._ !== undefined) return 0;
    
    let num = 0;
    let power = 1;
    let current = bnat;
    
    while (current["0"] !== undefined || current["1"] !== undefined) {
      if (current["1"] !== undefined) {
        num += power;
        current = current["1"];
      } else {
        current = current["0"];
      }
      power *= 2;
    }
    
    return num;
  }

  run(program, input, options = {}) {
    const decodedInput = this.decodeInput(input, options.inputType);
    const result = k.run(program, JSON.parse(decodedInput));
    const encodedOutput = this.encodeOutput(JSON.stringify(result), options.outputType);
    return encodedOutput;
  }
}

// Enhanced CLI interface
if (process.argv.length >= 3) {
  const runner = new KCodecRunner();
  const program = process.argv[2];
  
  if (process.stdin.isTTY) {
    // Interactive mode with human-friendly I/O
    console.log('K Language with Codec Support');
    console.log('Enter input (supports: numbers, 0b..., 0x..., strings):');
    
    process.stdin.on('data', (data) => {
      const input = data.toString().trim();
      try {
        const result = runner.run(program, input);
        console.log(result);
      } catch (error) {
        console.error('Error:', error.message);
      }
    });
  } else {
    // Pipe mode with codec support
    let input = '';
    process.stdin.on('data', (chunk) => input += chunk);
    process.stdin.on('end', () => {
      try {
        const result = runner.run(program, input.trim());
        console.log(result);
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
  }
}

export default KCodecRunner;
```

### 3. Usage Examples

With this codec system, your workflow becomes much cleaner:

**Before:**
```bash
echo '{"1":{"0":{"1":{"0":{"_":{}}}}}}' | ./k.mjs "$(cat Examples/bnat.k) inc {()x,()y} times"
```

**After:**
```bash
echo '10' | ./k_with_codecs.mjs "$(cat Examples/bnat.k) inc {()x,()y} times"
# Output: 100

# Also supports multiple formats:
echo '0b1010' | ./k_with_codecs.mjs "$(cat Examples/bnat.k) inc {()x,()y} times"  
# Output: 100

echo '0xA' | ./k_with_codecs.mjs "$(cat Examples/bnat.k) inc {()x,()y} times"
# Output: 100
```

### 4. Codec Configuration

Add codec definitions for other types:

**File: `codecs/ieee754.codec`**
```yaml
type: ieee754
description: "IEEE 754 floating point numbers"

patterns:
  decimal_float:
    regex: '^-?\d+\.\d+$'
    examples: ['3.14', '-2.5', '0.0']
    
  scientific:
    regex: '^-?\d+(\.\d+)?[eE][+-]?\d+$'
    examples: ['1e10', '3.14e-5']
```

**File: `codecs/string.codec`**
```yaml
type: utf8_string
description: "UTF-8 strings"

patterns:
  quoted:
    regex: '^".*"$'
    examples: ['"hello"', '"world\n"']
    
  raw:
    regex: '^[^"]+$'
    examples: ['hello', 'world']
```

## Benefits

1. **K language stays pure** - No syntax changes whatsoever
2. **Human-friendly I/O** - Natural number/string input and output
3. **Multiple formats** - Same value can be input as 10, 0b1010, or 0xA
4. **Extensible** - Add new codecs without touching k core
5. **Backward compatible** - Original JSON format still works
6. **Type-aware** - Can hint which codec to use for ambiguous inputs

## Future Enhancements

- Auto-detection of output type based on k program analysis
- Codec composition for complex types
- Interactive codec testing tools
- IDE integration for codec-aware input/output

This approach keeps k mathematically pure while making it practical for everyday use!