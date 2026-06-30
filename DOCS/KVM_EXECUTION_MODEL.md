# kVM Execution Model

This note sketches a low-level execution model for `k`.  The goal is to place
one abstraction exactly between the current JavaScript evaluator and concrete
backends such as LLVM and WebAssembly.

The working name is **kVM**.  It is not primarily a bytecode format.  It is an
execution contract: a small value model, a small instruction set, and precise
rules for partial failure, products, unions, calls, and safe scheduling.

## Position In The Pipeline

The current design already points at three layers:

- KIR-P: portable, polymorphic object IR.
- retyped KIR-P: KIR-P specialized for a concrete input envelope pattern.
- KIR-M: backend material after layout and ABI decisions.

kVM makes KIR-M concrete by lowering KIR-P relation bodies into executable kVM
functions.

```text
k source
  -> AST
  -> type derivation
  -> KIR-P object relation
  -> retyped KIR-P relation instance for an input pattern
  -> kVM function
  -> LLVM / Wasm / C / JS kVM interpreter
```

KIR-P remains the portable semantic object format. Retyping emits ordinary KIR-P
for a concrete input envelope. The kVM lowerer consumes KIR-P and emits the
executable middle form consumed by code generators.

## Design Center

Every `k` relation is a pure first-order partial function:

```text
KRef -> KResult<KRef>
```

where:

- `KRef` is a reference to an immutable runtime value;
- `KResult` is either `ok(value)` or `fail`;
- failure is ordinary partial-function undefinedness, not an exception;
- user-level computation has no mutable environment and no observable effects.

This purity is central.  It means kVM can expose parallel product and
speculative union execution while preserving exactly the same deterministic
semantics as the interpreter.

Current debug or host operations such as `_log!` do not fit the pure backend
contract.  They should either be excluded from kVM backend eligibility or marked
as effectful intrinsics that create ordering barriers.

## Value Model

A kVM value reference should be more abstract than an LLVM pointer but more
explicit than the current JavaScript `Value` object.

```text
KRef {
  repr: serialized | materialized | external,
  addr: backend-specific handle,
  pattern: optional runtime pattern,
  staticPattern: optional kVM pattern id,
  layout: optional layout id,
  ownership: borrowed | owned
}
```

The important property is immutability.  A `KRef` may point into the original
binary input stream, a materialized node, a constructed result, or an external
host value.  Projections can often produce new `KRef`s without allocation.
Construction creates new immutable values.

There are two valid execution modes:

- **Envelope-aware mode**: each `KRef` may carry a runtime pattern, matching the
  current interpreter and codec model.
- **Envelope-free mode**: retyping has proven the input and output patterns for
  every call site, so inner operations use static layouts and attach the derived
  output pattern only at the boundary.

The first mode is the reference path.  The second mode is the main LLVM/Wasm
performance path.

## Function Shape

A kVM relation instance is specialized by relation hash plus input pattern hash:

```text
fn @rel_hash__input_pattern_hash(%input: KRef) -> KResult<KRef>
```

Recursive relations compile to mutually recursive kVM functions.  A single
source relation may produce several kVM functions when called under different
input patterns.

Each kVM function records:

- relation hash;
- input pattern id;
- output pattern id;
- convergence status;
- layout assumptions;
- called relation instances;
- required intrinsics.

LLVM and Wasm backends should reject functions whose relation derivation is not
`converged`, unless they intentionally target the envelope-aware reference mode.

## Core Instructions

kVM should be register-based and block-oriented.  Backends can lower it to LLVM
SSA, Wasm locals and blocks, C temporaries, or a JS interpreter.

Primitive instructions:

```text
id              %v                         -> ok(%v)
fail                                       -> fail
guard_pattern   %v, @pattern               -> ok(%v) | fail
guard_code      %v, @code                  -> ok(%v) | fail
project_field   %v, label_id, layout_hint  -> ok(%child) | fail
project_variant %v, tag_id, layout_hint    -> ok(%child) | fail
make_product    [(label_id, %value), ...]  -> %product
make_variant    tag_id, %value             -> %variant
call            @function, %value          -> ok(%result) | fail
call_intrinsic  @symbol, %value            -> ok(%result) | fail
return          %value                     -> ok(%value)
```

