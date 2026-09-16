# Profiling and Execution Tracing in k

This document describes the performance benchmarking, macro-phase execution tracing,
and function-level call profiling infrastructure for `k` backends.

The profiling framework allows fine-grained performance analysis of polymorphic `k`
programs across multiple execution targets:
- **Linux ARM64** (native standalone ELF executable via direct kVM assembly emission)
- **WebAssembly** (in-process Wasm module via single-pass kVM lowering)
- **LLVM** (native specialized executable via KIR-P lowering)
- **kVM Interpreter** (in-process TypeScript/JavaScript kVM evaluator)
- **Native JS Baselines** (envelope-aware and envelope-free reference runs)

---

## 1. Motivation: Apples-to-Apples Backend Comparison

When measuring end-to-end request latency across backends, wall-clock time can be
dominated by factors outside the core relation algorithm:
- **Process IPC**: Out-of-process native executables (ARM64, LLVM) communicate via stdin/stdout pipes, incurring OS context switches and pipe buffer copies.
- **Wire Codec**: Decoding and validating the binary wire format (`pattern + value`) and encoding the response.
- **In-Memory Representation**: WebAssembly converts incoming values into a flat linear memory arena layout.
- **Pure Evaluation**: The actual relational instruction loop performing the algorithm.

Without detailed accounting, native ARM64 or LLVM binaries communicating over pipes can
appear slower than in-process WebAssembly or the interpreter simply because of IPC overhead.
The tracing infrastructure breaks request latency down into nanosecond-level phases so that
pure execution time can be measured and compared directly.

In addition, **per-function invocation profiling** verifies that every backend performs the
exact same number of relational evaluations and loop iterations for a given input.

---

## 2. Test Workload: Polymorphic List Operations (`Examples/poly.k`)

The primary benchmark for polymorphic kVM execution is [`Examples/poly.k`](../Examples/poly.k),
which defines canonical polymorphic operations over recursive lists:
- `reverse`: Linear reverse using an accumulator.
- `concat`: Polymorphic list concatenation.
- `split_by`: Splits a list at index $N$ into `{ first, second }`.
- `get_nth`: Retrieves the $N$-th element (0-indexed).
- `length`: Computes list length using arbitrary-precision Peano/bit integers.

### Modular Compilation and Name Isolation

`Examples/poly.k` depends on integer and list operations defined in [`Examples/arithmetics.k`](../Examples/arithmetics.k).
Following `k`'s canonical content-addressed design:
- `arithmetics.k` is compiled as a separate library (`--lib`).
- Only required symbols (`0`, `int`, `inc`, `dec`, `nat`, `zero_int?`, `nil`, `cons`, `car`, `cdr`) are exported into `poly.k`'s scope.
- Bitstring `concat` in `arithmetics.k` remains strictly private and does not conflict with polymorphic list `concat` in `poly.k`. Each function receives its own unique canonical content hash.

---

## 3. Macro-Phase Execution Tracing (Level 1)

When tracing is enabled, each request is instrumented to measure 7 discrete phases with nanosecond precision:

| Phase | Description | Linux ARM64 | LLVM | WebAssembly | kVM Interp |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **1. IPC Read (Pipe In)** | Waiting for and reading input payload from stdin | Yes | Yes | N/A (in-process) | N/A (in-process) |
| **2. Wire Decode & Validate** | Decoding wire buffer and validating against pattern | Yes | Yes | N/A (in-process) | N/A (in-process) |
| **3. Flat Input Prep (Arena)** | Flattening decoded structures into linear arena memory | Yes | N/A | Yes | N/A |
| **4. Pure Evaluation** | Core relational execution loop | **Yes** | **Yes** | **Yes** | **Yes** |
| **5. Flat Output Prep (Arena)** | Serializing/reading in-memory representations | Yes | N/A | Yes | N/A |
| **6. Wire Encode** | Encoding result to canonical wire format | Yes | Yes | N/A (in-process) | N/A (in-process) |
| **7. IPC Write (Pipe Out)** | Writing output wire bytes to stdout pipe | Yes | Yes | Yes (driver) | N/A |

### Phase Timing Output Example

```text
--- Operation: reverse (len 40) ---
Phase                    | Linux ARM64   | LLVM          | WebAssembly   | kVM Interp
-------------------------+---------------+---------------+---------------+---------------
1. IPC Read (Pipe In)    |    169.83 µs  |    161.42 µs  |       -       |       -     
2. Wire Decode & Validate |      2.04 µs  |      1.58 µs  |       -       |       -     
3. Flat Input Prep (Arena) |      3.08 µs  |       -       |     80.88 µs  |       -     
4. Pure Evaluation       |      0.46 µs  |      0.54 µs  |      1.71 µs  |     26.04 µs
5. Flat Output Prep (Arena) |      2.67 µs  |       -       |     76.71 µs  |       -     
6. Wire Encode           |      1.96 µs  |      4.88 µs  |       -       |       -     
7. IPC Write (Pipe Out)  |     11.29 µs  |     11.08 µs  |      0.62 µs  |       -     
-------------------------+---------------+---------------+---------------+---------------
Total Request Time       |    191.33 µs  |    179.50 µs  |    159.92 µs  |     26.04 µs
```

**Key Takeaways**:
- **Pure evaluation** in Linux ARM64 native code (`0.46 µs`) is ~3.7× faster than WebAssembly (`1.71 µs`) and ~56× faster than the interpreter (`26.04 µs`).
- **End-to-end request time** for native binaries is dominated by pipe IPC read (`~160–170 µs`).
- **WebAssembly overhead** is concentrated in flat arena conversion (`~80 µs` in, `~76 µs` out).

