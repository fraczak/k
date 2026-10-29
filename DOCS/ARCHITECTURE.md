# Compiler and runtime

This guide maps the current JavaScript implementation. Start with the
[walkthrough](GETTING_STARTED.md) for language use.

## Source and contract derivation

1. `parser.jison` generates the source parser, `parser.mjs`.
2. `index.mjs` parses source, validates/expands named patterns, and invokes
   `compiler.mjs`.
3. `augmentation.mjs` creates local input/output constraints.
4. `TypePatternGraph.mjs` and `typing.mjs` represent and unify constraints.
5. `Graph.mjs` and `convergence.mjs` process dependency groups, iterating
   recursive groups until convergence or the configured budget.
6. `codes.mjs` normalizes closed schema graphs; `export.mjs` assigns canonical
   relation names. `canonical-pattern.mjs` handles pattern skeletons and routing.

`annotate(source, options)` returns relations, aliases, source definitions, and
compilation statistics. [Contract derivation](TYPE_DERIVATION.md) describes
the rules and tuning options.

## Execution and values

`Value.mjs` represents products and variants with an optional `pattern`.
At wire boundaries, the pattern and payload are serialized together.

`run.mjs` implements the reference evaluator. Its envelope-aware path
intersects arriving patterns with compiled constraints and carries subpatterns
through projection and construction. A schema contradiction is a type error;
ordinary undefinedness is a separate partial-function result.

The envelope-free `run_converged` path requires converged derivation.
Specialized execution can use static patterns instead of carrying them through
every operation. This does not remove the need to validate input boundaries.

Shared input/output pattern nodes express shared schema constraints. They are
not a value-provenance analysis.

## Artifacts and execution layers

`object.mjs` packages and loads `.ko` and `.klib` definitions.
Loading hydrates stored graphs without parsing source again.
[File formats](FILE_FORMATS.md) documents the payload and tools.

The execution representations have distinct roles:

| Representation | Implementation | Role |
| --- | --- | --- |
| KIR-P | `kir.mjs` | Portable export of object relations and pattern graphs |
| kVM | `kvm.mjs` | Register instructions, polymorphic templates, and specialization |
| PKIR | `pkir.mjs`, `access-table.mjs` | Experimental schema-state/layout-witness execution |

KIR-P envelope specialization (`retypeObjectRelation` and related functions)
can rerun contract derivation. kVM template specialization (`specializeKVM`)
works on already lowered templates and their principal contracts.
Do not treat these as the same pass.

The Wasm and LLVM backends lower kVM instructions through
`backends/wasm/src/kvm2wasm.mjs` and `backends/llvm/src/kvm2llvm.mjs`.
Their PKIR paths adapt the layout-oriented representation for target lowering.
`backend-api.mjs` exposes the shared compiler/backend API.

See the [KIR-P](KIR_V1.md), [kVM](KVM_EXECUTION_MODEL.md), and
[PKIR](POLYMORPHIC_IR.md) references for their contracts.

## Codecs and user interfaces

- `valueParser.jison` / `valueIO.mjs` parse textual boundary values.
- `codecs/runtime/codec.mjs` implements pattern operations.
- `codecs/runtime/prefix-codec.mjs` encodes and decodes the wire format,
  including lazy decoding.
- `codecs/runtime/codec-sdk.mjs` provides codec helpers and the common CLI runner.
- `repl.mjs` manages sessions; `repl-codecs.mjs` handles codec loading/rendering.
- `browser/repl-browser.mjs` implements the browser UI.
- `scripts/build-repl-html.mjs` bundles browser shims, VFS libraries, codecs,
  and Wasm resources into one HTML file.

`core.k` defines the fixed `pattern[]` schema used to decode a stream's leading
pattern value. This does not automatically import the library into user scope.

The [wire specification](../codecs/WIRE_FORMAT.md) and
[codec authoring guide](CODECS.md) define these boundaries.
Verification commands and suite registration are in [tests/README.md](../tests/README.md).
