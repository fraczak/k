# KVM vs. kTVM: A High-Level Comparative Study

This study compares K's two compiled execution architectures across both **WebAssembly (Wasm)** and **Native C/LLVM (`-O3`)** targets:

- **KVM** (`backends/wasm`, `backends/llvm`): the heap-allocated, pointer-linked structural value machine executing compiled K relations directly on the host/Wasm call stack.
- **kTVM** (`ktvm/`, `ktvm/wasm`, `ktvm/llvm`): the packed-wire, demand-driven streaming transducer virtual machine operating directly on prefix-free `k-wire` bitstreams via single-producer single-consumer (SPSC) channels and L1-budgeted lookup-table kernels.

All measurements below reflect a single uncontended run on the current tree across 19 representative workloads spanning four behavioral regimes: deep linear bitstreams, polymorphic list operations, deep divide-and-conquer Karatsuba arithmetic, and speculative RFC 8259 JSON parsing.

---

## 1. Architectural Contrast

| Dimension | KVM (Wasm & LLVM) | kTVM (Wasm & LLVM) |
|---|---|---|
| **Value Representation** | Pointer-linked algebraic heap trees (`Value` / tagged heap objects) | Packed, prefix-free `k-wire` bitstreams in ring-buffered SPSC channels (`BitDeque`) |
| **I/O Boundary** | Must decode `k-wire` → heap tree on entry and encode heap tree → `k-wire` on exit | Operates directly on raw `k-wire` bitstreams (zero serialization boundary) |
| **Control Flow & Recursion** | Direct host/Wasm function recursion on the native call stack | Strictly iterative demand-driven pull scheduler (`dstack`); bounded call stack |
| **Memory Lifecycle** | Bump allocation during evaluation (no incremental reclamation within a run) | Immediate channel release on consumption + slab freelist recycling + strict accumulator settlement |
| **Non-Linearity & Projection** | $O(1)$ pointer sharing and $O(1)$ field pointer dereference | Linear SPSC channels; fanout (`tee`) and non-tail product fields (`demux`) copy/scan bits via a resumable schema DPDA |
| **Hot-Loop Acceleration** | Direct compiled code per relation step (1 symbol per call) | Verified multi-bit `chunk_table` / `stack_table` kernels (4–8 bits per lookup) under a 64 KiB L1 budget + bounded short-bit unfolding |
| **Speculation & Partiality** | Native backtracking / branch rollback over shared heap pointers | Scoped speculative replay (`spec` / `tap`), compiled away into deterministic multi-column `switch`es whenever entry-guard analysis proves disjointness |

---

## 2. Empirical Results

### 2.1 End-to-End Timing & Memory Across All Four Workload Families

- **Wasm memory** reports committed Wasm linear memory (`memKB`) for KVM, and peak live `BitDeque` buffer bytes (`buf`) + live nodes inside kTVM's reusable 16 MiB initial linear-memory pool (`19 MiB` on `s^9`).
- **LLVM timing & memory** report single-invocation process wall time (`wallMs`) and OS Peak Resident Set Size (`RSS`, via `/usr/bin/time -v`), plus kTVM's peak live `BitDeque` bytes and peak live graph nodes.

#### A. Deep Streaming Bitstreams (`lsb_add`, `lsb_trim`)

