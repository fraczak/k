# Profiling and benchmarks

Benchmarks compare reference JavaScript, kVM, Wasm, LLVM, and PKIR execution.
Run commands from the repository root; LLVM lanes need Clang.

## Entry points

| Command | Workload |
| --- | --- |
| `npm run compare` | Shared harness for polymorphic list operations |
| `npm run perf:poly` | List operations across execution lanes |
| `npm run perf:poly:trace` | List timing phases and call profiles |
| `npm run perf:int` | Integer arithmetic |
| `npm run perf:ieee` | Binary64 arithmetic |
| `npm run perf:mult` | Multiplication algorithm comparison |
| `npm run benchmark` | End-to-end artifact/execution measurements |
| `npm run benchmark:html` | Render generated benchmark-results.json |

Use each script's `--help` for its flags and environment variables. For a small
list trace:

```sh
ITERATIONS=1 LIST_LENGTH=10 npm run perf:poly:trace
```

`LIST_LENGTH` and `ITERATIONS` set workload and sample counts.
`TRACE_SAMPLES` controls trace repetitions. `WASM_ONLY=1` or `LLVM_ONLY=1`
selects a target; `BACKENDS_ONLY=1` skips native JavaScript baselines in the
performance scripts. Available lanes vary by tool.

The shared harness also supports explicit conformance and profile modes:

```sh
npm run compare -- --listLength 10 --iterations 1
npm run compare -- --listLength 10 --conformance
npm run compare -- --listLength 10 --profile
```

Inspect per-backend status: a tool can report an unavailable or failed lane
while continuing measurements for others.

## What the timings mean

End-to-end request time can include:

1. process input and output;
2. wire decoding and encoding;
3. conversion to/from a target arena;
4. relation evaluation.

In-process Wasm measurements and persistent LLVM executables have different
boundary costs. Compare evaluation and end-to-end time separately, and report
workload, engine, warmup, sample count, and machine with results.

Call profiles count relation invocations and tail-loop iterations. Matching
counts can reveal consistent work across backends; they do not prove identical
results or semantic equivalence. Correctness checks must compare outputs and
their envelopes where schema identity matters.

## Implementation

The shared harness lives in [harness/](../harness/).
Wasm profiling globals and arena access are emitted by
[kvm2wasm.mjs](../backends/wasm/src/kvm2wasm.mjs).
The kVM interpreter increments `context.profile` counters, and backend
performance helpers collect profiles and phase timings.

Generated benchmark reports are measurements of a particular run, not language
or performance guarantees. Use the [test suites](../tests/README.md) for
regression verification.
