# Comparison of JSON Approaches in k

This document compares the four JSON codec and schema implementations in
the **k** repository:

1. **Schema-Specializing JSON** (`json`):
   [`codecs/json.mjs`][json-mjs]
2. **Dynamic Cons-List JSON** (`djson`):
   [`codecs/djson.mjs`][djson-mjs] & [`Examples/djson.k`][djson-k]
3. **Dynamic Binary Bit-Trie JSON** (`djson-btrie`):
   [`codecs/djson-btrie.mjs`][djson-btrie-mjs] &
   [`Examples/djson-btrie.k`][djson-btrie-k]
4. **Dynamic Patricia/Radix Trie JSON** (`djson-ptrie`):
   [`codecs/djson-ptrie.mjs`][djson-ptrie-mjs] &
   [`Examples/djson-ptrie.k`][djson-ptrie-k]

[json-mjs]: file:///home/wojtek/gits/K/k/codecs/json.mjs
[djson-mjs]: file:///home/wojtek/gits/K/k/codecs/djson.mjs
[djson-k]: file:///home/wojtek/gits/K/k/Examples/djson.k
[djson-btrie-mjs]: file:///home/wojtek/gits/K/k/codecs/djson-btrie.mjs
[djson-btrie-k]: file:///home/wojtek/gits/K/k/Examples/djson-btrie.k
[djson-ptrie-mjs]: file:///home/wojtek/gits/K/k/codecs/djson-ptrie.mjs
[djson-ptrie-k]: file:///home/wojtek/gits/K/k/Examples/djson-ptrie.k

---

## 1. Architectural Motivation

In **k**, all values are algebraic data types classified by closed type
patterns. External formats like JSON can be embedded into **k** via two
fundamentally distinct strategies:

### Static Schema Specialization (`json`)
- Infers a concrete closed pattern specialized to the exact shape and
  field names of each input JSON document.
- Objects become concrete labeled products `{ "name": Str, "age": Num }`.
- Lists become homogeneous or heterogeneous tuples/cons-lists.
- **Advantage**: Zero interpretive overhead for known static schemas;
  direct field projection in compiled code.
- **Limitation**: The pattern is dynamic and grows unboundedly with the
  document. Cannot write universal JSON transformation relations (like a
  generic JSON query engine or REPL printer) under a single fixed closed
  pattern.

### Dynamic Uniform JSON (`djson*` family)
- Defines a single, fixed closed pattern `json?` once for all valid JSON
  values. Any arbitrary JSON document parses into an injection of this
  universal pattern.
- Allows authoring universal helper relations in `k`:
  - `dot: {key, object} -> val`
  - `has_key?: {key, object} -> ()`
  - `nth: {index, list} -> val`
  - `obj_size: object -> bits?`
  - `list_size: list -> bits?`
  - `remove: {key, object} -> object`
  - `put: {key, val, object} -> object`
- Compiles once to Wasm or LLVM `-O3` binaries that execute over any
  input JSON document without recompilation.

---

## 2. Structural Schema Comparison

| Dimension | `djson` (Cons) | `djson-btrie` | `djson-ptrie` |
| :--- | :--- | :--- | :--- |
| **Nodes** | 29 | 27 | 33 |
| **Numbers** | float64 | float64 | float64 |
| **Strings** | Cons-list | Cons-list | Cons-list |
| **Lists** | Cons-list | Bit-trie | Patricia trie |
| **Objects** | Sorted cons | Bit-trie | Radix trie |
| **Node** | `{car, cdr}` | `{val, 0, 1}` | `{pfx, sz, val, d}` |
| **Indexing**| $O(N)$ linear | $O(\log N)$ | $O(\log N)$ |
| **Lookup** | $O(K \cdot L)$ | $O(L \cdot 8)$ | $O(L)$ radix |
| **Size** | $O(N)$ walk | $O(N)$ walk | **$O(1)$** field |

### Schema Definitions

