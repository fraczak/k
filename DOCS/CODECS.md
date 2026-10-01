# Writing Codecs

A codec is an ES module that translates between an external domain format and enveloped **k** `Value` objects `(P, v)`. The same module serves two entry points:

- a standalone command-line filter supporting `--parse`, `--print`, and `--help`,
- a REPL module loaded with `:codec load <file.mjs>`.

The command-line entry point reads or writes the binary pattern+value stream.
The REPL entry point provides interactive parsing (`:input <codec.mjs>`) and multi-codec output formatting.

## Architecture & Mental Model

A codec maps between external text and enveloped *k* values:

- `parse(text)` translates external text to an enveloped *k* value (a `Value` with an associated closed pattern envelope `(P, v)`).
- `print(value)` translates an enveloped *k* value into formatted external text, throwing an `Error` if the value is not representable.
- `doc` (optional string) documents the accepted syntax and semantic representation.

Codecs are identified directly by their file name. They do not export artificial identifiers like `name` or pattern registries like `patterns = [...]`.

In the REPL:
- **Input**: The user explicitly chooses which codec to parse with:
  - Interactive mode: `:input <codec.mjs>` sets the prompt to `<codec.mjs>> `, and the next entered line is parsed with that codec.
  - One-line mode: `:input <codec.mjs> <text>` immediately parses `<text>` using that codec.
- **Output**: Any evaluated *k* value is displayed in its standard *k* envelope representation, followed by formatting from **all loaded codecs** that can represent it:
  ```text
  > 42 int
  {}|_|0|1|0|1|0|1|+ ?<{} _, ...>
  int.mjs: 42
  ```
  Every loaded codec attempts `codec.print(value)`. If it succeeds, the REPL prints `<codec.mjs>: <formatted>`. If it throws, the codec is silently ignored for that value.

## Module Interface

A codec module exports:

```js
export const doc = "Description of syntax and usage.";

export function parse(text) {
  // parse text into an enveloped k Value (P, v) using withPattern(value, pattern)
}

export function print(value) {
  // return formatted text
  // throw Error if value is not representable
}
```

`parse` should throw an `Error` for invalid external text. `print` should throw when the value is not representable by the external format. REPL output suppresses `print` errors so loaded codecs only output when they recognize the value.

## The Codec SDK & Runner

To eliminate CLI stream boilerplate, codecs import from `./runtime/codec-sdk.mjs` and invoke `runCodecCLI`:

```js
import { Value, isVariant, withPattern, runCodecCLI } from "./runtime/codec-sdk.mjs";
```

`runCodecCLI(import.meta.url, { parse, print, doc })` automatically handles:
1. Entrypoint detection (no-op when loaded as a module or in browsers).
2. `-h` and `--help` CLI flag handling.
3. `--parse` and `--print` stream piping and wire encoding/decoding.

## Minimal Type-Specific Codec Example

This codec accepts `yes` and `no` for the type `<{} false, {} true>`. Patterns are derived by `k` from filter expressions via `patternFromFilter`:

```js
#!/usr/bin/env node

import { Value, isVariant, withPattern, patternFromFilter, runCodecCLI } from "./runtime/codec-sdk.mjs";

const BOOL_PATTERN = patternFromFilter("?< {} false, {} true >");

export const doc = `
Boolean codec: accepts 'yes' and 'no'.
`;

export function parse(text) {
  const word = text.trim();
  if (word === "yes") return withPattern(Value.variant("true", Value.product({})), BOOL_PATTERN);
  if (word === "no") return withPattern(Value.variant("false", Value.product({})), BOOL_PATTERN);
  throw new Error("expected yes or no");
}

export function print(value) {
  if (!isVariant(value)) throw new Error("expected bool variant");
  if (value.tag === "true") return "yes";
  if (value.tag === "false") return "no";
  throw new Error("expected true or false");
}

runCodecCLI(import.meta.url, { parse, print, doc });
```

### Using in the REPL:

```text
> :codec load ./codecs/yesno.mjs
loaded codec yesno.mjs
> :input yesno.mjs yes
{}|true ?<{} false, {} true>
yesno.mjs: yes
```

### Using as a CLI Pipeline Filter:

```sh
printf 'yes\n' | ./codecs/yesno.mjs --parse | ./codecs/yesno.mjs --print
# Output: yes
```

## Testing a Codec

For CLI codecs, test both directions in a pipeline:

```sh
printf 'yes\n' | node codecs/yesno.mjs --parse | node codecs/yesno.mjs --print
```

For REPL codecs, add a focused case to [`../tests/test-repl.mjs`](../tests/test-repl.mjs):

```js
const state = createState();
let output = await evaluateInput(":codec load ./codecs/yesno.mjs", state);
assert.match(output[0], /^loaded codec yesno\.mjs/);
output = await evaluateInput(":input yesno.mjs", state);
assert.equal(promptForState(state), "yesno.mjs> ");
output = await evaluateInput("yes", state);
assert.match(output[0], /yesno\.mjs: yes/);
output = await evaluateInput(":input yesno.mjs no", state);
assert.match(output[0], /yesno\.mjs: no/);
```

Then run the full suite before committing:

```sh
npm test
```

## Web REPL (VFS) Bundling

When `repl.html` is generated (`npm run build:repl-html`):
- Codecs (`int.mjs`, `json.mjs`, `utf8.mjs`, `unit.mjs`, `ieee.mjs`) are bundled into 100% self-contained ES modules with zero imports.
- `runCodecCLI` is shimmed as a no-op, and `Value` helpers are directly inlined.
- In the browser, the VFS serves these self-contained modules directly to native dynamic `import(blobUrl)`. No runtime helper files (`codecs/runtime/*`) need to be included in the VFS or exposed as globals.

## Checklist

- Return an enveloped `Value` from `parse` using `withPattern(val, pattern)`.
- Keep `parse` and `print` deterministic and free of side effects.
- Validate shapes in `print` and throw clear errors when not representable.
- Use `runCodecCLI(import.meta.url, { parse, print, doc })` for CLI execution.
- No artificial `name` or `patterns` exports required.
- Add `-h` and `--help` support via `runCodecCLI`.