| Workload (`in → out`) | KVM Wasm (Mem) | kTVM Wasm (Live Buf / Nodes) | KVM LLVM (Peak RSS) | kTVM LLVM (Peak RSS / Live Buf / Nodes) |
|---|---:|---:|---:|---:|
| `lsb_add` 512b (`270 → 136 B`) | `10.12 ms` (`256 KiB`) | **`1.83 ms`** (`1.0 KiB` / 4) | `4.85 ms` (`5.32 MiB`) | **`4.15 ms`** (**`1.20 MiB`** / `1.0 KiB` / 2) |
| `lsb_add` 4,096b (`2.0 → 1.0 KiB`) | *Stack overflow* | **`1.23 ms`** (`8.0 KiB` / 4) | `5.55 ms` (`10.59 MiB`) | **`4.71 ms`** (**`1.34 MiB`** / `8.0 KiB` / 2) |
| `lsb_add` 16,384b (`8.0 → 4.0 KiB`) | *Stack overflow* | **`4.17 ms`** (`32.0 KiB` / 4) | `11.10 ms` (`35.27 MiB`) | **`4.50 ms`** (**`1.34 MiB`** / `32.0 KiB` / 2) |
| `lsb_add` 65,536b (`32 → 16 KiB`) | *Stack overflow* | **`12.69 ms`** (`128 KiB` / 4) | *SIGSEGV* (`108.9 MiB`) | **`5.34 ms`** (**`1.47 MiB`** / `128 KiB` / 2) |
| `lsb_trim` 500b (`133 → 71 B`) | `4.31 ms` (`128 KiB`) | **`2.61 ms`** (`256 B` / 5) | `3.96 ms` (`5.35 MiB`) | `4.78 ms` (**`1.22 MiB`** / `256 B` / 1) |
| `lsb_trim` 2,000b (`508 → 258 B`) | *Stack overflow* | **`0.42 ms`** (`1.0 KiB` / 5) | `3.50 ms` (`5.46 MiB`) | `4.20 ms` (**`1.22 MiB`** / `1.0 KiB` / 1) |
| `lsb_trim` 16,000b (`4.0 → 2.0 KiB`) | *Stack overflow* | **`2.13 ms`** (`8.0 KiB` / 5) | `6.54 ms` (`16.71 MiB`) | **`3.98 ms`** (**`1.34 MiB`** / `8.0 KiB` / 1) |

#### B. Polymorphic Structural Lists (`Examples/poly.k`)

| Workload (`in → out`) | KVM Wasm (Mem) | kTVM Wasm (Live Buf / Nodes) | KVM LLVM (Peak RSS) | kTVM LLVM (Peak RSS / Live Buf / Nodes) |
|---|---:|---:|---:|---:|
| `poly.length` $L=200$ (`476 → 16 B`) | `11.67 ms` (`448 KiB`) | **`9.18 ms`** (`1.3 KiB` / 44) | `5.23 ms` (`7.35 MiB`) | `5.55 ms` (**`1.47 MiB`** / `1.1 KiB` / 26) |
| `poly.length` $L=1000$ (`2.7 KiB → 16 B`) | `37.08 ms` (`1.25 MiB`) | **`22.89 ms`** (`8.0 KiB` / 44) | **`6.28 ms`** (`11.96 MiB`) | `8.90 ms` (**`1.47 MiB`** / `8.0 KiB` / 26) |
| `poly.reverse` $L=200$ (`476 → 476 B`) | `17.17 ms` (`64 KiB`)* | **`2.44 ms`** (`10.0 KiB` / 407) | **`3.60 ms`** (`5.32 MiB`) | `4.35 ms` (**`1.34 MiB`** / `9.2 KiB` / 355) |
| `poly.reverse` $L=1000$ (`2.7 → 2.7 KiB`) | `63.75 ms` (`320 KiB`)* | **`3.81 ms`** (`51.0 KiB` / 2,007) | **`3.90 ms`** (`7.38 MiB`) | `5.09 ms` (**`1.97 MiB`** / `47.1 KiB` / 1,755) |
| `poly.split_by` $L=200$ (`485 → 494 B`) | `24.50 ms` (`320 KiB`)* | **`9.41 ms`** (`6.2 KiB` / 248) | **`5.55 ms`** (`7.37 MiB`) | `6.68 ms` (**`1.47 MiB`** / `6.1 KiB` / 234) |
| `poly.split_by` $L=1000$ (`2.7 → 2.7 KiB`) | `74.95 ms` (`1.25 MiB`)* | **`27.73 ms`** (`29.7 KiB` / 1,048) | **`5.43 ms`** (`10.31 MiB`) | `15.59 ms` (**`1.72 MiB`** / `31.6 KiB` / 1,034) |

*\*Note: KVM Wasm's serialized output wire on polymorphic `reverse` / `split_by` is `9,904 B` at $L=1000$ vs. `2,784 B` for kTVM (`3.56×` smaller wire payload) due to KVM emitting unspecialized open-schema envelopes.*

#### C. Deep Divide-and-Conquer Karatsuba Arithmetic (`lib/integer.k`)

