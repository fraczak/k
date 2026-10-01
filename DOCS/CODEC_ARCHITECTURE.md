# Reusable Codec Architecture

## 1. Overview & Objectives

In **k**, a **codec** is a two-way translator between external domain data (e.g. decimal integers, JSON, UTF-8 text, IEEE 754 floats) and **k**'s typed algebraic values (`Value` trees paired with closed pattern graphs).

Every codec in the **k** ecosystem is designed to serve three unified objectives from a single module definition:

1. **Document the Codec**: Formally specify the external syntax and its semantics as a **k** algebraic type/pattern.
2. **REPL Module**: Provide interactive input parsing (`:input <codec.mjs>`) and multi-codec output inspection (`<codec.mjs>: <formatted>`) in both Node.js and browser REPLs.
3. **Standalone Shell Executable**: Function as a first-class Unix filter (`--parse`, `--print`, `--help`) for composition in command-line pipelines.

```text
                     +---------------------------------------+
                     |          External Domain Data         |
                     |  (JSON, Decimals, UTF-8, IEEE floats) |
                     +---------------------------------------+
                                    |         ^
                       parse(text)  |         |  print(value)
                                    v         |
                     +---------------------------------------+
                     |               k Codec                 |
                     |  (Syntax Spec + K Semantic Patterns)  |
                     +---------------------------------------+
                         |                               ^
        CLI: --parse     |                               | CLI: --print
        REPL: :input     v                               | REPL: eval output
                     +---------------------------------------+
                     |           Enveloped k Value           |
                     |     (pattern graph P, value tree v)   |
                     |        Binary Wire Stream (P, v)      |
                     +---------------------------------------+
```

---

## 2. Objective 1: Documentation & Specification

Every codec must clearly define **what external text it accepts** and **how that text maps to k algebraic values**.

### 2.1 External Syntax
The syntax specification defines the valid textual forms accepted by the codec:
- **Grammar & Lexical Rules**: e.g., decimal integer `[-+]?[0-9]+` or JSON RFC 8259.
- **Normalization**: e.g., trimming whitespace, casing, escaping.
- **Rejection Criteria**: Explicit error messages when invalid syntax is encountered (e.g. `"expected decimal integer, got 'abc'"`).

### 2.2 Semantics as a k Value
The semantic specification maps the external syntax to a **k** algebraic type equation ($T$) composed of:
- **Products (`{...}`)**: Record fields, fixed-width bit chunks, structs.
- **Variants (`<...>`)**: Tagged choices, boolean flags, constructors, nullability.
- **Recursive Equations**: Linked lists, Peano numerals, tree nodes.

#### Concrete Examples:

1. **`int.mjs` (Integer & List Codec)**:
   - *k Type Equations*:
     ```k
     $ bits = < {} _, bits 0, bits 1 >;
     $ int  = < bits '+', bits '-' >;
     $ list = < {} nil, {int car, list cdr} cons >;
     ```
   - *Semantics*: Numbers are stored sign-first, followed by binary bits in MSB-outermost order with leading zeros stripped. Lists are Peano-style `cons`/`nil` pairs.

2. **`utf8.mjs` (UTF-8 String Codec)**:
   - *k Type Equations*: Defined by the canonical string representation in `core.k`, mapping unicode code points across ASCII, BMP, and supplementary planes to structured bit products.

3. **`json.mjs` (JSON Codec)**:
   - *k Type Equations*:
     - Objects $\to$ Products `{ key1 val1, key2 val2 }`.
     - Arrays $\to$ Peano lists `< {} nil, {any car, list cdr} cons >`.
     - Booleans $\to$ `< {} false, {} true >`.
     - Null $\to$ `< {} null >`.
     - Numbers $\to$ IEEE 754 float64 products `{ sign, exponent, fraction }`.
     - Strings $\to$ Canonical `core.k` string values.

### 2.3 Self-Documenting Metadata Contract
A codec module exports structured metadata alongside its functions:
```javascript
export const name = "int.mjs";
export const summary = "Decimal integers and integer lists";
export const syntax = "Decimal number (e.g. 42, -15) or list ([0, 1, 2])";
export const kType = "$ int = < bits '+', bits '-' >; $ list = < {} nil, {int car, list cdr} cons >; ";
export const examples = [
  { text: "42", k: "{}|_|0|1|0|1|0|1|+" },
  { text: "-7", k: "{}|_|1|1|1|-" },
  { text: "[0, 1]", k: "{...} cons" }
];
```

This metadata is consumed:
- By `--help` on the command line.
- By `:codec doc <name>` or `:help <name>` in the REPL.
- By GUI inspectors in the Web Studio.

---

## 3. Objective 2: REPL Module Interface

