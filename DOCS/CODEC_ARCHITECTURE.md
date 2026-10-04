# Reusable Codec Architecture

## 1. Overview & Objectives

In **k**, a **codec** is a two-way translator between external domain
data (e.g. decimal integers, JSON, UTF-8 text, IEEE 754 floats) and **k**
enveloped values (a structural `Value` tree paired with a closed pattern
graph).

In **k**, there are no primitive numbers or built-in numerical types.
Numbers are nullary relations mapping the unit to bit trees
(`${} -> $bits`), and arithmetic relations operate on signed
integer variants (`$int`). Codecs like `int.mjs` bridge human
decimal representations and these algebraic structures.

Every codec in the **k** ecosystem is designed to serve three unified
objectives from a single module definition:

1. **Document the Codec**: Formally specify the external syntax and its
   semantics as an enveloped **k** value `(P, v)`.
2. **REPL Module**: Provide interactive input parsing (`:input
   <codec.mjs>`) and multi-codec output inspection (`<codec.mjs>:
   <formatted>`) in both Node.js and browser REPLs.
3. **Standalone Shell Executable**: Function as a first-class Unix filter
   (`--parse`, `--print`, `--help`) for composition in command-line
   pipelines.

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
                     |        (Syntax & Value Mapper)        |
                     +---------------------------------------+
                         |                               ^
        CLI: --parse     |                               | CLI: --print
        REPL: :input     v                               | REPL: output
                     +---------------------------------------+
                     |           Enveloped k Value           |
                     |     (pattern graph P, value tree v)   |
                     |        Binary Wire Stream (P, v)      |
                     +---------------------------------------+
```

---

## 2. Objective 1: Documentation & Specification

Every codec defines what external text it accepts and how that text
maps to an enveloped **k** value.

### 2.1 External Syntax
The syntax specification defines the valid textual forms accepted by
the codec:
- **Grammar & Rules**: Defines the accepted language. While regular
  expressions offer simple examples, the syntax can be an arbitrary
  formal language (context-free, recursive, JSON RFC 8259, etc.).
- **Normalization**: Rules for whitespace, casing, or escaping.
- **Rejection Criteria**: Explicit errors when invalid input is
  encountered.

### 2.2 Semantics as an Enveloped k Value
Parsing external text produces an **enveloped value** `(P, v)`:
- **Pattern Graph ($P$)**: A closed pattern graph specifying the
  algebraic structure.
- **Value Tree ($v$)**: A concrete tree matching $P$, constructed from
  products (`{...}`) and variants (`<...>`).

A codec does not produce an ungrounded type; it performs a concrete
transformation from text to an enveloped value `(P, v)`.

### 2.3 Pattern Derivation via k Type System (`patternFromFilter`)
Pattern graphs ($P$) must never be handwritten as raw property-list
JSON arrays (e.g. `[["closed-union", ...]]`). Instead, codecs derive
pattern graphs directly through the **k** type system from filter or
type expressions using `patternFromFilter`:

```js
import { patternFromFilter } from "./runtime/codec-sdk.mjs";

