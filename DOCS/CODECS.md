# Writing Codecs

A codec is a small ES module that translates between some external text format
and k `Value` objects. The same module may serve two entry points:

- a command-line codec such as `k-int --parse` or `k-int --print`,
- a REPL codec loaded with `:codec load file`.

The command-line entry point reads or writes the binary pattern+value stream.
The REPL entry point exports `name`, type metadata, `parse`, and `print`
functions.

## Architecture & Mental Model

A codec is a recipe for translating between external text and enveloped *k* values:

- `parse(text)` translates external text to an enveloped *k* value (a `Value` with an associated closed pattern envelope).
- `print(value)` translates an enveloped *k* value into formatted external text, throwing an `Error` if the value is not representable.

Codecs are not restricted to a single code hash or type: a single codec file can define a family of target patterns (for example, `int.mjs` handles both scalar integers and integer lists like `[0,1,2]`, and `json.mjs` converts between arbitrary JSON structures and enveloped *k* values).

In the REPL:
- **Input**: The user explicitly chooses which codec to parse with:
  - Interactive mode: `:input <codec>` sets the prompt to `<codec>> `, and the next entered line is parsed with `<codec>`.
  - One-line mode: `:input <codec> <text>` immediately parses `<text>` using `<codec>`.
- **Output**: Any evaluated *k* value is displayed in its standard *k* envelope representation, followed by formatting from **all loaded codecs** that can represent it:
  ```text
  > 42 int
  {}|_|0|1|0|1|0|1|+ ?<{} _, ...>
  int: 42
  ```
  Every loaded codec attempts `codec.print(value)`. If it succeeds, the REPL prints `<name>: <formatted>`. If it throws, the codec is silently ignored for that value.

## Implement The REPL API

A REPL codec exports:

```js
export const name = "mycodec";
export const patterns = [MY_PATTERN_1, MY_PATTERN_2]; // optional pattern family metadata

export function parse(text, context) {
  // text is the line entered with :input
  // return an enveloped k Value
}

export function print(value, context) {
  // return text shown under normal REPL output
  // throw Error if value is not representable
}
```

`context` contains `{ state, codecName }`.

`parse` should throw an `Error` for invalid external text. `print` should throw when the value is not representable by the external format. REPL output suppresses `print` errors so loaded codecs only output when they recognize the value.

## Build Values

Use the structural `Value` API:

```js
import { Value, isProduct, isVariant } from "../Value.mjs";

const unit = Value.product({});
const yes = Value.variant("true", unit);
const point = Value.product({
  x: Value.variant("+", unit),
  y: Value.variant("-", unit)
});
```

Products are JavaScript objects whose keys are k field labels. Variants have a
string tag and a payload value.

## Minimal Type-Specific Codec

This codec accepts `yes` and `no` for the type `<{} true, {} false>`.

```js
import { Value, isVariant } from "../Value.mjs";

const BOOL_PATTERN = [
  ["closed-union", [["false", 1], ["true", 1]]],
  ["closed-product", []]
];

export const name = "yesno";
export const patterns = [BOOL_PATTERN];

export function parse(text) {
  const word = text.trim();
  if (word === "yes") return Value.variant("true", Value.product({}));
  if (word === "no") return Value.variant("false", Value.product({}));
  throw new Error("expected yes or no");
}

export function print(value) {
  if (!isVariant(value)) throw new Error("expected bool variant");
  if (value.tag === "true") return "yes";
  if (value.tag === "false") return "no";
  throw new Error("expected true or false");
}
```

Load it in the REPL:

```text
> :codec load ./codecs/yesno.mjs
loaded codec yesno
> :input yesno
yesno> yes
{}|true ?<{} false, {} true>
yesno: yes
```

Or using the one-line syntax:

```text
> :input yesno yes
{}|true ?<{} false, {} true>
yesno: yes
```

## Add The CLI Boundary

To make the same module usable as an installed command, add a `main` function
that supports `--parse`, `--print`, and `--help`.

```js
#!/usr/bin/env node

import { stdin, stdout, argv, exit } from "node:process";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";
import { isMainEntrypoint } from "./runtime/cli-entry.mjs";

function usage(stream = console.error) {
  stream(`Usage: ${argv[1]} --parse | --print`);
  stream("  --parse      Read yes/no text, write binary pattern+value stream.");
  stream("  --print      Read binary pattern+value stream, write yes/no text.");
  stream("  -h, --help   Show this help.");
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }
  if (args.length !== 1 || (args[0] !== "--parse" && args[0] !== "--print")) {
    usage();
    exit(1);
  }

  const input = await readAll(stdin);
  if (args[0] === "--parse") {
    stdout.write(encodeToWire(parse(input.toString("utf8")), BOOL_PATTERN));
  } else {
    stdout.write(`${print(decodeWire(input).value)}\n`);
  }
}

if (isMainEntrypoint(import.meta.url, argv[1])) {
  main().catch(error => {
    console.error(error.message || String(error));
    exit(1);
  });
}
```

The command-line interface must write only the binary stream to stdout in
`--parse` mode. Diagnostics belong on stderr.

Installed codec binaries use the `k-` prefix plus the source basename without
`.mjs`. For example, `codecs/yesno.mjs` installs as `k-yesno` when added to
`package.json`.

## Test A Codec

For CLI codecs, test both directions:

```sh
printf 'yes\n' | node codecs/yesno.mjs --parse | node codecs/yesno.mjs --print
```

For REPL codecs, add a focused case to [`../tests/test-repl.mjs`](../tests/test-repl.mjs):

```js
const state = createState();
let output = await evaluateInput(":codec load ./codecs/yesno.mjs", state);
assert.match(output[0], /^loaded codec yesno/);
output = await evaluateInput(":input yesno", state);
assert.equal(promptForState(state), "yesno> ");
output = await evaluateInput("yes", state);
assert.match(output[0], /yesno: yes/);
output = await evaluateInput(":input yesno no", state);
assert.match(output[0], /yesno: no/);
```

Run the targeted test first:

```sh
node tests/test-repl.mjs
```

Then run the full suite before committing:

```sh
npm test
```

## Checklist

- Export a stable string `name`.
- Optionally export `pattern` or `patterns` for pattern family metadata.
- Keep `parse` and `print` deterministic.
- Return enveloped structural `Value` objects from `parse`.
- Validate shapes in `print` and throw clear errors when not representable.
- Keep command-line `--parse` stdout binary-only.
- Add `-h` and `--help` for installed commands.
- Add REPL coverage for `:codec load` and `:input`.