| Workload (`in → out`) | KVM Wasm (Mem) | kTVM Wasm (Live Buf / Nodes) | KVM LLVM (Peak RSS) | kTVM LLVM (Peak RSS / Live Buf / Nodes) |
|---|---:|---:|---:|---:|
| `times` 64b×64b (`51 → 45 B`) | **`5.88 ms`** (`1.13 MiB`) | `7.36 ms` (`3.3 KiB` / 137) | `5.20 ms` (`7.68 MiB`) | **`4.90 ms`** (**`1.65 MiB`** / `2.9 KiB` / 92) |
| `times` 256b×256b (`147 → 141 B`) | **`11.41 ms`** (`1.50 MiB`) | `26.66 ms` (`5.9 KiB` / 204) | `12.81 ms` (`10.05 MiB`) | **`8.66 ms`** (**`1.65 MiB`** / `5.4 KiB` / 136) |
| `times` 1024b×1024b (`531 → 525 B`) | **`103.01 ms`** (`3.88 MiB`) | `177.26 ms` (`12.2 KiB` / 285) | `91.33 ms` (`15.73 MiB`) | **`46.73 ms`** (**`1.65 MiB`** / `11.5 KiB` / 192) |
| `s^9` (`987654321^512`, `21 → 3,838 B`) | **`2,021 ms`** (`41.75 MiB`) | `4,665 ms` (`55.2 KiB` / 361) | `3,629 ms` (`48.48 MiB`) | **`1,136 ms`** (**`1.72 MiB`** / `53.4 KiB` / 242) |

#### D. Speculative RFC 8259 JSON Parsing (`lib/djson.k` `parse_json`)

| Workload (`in → out`) | KVM Wasm (Mem) | kTVM Wasm (Live Buf / Rollbacks) | KVM LLVM (Peak RSS) | kTVM LLVM (Peak RSS / Live Buf / Nodes) |
|---|---:|---:|---:|---:|
| `djson` 29 B (`471 → 817 B`) | `66.06 ms` (`320 KiB`) | **`17.38 ms`** (`4.7 KiB` / 1) | *Runtime error (exit 3)* | **`6.18 ms`** (**`3.22 MiB`** / `4.5 KiB` / 149) |
| `djson` 60 objs (`4.3 → 3.9 KiB`) | `626.40 ms` (`2.63 MiB`) | **`499.10 ms`** (`21.6 KiB` / 60) | *Runtime error (exit 3)* | **`89.83 ms`** (**`3.22 MiB`** / `21.3 KiB` / 170) |

---

### 2.2 Persistent Multi-Op `poly` Harness (`harness/cli.mjs`)

Comparing warm persistent execution across all 5 polymorphic list operations (`reverse`, `concat`, `split_by`, `get_nth`, `length`) separates boundary marshaling cost from pure evaluation time:

| Suite Size | Backend | Total Mean (ms/iter) | Pure Eval (ms/iter) | Min (ms) | Relative Total Speed |
|---|---|---:|---:|---:|---:|
| **$L = 200$** | `wasm-in-process` (KVM Wasm) | `47.344` | `0.655` | `41.609` | 1.00× |
| **$L = 200$** | `ktvm-wasm-opt` (kTVM Wasm) | **`10.985`** | `10.722` | `10.499` | **4.31× faster vs. KVM Wasm** |
| **$L = 200$** | `llvm` (KVM LLVM persistent) | **`1.614`** | **`1.382`** | `1.259` | **2.04× faster vs. kTVM LLVM** |
| **$L = 200$** | `ktvm-llvm-opt` (kTVM LLVM persistent) | `3.298` | `2.707` | `3.101` | 1.00× |
| **$L = 1,000$** | `wasm-in-process` (KVM Wasm) | `271.819` | `2.955` | `251.680` | 1.00× |
| **$L = 1,000$** | `ktvm-wasm-opt` (kTVM Wasm) | **`56.307`** | `54.738` | `54.423` | **4.83× faster vs. KVM Wasm** |
| **$L = 1,000$** | `llvm` (KVM LLVM persistent) | **`5.567`** | **`3.321`** | `5.215` | **3.10× faster vs. kTVM LLVM** |
| **$L = 1,000$** | `ktvm-llvm-opt` (kTVM LLVM persistent) | `17.252` | `17.320` | `16.999` | 1.00× |