Composition is ordinary control flow: run the next instruction only after the
previous one has returned `ok`.

Filters lower either to `guard_pattern` or disappear after retyping proves that
the guard is redundant.  Type/code expressions lower to guards.  Variant
introduction lowers to `make_variant`.  Product construction lowers to a
product region plus `make_product`.

## Structured Regions

The two important high-level operations should survive lowering into kVM as
structured regions.  They carry semantic information that is easy to lose if
everything is flattened too early.

### Product Region

A product expression applies several functions to the same input and succeeds
only if all of them succeed.

```text
%p = product %input [
  field a: { ... -> ok(%a) | fail }
  field b: { ... -> ok(%b) | fail }
] join all_success
```

Semantics:

1. Every field branch receives the same input `KRef`.
2. If every branch succeeds, the join constructs a product in canonical field
   order.
3. If any branch fails, the whole product fails.
4. For terminating pure branches, branch evaluation order is not observable.

Scheduling:

- A sequential backend may run branches left to right.
- A parallel backend may fork all branches.
- A result-oriented runtime may fail fast and cancel unfinished branches after
  any failure, because failure has no observable payload in release semantics.
- A strict operational runtime should preserve the chosen product evaluation
  order for divergence-sensitive conformance.  It may still run later branches
  speculatively, but it should not expose a later failure while an earlier
  branch is still pending.
- A debug runtime may optionally wait for all branches to report better
  diagnostics.

This is the direct kVM form of parallel composition.

### Union Region

A union expression tries several functions and returns the first successful
branch in source order.

```text
%u = union %input [
  case 0: { ... -> ok(%r0) | fail }
  case 1: { ... -> ok(%r1) | fail }
  case 2: { ... -> ok(%r2) | fail }
] join first_success_by_index
```

Semantics:

1. Every branch receives the same input `KRef`.
2. If no branch succeeds, the union fails.
3. If one or more branches succeed, the result is the successful branch with
   the lowest index.

Scheduling:

- A sequential backend may run branches in source order and stop at the first
  success.
- A parallel backend may speculatively run branches concurrently.
- A parallel backend may return branch `j` only after branch `j` has succeeded
  and every branch `i < j` has failed.
- Once branch `j` is known to be selected, branches `i > j` may be cancelled.
- If any earlier branch is still pending, a later success remains provisional.

This gives concurrency without nondeterminism.  The fastest branch does not win;
the lowest-index successful branch wins.

## Partiality And Cancellation

kVM failure is pure and unobservable except through product and union joins.
That gives simple cancellation laws:

- In a product, one failure is enough to fail the product.
- In a union, a later success is provisional until all earlier branches fail.
- Cancelling an unfinished pure branch cannot change the result.
- Effectful intrinsics are not cancellable unless they declare that property.

These laws are the bridge between mathematical `k` semantics and practical task
schedulers.

There is one important caveat: purity does not by itself erase divergence.  If a
backend must preserve exact operational behavior in the presence of
nontermination, it should use the strict scheduling profile: sequential lowering
is always valid, and speculative parallel work may not commit a result or
failure that an earlier unresolved branch could have prevented.  If the
contract is only result equivalence for terminating computations, product
fail-fast and broader cancellation are valid optimizations.

## Lowering From Retyped KIR-P

Suggested lowering rules:

| KIR operation | kVM lowering |
| --- | --- |
| `identity` | `id` or direct value forwarding |
| `empty` / `<>` | `fail` |
| `filter` | `guard_pattern` or erased if statically proven |
| `code` | `guard_code` or erased if statically proven |
| `dot` | `project_field` |
| `div` | `project_variant` |
| `vid` | `make_variant` |
| `ref` | `call` to a specialized relation instance or `call_intrinsic` |
| `comp` | success-checked sequence |
| `product` | `product` region plus `make_product` |
| `union` | `union` region with `first_success_by_index` join |

The lowerer should preserve labels and tags as table ids, not strings in hot
instructions.  Debug metadata may retain source labels.

## Layout Tables

kVM should not hard-code one memory layout.  It should refer to layout tables
generated from retyped patterns and canonical codes.

Useful tables:

- label table: label string -> label id;
- tag table: tag string -> tag id;
- pattern table: canonical pattern graph ids;
- layout table: product field offsets and union tag dispatch for each static
  pattern/layout;
- intrinsic table: pure host functions and external types;
- relation instance table: `relation hash + input pattern hash -> function id`.

This keeps kVM stable while allowing experiments with serialized, lazy,
materialized, and external value representations.

## Backend Mapping

### LLVM

LLVM can lower each kVM function to a native function returning a `KResult`
struct.  kVM registers map naturally to LLVM SSA values.  Product and union
regions can lower first to ordinary blocks, then later to runtime task calls or
LLVM parallelism experiments.

Baseline product lowering:

```text
run branch 0
if fail return fail
run branch 1
if fail return fail
construct product
return ok
```

Baseline union lowering:

```text
run branch 0
if ok return branch 0
run branch 1
if ok return branch 1
return fail
```

Parallel lowering is an optimization, not a semantic requirement.

### WebAssembly

Wasm can use the same kVM control-flow shape with locals and blocks.  The MVP
path should be sequential.  Wasm threads, shared memory, or host promises can
later implement product and union regions without changing kVM semantics.

The key Wasm constraint is that the kVM instruction set should avoid relying on
arbitrary pointer arithmetic in the IR itself.  Pointer/layout details should
live behind runtime imports or explicit memory-layout helpers.

### JS kVM Interpreter

A JS kVM interpreter is valuable as a conformance oracle.  It can start with
sequential product and union execution, compare results against `run.mjs` and
`run_converged`, then add optional parallel scheduling later.

## Validation Rules

A valid kVM function should satisfy:

1. Every function has one `KRef` input and returns `KResult<KRef>`.
2. Every register is assigned once.
3. Every failure path is explicit.
4. Product field labels are unique and canonical.
5. Union branch order is preserved.
6. Calls target concrete relation instances, not unspecialized source names.
7. Layout hints match the input pattern expected by the instruction.
8. Envelope-free functions are allowed only when every reachable relation
   instance has converged type derivation.
9. Parallel scheduling is allowed only through pure/cancellable regions.

## Example

For a source shape like:

```k
{ .x a, .y b }
```

kVM should keep the parallel product structure:

```text
fn @example(%in):
  %out = product %in [
    field a: {
      %x = project_field %in, label:x
      return %x
    }
    field b: {
      %y = project_field %in, label:y
      return %y
    }
  ] join all_success
  return %out
```

For:

```k
< f, g, h >
```

kVM should keep the deterministic union structure:

```text
fn @choice(%in):
  %out = union %in [
    case 0: { %r0 = call @f__P, %in; return %r0 }
    case 1: { %r1 = call @g__P, %in; return %r1 }
    case 2: { %r2 = call @h__P, %in; return %r2 }
  ] join first_success_by_index
  return %out
```

The runtime may evaluate `f`, `g`, and `h` concurrently, but it may return `g`
only after `f` has failed.

## Open Questions

- Should kVM be serialized as JSON first, or as a compact binary section inside
  `.ko` only after the schema stabilizes?
- Should product fail-fast be the only release behavior, or should there be a
  standard diagnostic mode that collects all failed fields?
- How should effectful debug intrinsics be represented so they cannot silently
  enter parallel backend execution?
- Is `guard_code` needed in the final envelope-free backend path, or should all
  code/type checks be resolved into layout-specific projections and guards?
- Should kVM expose a generic `match` instruction for union dispatch, or are
  `project_variant` plus union regions enough?

## Implementation Order

1. Keep KIR-P as the current object-level relation format.
2. Define a JSON kVM schema for specialized relation instances.
3. Lower KIR-P relation ops to kVM in envelope-aware mode.
4. Add a sequential JS kVM interpreter and compare it against `run.mjs`.
5. Lower retyped/converged relation instances to envelope-free kVM.
6. Add kVM validation and conformance fixtures.
7. Add a minimal C or Wasm backend for sequential kVM.
8. Add LLVM lowering.
9. Add optional runtime scheduling for product and union regions.

The important first milestone is not parallel speed.  It is a stable execution
contract that makes sequential LLVM and Wasm generation boring, while preserving
the parallel structure that `k` gets from purity.