#### Dynamic Cons-List (`djson`)
```k
LIST = < {} nil, { JSON car, LIST cdr } cons >;
ENTRY = { Str key, JSON val };
OBJECT = < {} nil, { ENTRY car, OBJECT cdr } cons >;
```

#### Dynamic Binary Bit-Trie (`djson-btrie`)
```k
TRIE = <
  {} nil,
  { < {} nil, JSON val > val, TRIE 0, TRIE 1 } trie
>;
LIST = TRIE;
OBJECT = TRIE;
```

#### Dynamic Patricia/Radix Trie (`djson-ptrie`)
```k
LIST = <
  {} nil,
  {
    BITS prefix,
    BITS size,
    < {} nil, JSON val > val,
    LIST 0,
    LIST 1
  } trie
>;
DICT = < {} nil, { { CHAR char, OBJECT trie } car, DICT cdr } cons >;
OBJECT = <
  {} nil,
  { Str prefix, BITS size, < {} nil, JSON val > val, DICT dict } trie
>;
```

---

## 3. Algorithmic Mechanics

### 3.1 Object Key Lookup (`dot`)
- **`djson`**: Iterates through a linked list of `{key, val}` pairs.
  On each entry, performs character-by-character string equality
  `eq_string?`. For $N$ entries with key length $L$, worst-case time is
  $O(N \cdot L)$.
- **`djson-btrie`**: Uses `step_char` to walk 8 to 24 bits directly down
  the binary trie per character. Because character bits are decoded
  destructively into branch selectors without allocating `bits?` nodes,
  it executes with **zero heap allocations** in compiled LLVM code.
- **`djson-ptrie`**: Matches the query key against the node's `prefix`
  run using `match_str_prefix`. If the prefix matches, it looks up the
  next branching character in a small local `dict` cons-list.
  Non-branching paths of arbitrary length are traversed in one step.

### 3.2 Key Membership (`has_key?`)
- **Hit**: All three navigate to the target key.
- **Miss**:
  - `djson` scans all $N$ entries to the end of the cons-list.
  - `djson-btrie` and `djson-ptrie` terminate immediately as soon as a bit
    or character branch is missing, achieving sub-microsecond rejection
    even on large documents.

### 3.3 Array Indexing (`nth`)
- **`djson`**: Decodes a `bits?` natural number with `dec_nat` and walks
  cons cells one by one ($O(I)$).
- **`djson-btrie`**: Dispatches directly on the bits of the index from
  most-significant to least-significant bit ($O(\log I)$).
- **`djson-ptrie`**: Compares the remaining index bits against the
  node's `prefix: BITS` in chunks, descending along compressed paths
  ($O(\log I)$).

### 3.4 Subtree Cardinality (`obj_size`, `list_size`)
- **`djson` & `djson-btrie`**: Must recursively traverse the entire cons
  list or bit-trie, adding 1 for each present entry using binary addition
  (`inc_nat`). Complexity is $O(N \log N)$.
- **`djson-ptrie`**: Stores a precomputed binary natural number
  `size: BITS` at every node. Size queries are simple $O(1)$ field
  projections (`ptrie_obj? < /nil 0, /trie .size >`). In LLVM `-O3`, this
  executes in **5 nanoseconds**, independent of document size.

### 3.5 Functional Updates (`remove`, `put`)
- **`djson`**: Copies the cons spine until the modified entry ($O(N)$).
- **`djson-btrie`**: Rebuilds the bit path down to the leaf. `put` uses
  `str_to_bits` to construct the bit path, while `remove` clears `.val` to
  `nil` along the path.
- **`djson-ptrie`**:
  - `remove` checks `has_key?`, decrements `size` with `dec_nat` along
    the path, and clears `.val` to `nil`.
  - `put` uses `split_str_prefix` to find the common prefix between the
    new key and existing node. If prefixes diverge, it splits the node
    into a shared parent with a 2-entry branch dictionary in $O(L)$ time.

---

## 4. Empirical Benchmark Results