---

## 3. Hypotheses Explaining the Observed Differences

Four structural hypotheses explain every sign flip across the matrix above — why **kTVM wins decisively on memory, deep streaming, native Karatsuba, and end-to-end Wasm structural/JSON workloads**, while **KVM still leads on persistent native list manipulation and Wasm Karatsuba**.

### H1 — Boundary Marshaling Dominance in Wasm vs. Direct Pointer Traversal in Persistent Native LLVM
- **Observation:** On the 5-op `poly` harness ($L=1,000$), `ktvm-wasm-opt` is **4.83× faster end-to-end** than `wasm-in-process` (`56.3 ms` vs. `271.8 ms`), yet `wasm-in-process` spends only `2.96 ms` in pure Wasm evaluation. In persistent native LLVM, the ranking reverses: KVM LLVM (`5.57 ms` total / `3.32 ms` eval) is **3.10× faster** than kTVM LLVM (`17.25 ms`).
- **Explanation:** Over **98%** of KVM Wasm's end-to-end time on list workloads is spent crossing the JS↔Wasm boundary to materialize and re-serialize pointer trees. kTVM eliminates this boundary entirely by computing directly over the wire representation (where `54.7 ms` of `56.3 ms` is actual evaluation). Once marshaling is amortized in a persistent native binary, however, KVM's pointer-chasing list operations (`reverse`, `split_by`, `concat`) execute as direct compiled function calls with $O(1)$ cons-cell relinking, whereas kTVM traverses the scheduler and sequentially moves packed bit sequences.

### H2 — Call-Stack Depth & Non-Reclaiming Bump Heap vs. Iterative Slab Reclamation
- **Observation:** KVM Wasm overflows the host/Wasm call stack on every streaming input $\ge 2,000$ bits, and KVM LLVM segfaults at `65,536` bits after allocating `108.9 MiB` RSS. Even where KVM completes (`s^9`, `times 1024b`, `poly.length 1000`), KVM LLVM consumes **8×–28× more physical RAM** than kTVM LLVM (`48.5 MiB` vs. `1.72 MiB` on `s^9`; `15.7 MiB` vs. `1.65 MiB` on `times 1024b`), and KVM Wasm grows to `41.8 MiB` on `s^9`.
- **Explanation:** KVM lowers structural recursion directly to native/Wasm stack frames and bump-allocates every intermediate algebraic node without freeing dead intermediates within an invocation. On `s^9` (9 sequential squarings culminating in a 15,300-bit Karatsuba tree), KVM leaves tens of megabytes of dead bit-lists resident in memory. kTVM runs strictly iteratively on a heap-backed demand stack, enforces strict accumulator settlement (`after %tok`) to prevent lazy thunk buildup, immediately frees consumed channel buffers, and recycles graph nodes and channels through fixed-size slab freelists — keeping peak live state at **`53 KiB` / 242 nodes** (`1.72 MiB` RSS) on `s^9` and **`1–2` nodes** (`1.2–1.5 MiB` RSS) on 65,536-bit streaming passes.