In the REPL, codecs are loaded dynamically on demand:
```text
> :codec load int.mjs
loaded codec int.mjs
```

### 3.1 Module Exports
A valid codec module exports:

| Export | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Identifier matching the file basename (e.g. `"int.mjs"`). |
| `parse` | `(text: string, context?: CodecContext) => Value` | **Yes** | Parses external text into an enveloped `Value`. Throws on syntax error. |
| `print` | `(value: Value, context?: CodecContext) => string` | **Yes** | Formats an enveloped `Value` into text. Throws if value is not representable. |
| `patterns` | `PatternGraph[]` | Optional | Closed pattern graphs natively produced or accepted by the codec. |
| `summary` | `string` | Optional | One-line description for `:codec list` and CLI help. |
| `syntax` | `string` | Optional | Description of accepted syntax. |
| `examples` | `Array<{text, k}>` | Optional | Sample text and corresponding k values. |

### 3.2 REPL Input Protocol
The user explicitly specifies the codec to parse an input payload:
- **Interactive Mode**:
  ```text
  > :input int.mjs
  int.mjs> 42
  {}|_|0|1|0|1|0|1|+ ?<{} _, ...>
  int.mjs: 42
  ```
- **One-Line Mode**:
  ```text
  > :input int.mjs 42
  {}|_|0|1|0|1|0|1|+ ?<{} _, ...>
  int.mjs: 42
  ```

### 3.3 REPL Output Protocol (Multi-Codec Inspection)
Whenever any evaluation produces a resulting **k** `Value`:
1. The primary representation is always the standard **k** value envelope (`{}|_|0|1|+ ?<...>`).
2. The REPL iterates over **all loaded codecs** and attempts `codec.print(value)`.
3. If `codec.print(value)` succeeds, the REPL appends `<codecName>: <formattedString>`.
4. If `codec.print(value)` throws, the codec is silently ignored for that value (it does not match the format).

---

## 4. Objective 3: Standalone Shell Executable Contract

Every codec file must be directly executable from the command line:
```bash
chmod +x codecs/int.mjs
```

### 4.1 CLI Invocations

#### 1. Parse Mode (`--parse`)
Reads text from `stdin`, parses it, encodes it to the binary wire format with `encodeToWire`, and writes binary bytes to `stdout`:
```bash
printf "42\n" | ./codecs/int.mjs --parse > val.wire
```
- **Stdout**: Strict binary stream `(pattern, value)`. Diagnostics and warnings must go to `stderr`.
- **Exit Code**: `0` on success; `1` on parse error (with error message on `stderr`).

#### 2. Print Mode (`--print`)
Reads binary wire bytes from `stdin`, decodes them with `decodeWire`, calls `print(value)`, and writes formatted text to `stdout`:
```bash
cat val.wire | ./codecs/int.mjs --print
# Output: 42
```
- **Stdout**: Formatted external text, followed by newline.
- **Exit Code**: `0` on success; `1` if the value is not representable under this codec.

#### 3. Help Mode (`-h`, `--help`)
Outputs formatted CLI usage and documentation:
```text
Usage: k-int --parse | --print

Decimal integers and integer lists.

Options:
  --parse      Read external text from stdin, write binary pattern+value stream to stdout.
  --print      Read binary pattern+value stream from stdin, write external text to stdout.
  -h, --help   Show this help message.

Syntax:
  Decimal number (e.g. 42, -15) or list ([0, 1, 2])

k Types:
  $ int = < bits '+', bits '-' >;
  $ list = < {} nil, {int car, list cdr} cons >;
```

### 4.2 Pipeline Composition Examples
Codecs chain seamlessly with `k.mjs` and standard Unix tools:
```bash
# 1. Decimal arithmetic pipeline
echo "41" | ./codecs/int.mjs --parse | ./k.mjs '{()x, 1 int y} plus' | ./codecs/int.mjs --print
# Output: 42

# 2. JSON data transformation pipeline
cat request.json | ./codecs/json.mjs --parse | ./k.mjs transform.k | ./codecs/json.mjs --print

# 3. Format conversion: JSON to Decimal
echo '{"count": 100}' | ./codecs/json.mjs --parse | ./k.mjs '.count' | ./codecs/int.mjs --print
# Output: 100
```

---

## 5. Implementation: The Codec SDK & Standard Runner

### 5.1 The Anti-Pattern (Current State)
Currently, codec files duplicate ~50 lines of stream reading and argument parsing, and import deep, private compiler modules:
```javascript
// AVOID: Tight coupling to private compiler paths
import { stdin, stdout, argv, exit } from "node:process";
import { Value } from "../Value.mjs";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";
// ... 40 lines of readAll(stdin) and main() boilerplate in every single codec ...
```

