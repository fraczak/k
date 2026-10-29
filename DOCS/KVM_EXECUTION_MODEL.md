# kVM execution

[kvm.mjs](../kvm.mjs) lowers KIR-P into register instructions, interprets them,
and specializes polymorphic templates for input envelopes. Wasm and LLVM use
this representation for target lowering.

## Artifacts and functions

Artifacts have `format: "k-vm"` and `version: 1`:

- `layer: "KVM-P"` is a polymorphic template containing principal contracts
  and instruction streams.
- `layer: "KVM"` is a specialized execution artifact.

`objectToKVMArtifact` produces the artifact form.
`lowerKIRRelationToKVM` lowers one portable relation.
`lowerToKVM` supports the compiled relation interface.

Functions record their name, input/output patterns, convergence flag, and
instruction body. Calls use relation names/hashes in the artifact's function
table. Function and branch bodies receive their input through `%in`;
temporary registers use names such as `%v0`.

See [file formats](FILE_FORMATS.md) for CLI compilation and execution.

## Instructions

The current lowerer emits:

| Instruction | Operation |
| --- | --- |
| `id` | Forward a register |
| `fail` | Return ordinary partial failure |
| `guard_pattern` | Constrain a value with a pattern |
| `guard_code` | Check a closed schema |
| `project_field` | Select a labeled product child |
| `project_variant` | Select a matching variant payload |
| `make_variant` | Wrap a value with a tag |
| `call` | Invoke another relation |
| `call_intrinsic` | Invoke an explicitly registered intrinsic |
| `product` | Evaluate labeled branch bodies and build a product |
| `union` | Try branch bodies in source order |
| `return` | Return a register |

For example, `{ .x a, .y b }` becomes a product instruction with one branch
projecting `x` and another projecting `y`. Each branch receives the original
input. Registers use names such as `%v0`.

## Partiality and ordering

Composition stops when a step is undefined. A product succeeds only when all
field branches succeed. A union returns the first defined branch in source
order; if none succeed, it is undefined.

The current interpreter evaluates these branches sequentially. Purity alone
does not permit committing a later branch while an earlier branch diverges.
The representation does not require a parallel task scheduler.

A contradiction between the supplied envelope and static constraints is a type
error, not ordinary branch failure. Unsupported intrinsics must be diagnosed
explicitly rather than inferred from identifier spelling.

## Specialization

`specializeKVM(template, inputPattern)` checks the supplied input envelope
against the principal contract, propagates pattern information through the
instruction stream, derives output patterns, folds proven guards, and prunes
unreachable branches.

The specialized artifact retains boundary patterns. An envelope-free evaluator
can then avoid per-operation pattern propagation, while the caller validates
inputs and attaches the output envelope.

This pass is distinct from
[KIR-P envelope specialization](KIR_V1.md#envelope-specialization), which can
rerun source-level contract derivation.

## Execution modes and backends

`executeKVM` supports envelope-aware evaluation and an envelope-free option.
The latter requires compatible converged contracts and explicit execution
context for referenced functions.

- [Wasm](../backends/wasm/README.md) maps instructions to locals/blocks and an
  arena in linear memory.
- [LLVM](../backends/llvm/README.md) emits target functions and uses the C
  runtime.
- [PKIR](POLYMORPHIC_IR.md) has a separate layout-oriented instruction set
  and a lowering adapter to kVM.

The representation preserves branch order and partial failure across these
paths. It does not specify a universal pointer layout for every backend.

## Verification

`tests/test-kvm.mjs` checks instructions and reference parity.
`tests/test-kvm-polymorphic.mjs` checks template emission, specialization,
envelope mismatch, branch pruning, and CLI behavior. Both run under `npm test`.
The separate backend suites validate target execution.
