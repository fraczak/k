# Technical Debt

## Polymorphic Input Retyping for Precompiled Wasm

`k-wasm` can retype a polymorphic program when it compiles and runs in one step:
the CLI decodes the input stream first, intersects the program input pattern with
the input value envelope, and compiles a specialized WebAssembly module for that
run.

`k-wasm-run` cannot currently do the same for an already compiled `.wasm`
artifact. By the time the runner sees the input envelope, the k program has
already been lowered to WebAssembly and the artifact only carries metadata such
as the generic input/output patterns. The original source/object relation graph
needed to re-run type derivation is not available.

This means precompiled artifacts can execute polymorphic programs, but their
output envelopes are limited to the generic artifact metadata rather than being
retyped against each input envelope.

One possible fix is to delay compilation for programs with polymorphic input
until the input envelope is available. That could mean storing enough source,
object, or typed relation data in the artifact to specialize on first run, or
using a separate artifact form for deferred compilation.

## Wasm Arena Memory Management

The WebAssembly backend currently uses a bump arena for all product and variant
values created during execution. This keeps allocation cheap and simple, and
failed union branches can roll the arena back to a checkpoint, but successful
paths do not reclaim temporary values until the whole run ends.

Tail-call lowering now avoids allocating replacement input products for some
self-tail-recursive loops by keeping top-level product fields in Wasm locals.
Furthermore, self-tail-recursive loops now incorporate threshold-based arena
compaction: when arena growth within a tail loop exceeds 1 MB, live accumulator
and argument graphs are compacted down to the loop entry mark using an iterative
staging-and-copy mechanism in `runtime.wat`, freeing dead scratch data while
preserving performance for hot short-lived loops.

Additionally, linear memory exhaustion and 32-bit unsigned offset overflow are
now tracked explicitly via exported flags (`oom_flag`, `oom_size`) in `runtime.wat`,
which the JS runtime intercepts to throw a descriptive `OutOfMemoryError` instead
of an untyped `unreachable` trap.

Remaining memory-management targets:

- Add allocation profiling that attributes arena growth to generated relations
  and static allocation sites. Large regressions should be visible without
  manually instrumenting `factorial:o` or similar workloads.
- Extend local-loop lowering beyond top-level product fields. Hot tail loops
  should keep common accumulator state in locals where possible and materialize
  arena values only at function boundaries or observable return points.
- Introduce safe lifetime boundaries for successful non-tail calls. The runtime
  needs a way to reclaim scratch values after a callee result has been consumed
  without copying large live values on every call.
- Keep unsigned pointer handling explicit. Wasm arena addresses are `i32`
  offsets, and JavaScript sees exported `i32` values as signed numbers, so all
  JS-side arena offsets must be normalized before `DataView` access.