### 5.2 The Solution: Single Public SDK (`codec-sdk.mjs`)
We establish a clean, single-point entry module: `codec-sdk.mjs` (or `@fraczak/k/codec`).

The SDK provides:
1. **Structural Value Constructors**: `Value`, `isProduct`, `isVariant`.
2. **Wire Encoders / Decoders**: `encodeToWire`, `decodeWire`.
3. **CLI Runner**: `runCodecCLI(metaUrl, codecDefinition)`.

### 5.3 The Canonical Codec Definition Template
With the SDK, any codec (built-in or third-party) is defined cleanly in a single file:

```javascript
#!/usr/bin/env node
import { Value, isProduct, isVariant, runCodecCLI } from "./runtime/codec-sdk.mjs";

// --- 1. Documentation & Metadata ---
export const name = "int.mjs";
export const summary = "Decimal integers and integer lists";
export const syntax = "Decimal integer (-42, 100) or list ([0, 1, 2])";
export const kType = "$ int = < bits '+', bits '-' >; $ list = < {} nil, {int car, list cdr} cons >;";

const INT_PATTERN = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];
export const patterns = [INT_PATTERN];

// --- 2. REPL & Domain Logic ---
export function parse(text) {
  const trimmed = text.trim();
  // ... pure parsing logic producing Value ...
  return Value.variant("+", ...);
}

export function print(value) {
  // ... pure formatting logic from Value ...
  return "42";
}

// --- 3. Standalone CLI Harness ---
runCodecCLI(import.meta.url, {
  name,
  summary,
  syntax,
  kType,
  patterns,
  parse,
  print
});
```

### 5.4 How `runCodecCLI` Unifies Shell and REPL

```javascript
export function runCodecCLI(metaUrl, codec) {
  // 1. In browser environments: no-op (REPL uses exported parse/print directly)
  if (typeof process === "undefined" || !process.argv) return;

  // 2. When imported as a module by the Node REPL: no-op
  if (!isMainEntrypoint(metaUrl, process.argv[1])) return;

  // 3. When executed directly in a shell pipe:
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    printHelp(codec);
    process.exit(0);
  }

  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    printUsage(codec);
    process.exit(1);
  }

  readAll(process.stdin).then((buf) => {
    if (args[0] === "--parse") {
      const value = codec.parse(buf.toString("utf8"));
      process.stdout.write(encodeToWire(value, codec.patterns?.[0] || value.pattern));
    } else {
      const { value } = decodeWire(buf);
      process.stdout.write(`${codec.print(value)}\n`);
    }
  }).catch((err) => {
    process.stderr.write(`${codec.name}: ${err.message || String(err)}\n`);
    process.exit(1);
  });
}
```

---

## 6. Directory Layout Reorganization

To make `./codecs/` intuitive and cleanly structured, the directory is organized into:

```text
codecs/
├── README.md                      # Index of available codecs and conventions
│
├── Standalone Codec Modules (Directly executable & REPL-loadable)
│   ├── int.mjs                    # Integer & list codec (single file)
│   ├── json.mjs                   # JSON codec (single file)
│   ├── utf8.mjs                   # UTF-8 string codec (single file)
│   ├── utf16.mjs                  # UTF-16 string codec (single file)
│   ├── ieee.mjs                   # IEEE 754 float codec (single file)
│   └── unit.mjs                   # Unit {} codec (single file)
│
├── Pipeline Utility Tools
│   ├── k-parse.mjs                # Textual k value {...} -> binary wire stream
│   ├── k-print.mjs                # Binary wire stream -> textual k value
│   └── show.mjs                   # Wire stream pass-through inspector
│
└── runtime/ (Shared Codec Infrastructure)
    ├── codec-sdk.mjs              # Public SDK: runCodecCLI, Value, encodeToWire, decodeWire
    ├── prefix-codec.mjs           # Low-level bitstream wire serialization
    ├── codec.mjs                  # Abstract pattern graph algorithms
    └── cli-entry.mjs              # isMainEntrypoint detection
```

### Benefits of this Structure:
1. **Self-Contained Executables**: Every `.mjs` directly under `codecs/` is a complete, runnable tool that can be copied, inspected, or executed without digging into internal directories.
2. **Zero Boilerplate**: Common CLI parsing and stream handling reside in `codec-sdk.mjs`.
3. **Browser VFS Simplicity**: Because codecs only import from `codec-sdk.mjs` (or receive it via context), bundling and VFS loading become trivial and robust—no more regex stripping of imports or missing transitive files.
4. **Third-Party Friendly**: Anyone can write an external codec by following a single template and importing `codec-sdk.mjs`.