---

## 4. Per-Function Invocation Profiling (Level 2)

Per-function profiling increments dedicated counters at the entry point of every relation
body and tail-call loop. This proves semantic equivalence across targets by verifying that
every backend executes the exact same call path.

### Function Profile Output Example

```text
  Function Call Profile: reverse
  Function Name            | Linux ARM64 Calls | WebAssembly Calls | kVM Interp Calls
  -------------------------+-------------------+-------------------+------------------
  reverse                  |                 - |                 1 |                1
  _reverse                 |                 - |                41 |               41
  @dhiaXnh7AYZnewyvbXdh... |                 1 |                 - |                -
  @EwQ2P3yZ8v4z2qA7kF...   |                41 |                 - |                -
  car                      |                40 |                40 |               40
  cdr                      |                40 |                40 |               40
  cons                     |                40 |                40 |               40
  nil                      |                 1 |                 1 |                1
  -------------------------+-------------------+-------------------+------------------
  Total Calls              |               163 |               163 |              163
```

*(Note: ARM64 displays canonical content hashes `@hash` for unaliased internal relations.
All three backends arrive at the exact same total call count: 163 calls for reversing a list of length 40).*

---

## 5. Usage & Commands

### Running Benchmarks

```bash
# Standard end-to-end benchmark across all 6 lanes
npm run perf:poly

# Benchmark with macro-phase breakdown tracing and function profiling
npm run perf:poly:trace

# Or run the script directly:
node scripts/perf-poly.mjs --trace
```

### Environment Variables

| Variable | Default | Description |
| :--- | :---: | :--- |
| `LIST_LENGTH` | `40` | Number of elements in test lists. |
| `ITERATIONS` | `3` | Number of iterations for the benchmark summary table. |
| `TRACE_SAMPLES` | `5` | Repetitions sampled and averaged for phase timings. |
| `TRACE` | `0` | Set to `1` (or pass `--trace`) to enable phase breakdown. |
| `PROFILE` | `1` (with trace) | Set to `0` to disable function call counters. |
| `ARM64_OPT` | `-O2` | Optimization level for the native ARM64 runtime (`-O0`, `-O1`, `-O2`, `-O3`). |
| `WASM_RESET` | `1` | Reset the WebAssembly linear memory arena between calls (`1` or `0`). |
| `ARM64_ONLY` | `0` | Run only the Linux ARM64 native target. |
| `WASM_ONLY` | `0` | Run only the WebAssembly target. |
| `LLVM_ONLY` | `0` | Run only the LLVM target. |
| `BACKENDS_ONLY` | `0` | Skip the native JS baseline lanes. |

### Practical Examples

```bash
# Fast smoke check with list length 10 and 1 iteration:
ITERATIONS=1 LIST_LENGTH=10 npm run perf:poly:trace

# Measure high-optimization ARM64 (-O3) vs WebAssembly on large lists (100 elements):
LIST_LENGTH=100 ARM64_OPT=-O3 npm run perf:poly:trace

# Isolate ARM64 native execution:
ARM64_ONLY=1 npm run perf:poly:trace
```

---

## 6. Implementation Architecture

### Linux ARM64 Backend
- **Code Emission** ([`backends/arm64/src/kvm2arm64.mjs`](../backends/arm64/src/kvm2arm64.mjs)): When `options.profile` is active, each function emits counter increment instructions in its entry sequence:
  ```asm
      adrp  x9, k_prof_<func>
      add   x9, x9, :lo12:k_prof_<func>
      ldr   x10, [x9]
      add   x10, x10, #1
      str   x10, [x9]
  ```
  Counters are emitted into a dedicated `.data` section, and an exported metadata table `k_profile_entries[]` is generated.
- **Runtime Reporting** ([`backends/arm64/src/runtime.c`](../backends/arm64/src/runtime.c)):
  - Nanosecond phase timestamps are sampled via `clock_gettime(CLOCK_MONOTONIC, ...)` and emitted over stderr formatted as:
    ```text
    K_TRACE_PHASES backend=arm64 ipc_read_ns=... decode_ns=... flat_in_ns=... eval_ns=... flat_out_ns=... encode_ns=... ipc_write_ns=... total_ns=...
    ```
  - `dump_profile_counts()` emits nonzero function call counts between `K_PROFILE_BEGIN` and `K_PROFILE_END` tags.

### WebAssembly Backend
- **Code Emission** ([`backends/wasm/src/kvm2wasm.mjs`](../backends/wasm/src/kvm2wasm.mjs)): Emits mutable 64-bit Wasm globals:
  ```wat
  (global $prof_<name> (export "prof_<name>") (mut i64) (i64.const 0))
  ```
  Inside the function/tail-loop body, `(global.set $prof_<name> (i64.add (global.get $prof_<name>) (i64.const 1)))` increments the counter.
- **Harness Integration** ([`backends/wasm/tests/perf-support.mjs`](../backends/wasm/tests/perf-support.mjs)): `readWasmProfile` and `resetWasmProfile` read and zero the exported globals directly from the Wasm instance exports.

### kVM Interpreter
- **Evaluation Loop** ([`kvm.mjs`](../kvm.mjs)): When `context.profile` is provided, `executeKVM` resolves the active function name or hash via `context.hashToName` and increments `context.profile[name]`.