// Derived from k filter expression
const INT_PATTERN = patternFromFilter(
  '?< <bits 0, bits 1, {} _>=bits "+", bits "-">'
);
```

This guarantees:
1. All patterns are verified, normalized, and canonicalized by **k**'s
   type derivation and graph unification engine.
2. Codecs remain concise, declarative, and maintainable.
3. Codecs run identically in Node.js and in the Web REPL (via the browser
   runtime shim).

### 2.4 Documentation Contract
A codec is identified solely by the file loaded—there is no artificial
`name` export or `patterns` list export. A codec may optionally export
a `doc` string:
- Describes accepted syntax, options, and representation.
- Displayed by `--help` in shell invocations.
- Displayed by `:help <codec.mjs>` or documentation commands in REPLs.

---

## 3. Objective 2: REPL Module Interface

In the REPL, codecs are loaded dynamically on demand:
```text
> :codec load int.mjs
```

### 3.1 Module Exports
A codec module exports:

| Export | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `parse` | `(text: string) => EnvelopedValue \| Value` | **Yes** | Parses external text into an enveloped `Value`. Throws on syntax error. |
| `print` | `(value: Value) => string` | **Yes** | Formats a `Value` into external text. Throws if value is not representable. |
| `doc` | `string` | Optional | Documentation of syntax and usage for CLI help and REPL inspections. |

### 3.2 REPL Input Protocol
The user specifies the codec to parse an input payload:
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
Whenever an evaluation produces a resulting **k** `Value`:
1. The primary representation is the standard **k** value envelope.
2. The REPL iterates over loaded codecs and calls `codec.print(value)`.
3. If `codec.print(value)` succeeds, the REPL displays
   `<codec>: <formattedString>`.
4. If `codec.print(value)` throws, the codec is silently ignored for
   that value.

---

## 4. Objective 3: Standalone Shell Executable Contract

Every codec file is directly executable from the command line:
```bash
chmod +x codecs/int.mjs
```

### 4.1 CLI Invocations

1. **Parse Mode (`--parse`)**:
   - Reads external text from `stdin`.
   - Parses it into an enveloped value `(P, v)`.
   - Writes the binary wire encoding of `(P, v)` to `stdout`.
   - Diagnostics and errors are written to `stderr`.
   - Exit code: `0` on success, non-zero on error.

2. **Print Mode (`--print`)**:
   - Reads binary wire bytes `(P, v)` from `stdin`.
   - Decodes the wire stream and calls `print(value)`.
   - Writes formatted text to `stdout`.
   - Exit code: `0` on success, non-zero if not representable under this
     codec.

3. **Help Mode (`-h`, `--help`)**:
   - Outputs CLI usage and the codec's `doc` string to `stdout`.

---

## 5. Implementation: Codec CLI Runner

To avoid duplicating stdin/stdout stream handling and CLI flag parsing
across codecs, a helper is provided:

```javascript
runCodecCLI(import.meta.url, { parse, print, doc });
```

### Responsibilities of `runCodecCLI`:
1. **Entrypoint Detection**: Checks if the module is invoked directly
   from the CLI (e.g. `import.meta.url ===
   pathToFileURL(process.argv[1]).href`). If imported as a module or
   running in a browser, it is a no-op.
2. **Flag Parsing**: Handles `--parse`, `--print`, and `-h` / `--help`.
3. **Stream Piping**:
   - For `--parse`: reads `stdin` to string, calls `parse(text)`, encodes
     enveloped value `(P, v)` to binary wire format on `stdout`.
   - For `--print`: decodes wire format from `stdin` into `(P, v)`, calls
     `print(value)`, writes formatted text to `stdout`.

---

## 6. Directory Layout

To make `codecs/` intuitive and self-contained:

```text
codecs/
├── int.mjs                    # Integer & list codec
├── json.mjs                   # JSON codec
├── utf8.mjs                   # UTF-8 string codec
├── utf16.mjs                  # UTF-16 string codec
├── ieee.mjs                   # IEEE 754 float codec
├── unit.mjs                   # Unit {} codec
├── k-parse.mjs                # Textual k value {...} -> binary wire stream
├── k-print.mjs                # Binary wire stream -> textual k value
├── show.mjs                   # Wire stream pass-through inspector
└── runtime/                   # Shared codec infrastructure
    ├── codec-sdk.mjs          # runCodecCLI, Value, encodeToWire, decodeWire
    ├── prefix-codec.mjs       # Low-level bitstream wire serialization
    ├── codec.mjs              # Abstract pattern graph algorithms
    └── cli-entry.mjs          # Entrypoint detection
```

Each codec file directly under `codecs/` is both an executable CLI
script and an importable module.

---

## 7. Web REPL & VFS Bundling Architecture

In the browser REPL (`repl.html`):
- **Self-Contained Modules**: At build time
  (`scripts/build-repl-html.mjs`), verified codecs in `codecs/` are
  compiled via `esbuild` into 100% self-contained ES modules with **zero
  imports**.
- **No Runtime Files in VFS**: `codecs/runtime/*` is not included in the
  browser VFS. The VFS only contains verified, self-contained user-facing
  files (`int.mjs`, `json.mjs`, `utf8.mjs`, `unit.mjs`, `ieee.mjs`).
- **Native Browser Loading**: In `repl-codecs.mjs`, the browser reads the
  codec source from VFS, wraps it in a Blob, and invokes native `await
  import(blobUrl)`. No regex manipulation, import stripping, or global
  environment injection is required.

## Further Reading

- [DOCS/FILE_FORMATS.md](./FILE_FORMATS.md) — guide to
  .k, .ko, .klib, and .kvm formats
- [DOCS/CODECS.md](./CODECS.md) — guide to writing codecs
- [DOCS/DICTIONARY.md](./DICTIONARY.md) — concept names and terminology