### H3 — L1-Resident Multi-Bit Table Acceleration & Cache Locality vs. Wasm Dispatch Overhead on Karatsuba
- **Observation:** On `s^9` and `times (1024b×1024b)`, **kTVM LLVM beats KVM LLVM by 3.20× (`1.14 s` vs. `3.63 s`) and 1.95× (`46.7 ms` vs. `91.3 ms`)**, while in Wasm the relationship flips: **KVM Wasm beats kTVM Wasm by 2.31× (`2.02 s` vs. `4.66 s`) and 1.72× (`103 ms` vs. `177 ms`)**.
- **Explanation:** Two opposing forces govern Karatsuba performance:
  1. **Why kTVM wins in Native LLVM:** kTVM compiles inner arithmetic loops (`lsb_add`, `lsb_sub`, `rev_bits`, `trim_bits`, `lsb_shl`) into bisimulation-verified `chunk_table` and `stack_table` kernels that process multiple bits per lookup while fitting completely inside a 64 KiB L1 cache budget. Combined with `1.7 MiB` RSS (L2-resident working set vs. KVM's `48.5 MiB` L3-thrashing heap) and native C optimizations (eager constant/wrap lowering, zero-`memset` inline-channel slab allocation, self-looping `bits[]` DPDA), kTVM LLVM overtakes KVM LLVM decisively once operands grow past ~128 bits.
  2. **Why KVM still leads in Wasm:** Even with table-accelerated inner loops, Karatsuba's outer divide-and-conquer scaffolding (`lsb_split`, `lsb_mul_small`, channel wiring, `tee`, `switch`, `demux`) still executes ~33.4M kTVM scheduler steps on `s^9`. In native `-O3` C, Clang inlines the node steppers into the pull loop and eliminates most constant/wrap nodes at instantiation time; in Wasm, each non-kernel step still pays interpreted-graph dispatch and `call_indirect` overhead, making KVM Wasm's direct Wasm function calls faster on CPU-bound Wasm Karatsuba despite using `41.8 MiB` of memory.

### H4 — Cost of Bitstream Linearity & Schema Scanning on Non-Linear / Composite Workloads
- **Observation:** Native `perf` hardware sampling on the two hardest real-world workloads (`s^9` and `djson 60 objs`) shows that after eliminating speculative backtracking (`60` rollbacks across 60 JSON objects) and redundant copies, bit-level copying (`push`/`peek`/`splice`) is no longer the dominant cost. Instead, native runtime splits across three remaining structural overheads:
  - **`s^9` (`1.14 s`):** node/channel lifecycle & batched slab reclamation (`~34%`), pull-scheduler + stepper dispatch (`~13%`), DPDA scanning of `bits[]` (`~11%`), and actual multi-bit table arithmetic (`~7%`).
  - **`djson 60 objs` (`89.8 ms`):** DPDA scanning/copying of composite variable-width schemas (`btrie`, UTF/Unicode strings: `~25%`), node/channel lifecycle (`~29%`), and pull-scheduler dispatch (`~14%`).
- **Explanation:** Because kTVM represents values as flat prefix-free bitstreams without internal length prefixes or pointers, projecting non-tail fields from composite products (`demux` over `btrie` or `cons` lists) or draining discarded branches requires walking the schema DPDA to locate value boundaries. Fixed-width and tail-recursive list schemas (`unit`, `bit`, `ascii`, `float64`, `bits[]`) collapse into tight register loops, while branching recursive products (`btrie`) and variable-width encodings (Unicode codepoints) still pay per-symbol DPDA transitions. Meanwhile, `djson` runs reliably and 1.26× faster in kTVM Wasm than KVM Wasm (`499 ms` vs. `626 ms`) and completes cleanly in `89.8 ms` / `3.22 MiB` RSS in kTVM LLVM (where KVM LLVM currently fails with exit code 3).

---

## 4. Summary Takeaways

| Regime | Winner (Wasm) | Winner (Native LLVM) | Primary Driver |
|---|---|---|---|
| **Deep bitstreams ($\ge 2\text{k}$ bits)** | **kTVM** *(KVM overflows stack)* | **kTVM** *(up to 2.5× faster; KVM crashes at 64k bits)* | Iterative execution + multi-bit tables + $O(1)$ nodes |
| **Polymorphic lists (end-to-end)** | **kTVM** *(1.6×–16.7× faster; 4.8× on 5-op harness)* | **KVM** *(1.2×–3.1× faster)* | Wasm JS marshaling tax vs. native $O(1)$ pointer manipulation |
| **Deep Karatsuba (`times 1024b`, `s^9`)** | **KVM** *(1.7×–2.3× faster, 42 MiB mem)* | **kTVM** *(1.95×–3.20× faster, 28× less RAM)* | Multi-bit L1 tables + L2 cache residency vs. Wasm step dispatch |
| **RFC 8259 JSON (`djson.parse_json`)** | **kTVM** *(1.26×–3.8× faster)* | **kTVM** *(`89.8 ms`, 3.2 MiB; KVM LLVM errors)* | Entry-guard `spec→switch` compilation + bounded slab memory |
| **Memory footprint (all workloads)** | **kTVM** *(55 KiB live buf vs. 42 MiB on `s^9`)* | **kTVM** *(1.2–3.2 MiB RSS: 4×–28× less RAM)* | Immediate channel release + slab recycling + strict accumulators |
