# File formats and tools

Run the examples below from the repository root after `npm install`.
`npm link` exposes the shorter installed commands such as `k` and
`k-compile`. Every installed command supports `--help`.

## Formats

| Format | Contents | Producer / consumer |
| --- | --- | --- |
| `.k` | Source definitions and an optional terminal expression | Editor, REPL, compiler |
| `.ko` | Compiled executable object with a main relation | `k-compile`, `k`, backend tools |
| `.klib` | Compiled definitions with no main relation | `k-compile`, `:klib`, `--lib`, `:load` |
| `.kvm` | JSON kVM artifact: polymorphic `KVM-P` template or specialized `KVM` program | `k-compile`, specialization API, backends |
| `.pkir` | JSON experimental PKIR relation (`format: "pk-ir"`, version 1) | JavaScript API, backends |
| `.wasm` | WebAssembly module with k runner metadata | `k-wasm-compile`, `k-wasm-run` |

A source file executed directly needs a terminal expression. A library can
contain definitions only. Definitions alone are also valid REPL input.

The [binary wire stream](../codecs/WIRE_FORMAT.md) carrying an input or output
value is separate from these program artifacts.

## Run source or an object

```sh
node codecs/unit.mjs --parse | node k.mjs '{} |ok' | node codecs/k-print.mjs
```

This prints `"ok"`. Existing paths are read as files; `k` otherwise treats its
program argument as inline source. Other compiler tools reject recognized
missing input filenames; consult their help for accepted extensions.

`k` reads a binary input stream, including when the program produces a constant.
Unit is a convenient input for a constant program; a constant relation does not
inherently require unit as its input schema.

The [textual-value guide](TEXTUAL_VALUES.md) explains `k-parse` and `k-print`.

## Compile an executable

```sh
node objects/compile.mjs '{} |ok' /tmp/k-ok.ko
node codecs/unit.mjs --parse | node k.mjs /tmp/k-ok.ko |
  node codecs/k-print.mjs
```

The output extension selects the compiler format. To select it explicitly:

```sh
node objects/compile.mjs --format ko '{} |ok' /tmp/k-ok.ko
```

Source is read from stdin when omitted; output goes to stdout when no path is
given. `-o` / `--output` is an alternative to the positional output path.

## Compile and link a library

```sh
node objects/compile.mjs 'greet = {} |hello;' /tmp/k-demo.klib
node objects/compile.mjs --lib /tmp/k-demo.klib --export greet 'greet' /tmp/k-greet.ko
node codecs/unit.mjs --parse | node k.mjs /tmp/k-greet.ko |
  node codecs/k-print.mjs
```

This prints `"hello"`. `--lib` loads a dependency; it does not select library
output. These are equivalent ways to generate a library from source:

```sh
node objects/compile.mjs Examples/arithmetics.k /tmp/k-math.klib
node objects/compile.mjs --format klib Examples/arithmetics.k /tmp/k-math.klib
```

Only one `--lib` is accepted by the current CLI. The dependency's relations are
available under canonical hashes; friendly aliases require explicit
`--export name` or `--export libraryName:localName` mappings. Repeat
`--export` for each needed alias. Source can reference hashes directly.

For example, increment a decimal input using a library relation:

```sh
printf '42\n' | node codecs/int.mjs --parse |
  node k.mjs --lib /tmp/k-math.klib --export inc 'inc' |
  node codecs/int.mjs --print
```

This prints `43`. Numeral names such as `5` in the arithmetic library are
relations producing bit trees. `5 int` constructs a signed integer; numeral
names are not builtin literals.

## Inspect and decompile

```sh
node objects/inspect.mjs /tmp/k-ok.ko
node objects/validate.mjs /tmp/k-ok.ko
node objects/decompile.mjs /tmp/k-demo.klib /tmp/k-demo.k
node objects/extract-aliases.mjs /tmp/k-demo.klib
node kir.mjs /tmp/k-ok.ko > /tmp/k-ok.kir.json
node objects/validate.mjs --kir /tmp/k-ok.kir.json
```

