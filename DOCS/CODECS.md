# Writing Codecs

A codec is a small ES module that translates between some external text format
and k `Value` objects. The same module may serve two entry points:

- a command-line codec such as `k-int --parse` or `k-int --print`,
- a REPL codec loaded with `:codec load file`.

The command-line entry point reads or writes the binary pattern+value stream.
The REPL entry point exports `name`, type metadata, `parse`, and `print`
functions.

## Choose The Shape

Use a type-specific codec when the external format belongs to one k type. The
module exports either `codes` or `patterns`.

```js
export const name = "unit";
export const patterns = [[
  ["closed-product", []]
]];
```

Use a universal codec when the external format can describe many k types. A
universal codec is available for any type named by `:input`; the REPL validates
the parsed value against that requested type before accepting it.

```js
export const name = "json";
export const universal = true;
```

Prefer `patterns` for codecs that live in the source tree because the REPL
recomputes the canonical code hash. Use `codes` only when the codec is tied to a
known canonical hash:

```js
export const codes = ["@..."];
```

## Implement The REPL API

A REPL codec exports:

```js
export const name = "mycodec";
export const patterns = [MY_PATTERN]; // or codes = ["@..."], or universal = true

export function parse(text, context) {
  // text is the line entered after :input
  // return a k Value
}

export function print(value, context) {
  // return text shown under normal REPL output
}
```

`context` contains:

- `codeHash`: the canonical code hash selected by `:input`,
- `pattern`: the closed property-list pattern for that type,
- `state`: the current REPL state.

Most codecs do not need `context`. Universal codecs can use it when the same
text syntax needs to adapt to the requested type.

`parse` should throw an `Error` for invalid external text. `print` should throw
when the value is not representable by the external format. For universal
codecs, REPL output suppresses `print` errors so a generic codec does not add
noise to every value.

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
loaded codec yesno for @...
> :input <{} true, {} false> yesno
input @... using yesno: enter value text
yesno> yes
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

## Universal Codecs

Universal codecs omit `codes` and `patterns`:

```js
export const name = "json";
export const universal = true;

export function parse(text) {
  // Convert external text to a Value.
}

export function print(value) {
  // Convert a Value to external text.
}
```

The built-in [`../codecs/json.mjs`](../codecs/json.mjs) codec is the reference
example. It derives a pattern for command-line `--parse`, but in the REPL the
requested `:input` type supplies the target type.

## Test A Codec

For CLI codecs, test both directions:

```sh
printf 'yes\n' | node codecs/yesno.mjs --parse | node codecs/yesno.mjs --print
```

For REPL codecs, add a focused case to [`../tests/test-repl.mjs`](../tests/test-repl.mjs):

```js
const state = createState();
let output = await evaluateInput(":codec load ./codecs/yesno.mjs", state);
assert.match(output[0], /^loaded codec yesno for @/);
output = await evaluateInput(":input <{} true, {} false> yesno", state);
assert.match(output[0], /^input @[^ ]+ using yesno: enter value text$/);
output = await evaluateInput("yes", state);
assert.match(output[0], /yesno: yes/);
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

- Export a stable `name`.
- Export exactly one dispatch shape: `patterns`, `codes`, or `universal = true`.
- Keep `parse` and `print` deterministic.
- Return structural `Value` objects from `parse`.
- Validate shapes in `print` and throw clear errors.
- Keep command-line `--parse` stdout binary-only.
- Add `-h` and `--help` for installed commands.
- Add REPL coverage for `:codec load` and `:input`.