Measured with `npm run perf:djson` on Linux x86_64 across sizes
$N \in \{10, 100, 500\}$.

### 4.1 Wire Representation Sizes

#### Shared-Prefix Objects (`{"field_prefix_0000": 0, ...}`)
- **$N = 10$** (Raw: 230 B):
  - `djson`: 1,029 B (4.47x)
  - `djson-btrie`: **913 B (3.97x)**
  - `djson-ptrie`: 1,032 B (4.49x)
  - `json` (Spec): 370 B (1.61x)
- **$N = 100$** (Raw: 2,750 B):
  - `djson`: 3,365 B (1.22x)
  - `djson-btrie`: **2,096 B (0.76x)**
  - `djson-ptrie`: 2,367 B (0.86x)
  - `json` (Spec): 1,529 B (0.56x)
- **$N = 500$** (Raw: 14,750 B):
  - `djson`: 14,357 B (0.97x)
  - `djson-btrie`: **7,370 B (0.50x)**
  - `djson-ptrie`: 8,241 B (0.56x)
  - `json` (Spec): 7,229 B (0.49x)

#### Varied-Key Objects (`{"account_0_account_attr": 0, ...}`)
- **$N = 10$** (Raw: 270 B):
  - `djson`: **1,114 B (4.13x)**
  - `djson-btrie`: 1,460 B (5.41x)
  - `djson-ptrie`: 1,236 B (4.58x)
  - `json` (Spec): 496 B (1.84x)
- **$N = 100$** (Raw: 3,120 B):
  - `djson`: 4,987 B (1.60x)
  - `djson-btrie`: 6,729 B (2.16x)
  - `djson-ptrie`: **4,309 B (1.38x)**
  - `json` (Spec): 4,460 B (1.43x)
- **$N = 500$** (Raw: 16,598 B):
  - `djson`: 22,581 B (1.36x)
  - `djson-btrie`: 28,478 B (1.72x)
  - `djson-ptrie`: **17,036 B (1.03x)**
  - `json` (Spec): 22,104 B (1.33x)

#### Homogeneous Number Arrays (`[0, 3, 6, ...]`)
- **$N = 10$** (Raw: 27 B):
  - `djson`: 880 B (32.6x)
  - `djson-btrie`: **878 B (32.5x)**
  - `djson-ptrie`: 999 B (37.0x)
- **$N = 100$** (Raw: 363 B):
  - `djson`: **1,645 B (4.53x)**
  - `djson-btrie`: 1,666 B (4.59x)
  - `djson-ptrie`: 1,877 B (5.17x)
- **$N = 500$** (Raw: 2,129 B):
  - `djson`: **5,045 B (2.37x)**
  - `djson-btrie`: 5,166 B (2.43x)
  - `djson-ptrie`: 5,776 B (2.71x)

---

### 4.2 Execution Latency Across Backends ($N=500$)

#### Object Lookup (`dot` on last key of 500-key object)
- **Shared-Prefix Keys**:
  - `djson`: Wasm $580.4\ \mu\text{s}$, LLVM $23.6\ \mu\text{s}$
  - `djson-btrie`: Wasm $7.4\ \mu\text{s}$, LLVM **$2.4\ \mu\text{s}$**
  - `djson-ptrie`: Wasm $11.1\ \mu\text{s}$, LLVM $5.1\ \mu\text{s}$
- **Varied Keys**:
  - `djson`: Wasm $26.8\ \mu\text{s}$, LLVM $4.2\ \mu\text{s}$
  - `djson-btrie`: Wasm $10.9\ \mu\text{s}$, LLVM **$3.1\ \mu\text{s}$**
  - `djson-ptrie`: Wasm $10.8\ \mu\text{s}$, LLVM $4.4\ \mu\text{s}$