`k-inspect-object --kir` is another route to the
[KIR-P export](KIR_V1.md). Exported KIR-P is an inspection/backend contract;
it does not replace the stored object container.

The REPL exports current definitions with `:klib file.klib` and an executable
expression with `:ko file.ko expression`. See [REPL.md](REPL.md).

## Object container reference

Executable objects use:

```text
"KOBJ" 0x0a
uint32-be JSON-payload-byte-length
UTF-8 JSON payload
```

Libraries are plain UTF-8 JSON with no binary header. Both payloads use
`format: "k-object"` and have no payload version field.

| Field | Role |
| --- | --- |
| `main` | `"__main__"` for compiler-generated executables, `null` for libraries |
| `codes` | Canonical closed schema definitions |
| `rels` | Relation definitions, pattern graphs, and per-relation derivation status |
| `relAlias` | Friendly relation names mapped to hashes |
| `patterns` | Deduplicated canonical pattern template ASTs |
| `patternAlias` | Friendly pattern names mapped to skeleton hashes |
| `compileStats` | Derivation statistics |
| `meta` | Origins, aliases, source ranges, and pattern routing metadata |

A relation's `typeDerivation.status` is `converged`, `not-converged`, or
`unknown`. It currently stores only status, not an iteration trace. Consumers
must check eligibility for their execution path rather than assume that every
stored relation converged.

Stored relation definitions omit source `start`/`end` ranges and generated
boundary filters. Source ranges are on `meta[hash].origins[]`. Metadata entries
have `type: "code"`, `"rel"`, or `"pattern"`; origin entries do not have a
`kind` field. Pattern origins retain `params` and `aliasArgs` so repeated
variables and parameter routing survive loading and export.

Loading hydrates pattern graphs without reparsing source. Some backend paths
then specialize those graphs for an input envelope; that can involve further
derivation. See [architecture](ARCHITECTURE.md) for the distinction.

## kVM artifacts

```sh
node objects/compile.mjs '?{} {} |ok' /tmp/k-ok.kvm
node backends/wasm/bin/k-wasm-compile.mjs /tmp/k-ok.kvm /tmp/k-ok-from-kvm.wasm
node codecs/unit.mjs --parse |
  node backends/wasm/bin/k-wasm-run.mjs /tmp/k-ok-from-kvm.wasm |
  node codecs/k-print.mjs
```

Compiler-emitted templates use `format: "k-vm"`, `version: 1`,
`layer: "KVM-P"`, and `isPolymorphic: true`. They retain relation contracts
and instruction streams for `specializeKVM` at invocation time. Specialized
artifacts use `layer: "KVM"`.

A `.ko` can be lowered to `.kvm`. A `.klib` alone has no entry relation:
link it into source with a main expression first. The compiler can copy a
`.klib` to another `.klib` path, but does not turn a library alone into an
executable object.

See [the kVM reference](KVM_EXECUTION_MODEL.md) for execution modes and instructions.

The `k-vm` CLI currently accepts source and executable objects, rather than
loading `.kvm` JSON artifacts directly. For example:

```sh
node codecs/unit.mjs --parse | node kvm.mjs /tmp/k-ok.ko |
  node codecs/k-print.mjs
```

## PKIR and targets

[PKIR](POLYMORPHIC_IR.md) is a separate experimental execution representation.
`compileRelationToPKIR` in `backend-api.mjs` creates a relation artifact;
`executePKIR` interprets it and `specializePKIR` resolves layout accesses.

The backend compile commands accept `.pkir` input, or `--pkir` when compiling
source through that path. They also accept source, executable objects, and kVM
programs. A library still needs an entry relation.

See the [WebAssembly](../backends/wasm/README.md) and
[LLVM](../backends/llvm/README.md) guides for target compilation and execution.
