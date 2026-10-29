# Polymorphic IR (PKIR)

PKIR is an experimental execution representation in [pkir.mjs](../pkir.mjs).
It uses schema states and structural access profiles to navigate values through
layout witnesses.

It is separate from [KIR-P](KIR_V1.md), the portable object export, and from
[kVM](KVM_EXECUTION_MODEL.md), the register execution representation used by
the backends.

## Relation artifact

`compileRelationToPKIR(relDef, name)` creates:

```text
format: "pk-ir"
version: 1
name
inputReg / outputReg
inputPattern / outputPattern
patternGraph
accessProfile
instructions
```

The pattern graph supplies relation constraints; the access profile records
which fields and variants each state uses. `.pkir` is the JSON artifact
extension accepted by target tools.

## Access tables and values

`buildAccessTable(schema, pattern)` in
[access-table.mjs](../access-table.mjs) connects an input schema to the relation's
pattern graph. Descriptors map structural accesses to physical slots, child
states, tag identities, and offsets.

The JavaScript adapter `valueToKVal` creates materialized records with
`repr`, `state`, `tag`, and `words`; product records also retain field names.
`kvalToValue` converts these records back to `Value`. The execution code also
has support for serialized representations; use the adapter/codec contracts
rather than assuming that every PKIR value is a native pointer.

## Current instructions

| Instruction | Role |
| --- | --- |
| `id` | Forward a register |
| `fail` | Partial failure |
| `project_slot` | Project a product field through schema/layout information |
| `match_variant` | Extract a matching variant payload |
| `make_variant` | Construct a tagged value |
| `product` | Construct fields through nested instruction streams |
| `union` | Ordered branch selection |
| `call_rel` | Relation call, including recursion |
| `project_offset` | Specialized product access with a resolved offset |
| `match_tag_imm` | Specialized tag match with resolved discriminator information |

Instruction records retain labels/tags where needed for generic adapters.
Do not assume that generic execution universally eliminates string operations.

## Specialization and target lowering

`specializePKIR(pkir, table)` resolves product accesses to `project_offset`,
resolves variant matches to `match_tag_imm`, and removes branches whose
leading operation is known to fail. It returns an artifact with
`isSpecialized: true`.

`executePKIR` interprets generic or specialized instructions with the required
access table and relation context. `lowerPKIRToKVM` adapts instructions for
backend lowering. The shared [backend API](../backend-api.mjs) exports these
functions plus `compileWasmArtifactFromPKIR` and
`compileLLVMArtifactFromPKIR`.

The target CLIs accept `.pkir` files or `--pkir` for compiling source through
this path. See [WebAssembly](../backends/wasm/README.md) and
[LLVM](../backends/llvm/README.md).

Performance depends on the workload, adapter, and execution target. Use the
[benchmark guide](PROFILING_AND_TRACING.md) for measurements rather than
treating historical timings as interface guarantees.

## Verification

`tests/test-access-table.mjs` exercises descriptors and layout mapping.
`tests/test-pkir.mjs` checks execution, specialization, opaque payloads,
partial failure, and target integration. Both are registered in `npm test`.