#### Key Membership Filter (`has_key?` miss on nonexistent key)
- `djson`: Wasm $63.9\ \mu\text{s}$, LLVM $1,168\ \text{ns}$
- `djson-btrie`: Wasm $1,022\ \text{ns}$, LLVM **$466\ \text{ns}$**
- `djson-ptrie`: Wasm $1,908\ \text{ns}$, LLVM $1,228\ \text{ns}$

#### Array Element Lookup (`nth` on index 499 of 500 elements)
- `djson`:
  kVM $10.74\ \text{ms}$, Wasm $97.2\ \mu\text{s}$,
  LLVM $100.7\ \mu\text{s}$
- `djson-btrie`:
  kVM $26.0\ \mu\text{s}$, Wasm $733\ \text{ns}$,
  LLVM **$114\ \text{ns}$** (**881x speedup**)
- `djson-ptrie`:
  kVM $35.7\ \mu\text{s}$, Wasm $1,267\ \text{ns}$,
  LLVM $371\ \text{ns}$ (**271x speedup**)

#### Cardinality Queries (`obj_size` for $N=500$)
- `djson`:
  kVM $13.57\ \text{ms}$, Wasm $89.2\ \mu\text{s}$,
  LLVM $127.4\ \mu\text{s}$
- `djson-btrie`:
  kVM $210.88\ \text{ms}$, Wasm $3.02\ \text{ms}$,
  LLVM $8.06\ \text{ms}$
- `djson-ptrie`:
  kVM $2,054\ \text{ns}$, Wasm $172\ \text{ns}$,
  LLVM **$5\ \text{ns}$** (**26,106x speedup**)

#### Object Key Updates ($N=500$)
- **`remove`**:
  - `djson`: LLVM $79.6\ \mu\text{s}$
  - `djson-btrie`: LLVM **$9.5\ \mu\text{s}$** (8.4x speedup)
  - `djson-ptrie`: LLVM $13.3\ \mu\text{s}$ (6.0x speedup)
- **`put`**:
  - `djson`: LLVM $50.8\ \mu\text{s}$
  - `djson-btrie`: LLVM $12.6\ \mu\text{s}$ (4.0x speedup)
  - `djson-ptrie`: LLVM **$3.9\ \mu\text{s}$** (13.1x speedup)

---

## 5. Trade-off Analysis & Recommendation Matrix

| Feature | `json` | `djson` | `btrie` | `ptrie` |
| :--- | :---: | :---: | :---: | :---: |
| **Universal Pattern** | ❌ No | ✅ 29 | ✅ 27 | ✅ 33 |
| **REPL Inspection** | Native | Cons | Bit-tree | Radix |
| **Shared Prefix Wire**| Small | Med | **Small** | Small |
| **Varied Keys Wire** | Large | Med | Large | **Small** |
| **Array ($N=500$)** | Direct | $100\ \mu\text{s}$ | **114ns**| 371ns |
| **Dot ($N=500$)** | Direct | $23.6\ \mu\text{s}$| **2.4µs**| 5.1µs |
| **Put ($N=500$)** | N/A | $50.8\ \mu\text{s}$| 12.6µs | **3.9µs**|
| **Size ($N=500$)** | N/A | $127\ \mu\text{s}$ | 8.1ms | **5ns** |

### Recommendations
1. **Choose `djson-ptrie` for general-purpose dynamic JSON**:
   It achieves the best wire compression on real-world varied keys
   (1.03x of raw JSON), provides instant $O(1)$ cardinality queries
   (5 ns in LLVM), and delivers the fastest updates (`put` in 3.9 µs).
2. **Choose `djson-btrie` for extreme lookup throughput on shared keys**:
   Destructive bit-walking in `dot` avoids all node allocation,
   achieving the lowest lookup latency (2.4 µs in LLVM).
3. **Keep `djson` for simple, lightweight tooling**:
   Simple cons-list structure is human-readable in REPL raw outputs and
   has minimal code complexity for small payloads ($N < 50$).
4. **Choose `json` when document schema is fixed at compile time**:
   Avoids all dynamic dictionary lookups in exchange for a
   document-specialized pattern.
