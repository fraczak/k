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
node objects/compile.mjs --lib /tmp/k-demo.klib --use greet 'greet' /tmp/k-greet.ko
node codecs/unit.mjs --parse | node k.mjs /tmp/k-greet.ko |
  node codecs/k-print.mjs
```

This prints `"hello"`. `--lib` loads a dependency; it does not select library
output. These are equivalent ways to generate a library from source:

```sh
node objects/compile.mjs lib/integer.k /tmp/integer.klib
node objects/compile.mjs --format klib lib/integer.k /tmp/integer.klib
```

Only one `--lib` is accepted on the command line by current CLI tools. Chained
libraries carry forward definitions from their predecessors, so compiling a
series of libraries extends the environment cumulatively.

### Source dependency comments

To document expected dependencies and recommended `--use` symbols without
scattering hardcoded content hashes (`@hash`) throughout source code, `.k` files
can include ordinary `# --lib ...` comments near the top of the file:

```k
# --lib <dependency-path> --use <spec1> <spec2> ...
```

Because `#` is a standard one-line comment character in k, these lines are valid
k syntax and are ignored completely by the compiler and CLI tools (they are
**not** parsed as compiler directives). By convention, `# --lib <path> --use ...`
lists:

- `<dependency-path>`: the expected dependency (for example, `core.k` or `lib/generic.k`).
- `--use` specs:
  - `name`: references a library relation or pattern under the same name.
  - `libname:localname`: aliases a library relation or pattern `libname` under `localname`.
  - `pattern[Params]`: references a named pattern with its parameter signature (e.g. `btrie[V]` or `byte[]`).
  - `pattern[Params]:localname[Params]`: aliases a named pattern under `localname` (e.g. `float64[]:number[]`).

Multiple `# --lib` comment lines may appear when a file uses several libraries:

```k
# --lib core.k --use bit[] bits[]
```

#### How `--lib` and `--use` Work

When source code is compiled with library dependencies (`k-compile`, `k.mjs`, `compileLibrary`, `compileObject`, or the REPL's `:load`):

1. **Content-Addressed Availability (Hash-Only)**: When `--lib file.klib` is supplied, all relations and patterns defined in the library are available in memory indexed strictly by their content hashes (`@<hash>`). Friendly names (the aliases recorded in library metadata) are **never** in scope by default.
2. **Explicit Symbol Scope (`--use`)**: To bring a library relation or pattern into scope under a friendly name, `--use <spec>` must be specified (or `useSpecs` passed in the compiler API). The compiler resolves the spec against the library's metadata aliases and binds the friendly or aliased name directly in the in-memory symbol tables.
3. **No Automatic Ingestion or Precedence Ambiguity**: Because library friendly names are not in scope without `--use`, there is no implicit shadowing or "precedence". Local definitions define local names; library definitions are accessed by `@<hash>` or by the names explicitly brought into scope via `--use`. If a name declared via `--use` is redefined (by another `--use` binding or by a local definition), the compiler emits a warning and the later definition wins.
4. **No Text Synthesis or Line Offset**: The compiler never synthesizes source code or prepends preamble text to user files. Source text remains completely untouched, preserving exact 1-to-1 line numbers in AST nodes, diagnostics, warnings, and error messages.

#### Command-Line Usage

- Compile a library or dependent file using explicit `--lib` / `--use` flags:
  ```sh
  node objects/compile.mjs lib/integer.k /tmp/integer.klib
  node objects/compile.mjs --lib /tmp/integer.klib \
    --use "int[] nat int pos? neg? zero? gt? inc dec" \
    Examples/poly.k /tmp/poly.klib
  ```
- Command-line `--use spec` flags bring relations into scope for evaluation:
  ```sh
  printf '42\n' | node codecs/int.mjs --parse |
    node k.mjs --lib /tmp/integer.klib --use inc 'inc' |
    node codecs/int.mjs --print
  ```

This prints `43`. `lib/integer.k` defines `0` and `1` as signed integers
and `nat` to lift unsigned bit sequences such as `{} |_ |1 |0 |1 nat` (5);
numeral names are not builtin literals.

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
