# KVBF Compiler Plan (LLVM IR in Python)

## Scope and goals

We will build a small Python compiler that consumes and produces KVBF values.
The compiler should be able to decode/encode KVBF, operate on typed values,
optionally keep values in DAG-compressed form, and emit LLVM IR for basic
operations.

Early focus:
- Define an ASCII assembly for KVBF values.
- Implement assembly <-> KVBF (bytes) encoder/decoder.
- Integrate DAG compression early (as a core KVBF feature, not optional later).

## Assumptions

- Canonical core encoding is defined in `DOCS/KVBF.md`.
- Types are identified by a 32-byte SHA-256 digest of canonical definitions.
- No external primitive encodings; all data is modeled via k types.

## Workstreams

### 1) KVBF with DAG compression (spec update)

Tasks:
- Decide the on-the-wire DAG representation.
- Define a deterministic DAG encoding (unique for each value).
- Specify back-reference encoding and id assignment.
- Update `DOCS/KVBF.md` to include DAG compression details.

Open questions:
- Should back-reference markers apply at any node or only at roots of subtrees?
- Should the encoder require canonical DAG choice (e.g., share all repeated subtrees)?

Proposed direction (based on `dag-json`):
- Use a structural signature of each subtree to detect duplicates.
- Assign node ids in preorder on first occurrence.
- Emit a 1-bit marker at every node:
  - `0` = inline definition (encode node and children).
  - `1` = back-reference (encode id as ULEB128).
- Require canonical sharing: if a signature was seen before, emit a backref.
  This yields a unique canonical DAG encoding.

### 2) ASCII assembly for KVBF values

Tasks:
- Define a typed value literal (e.g., `@<base56> <value>`).
- Define an explicit DAG surface syntax (labels and references).
- Decide if field order is explicit or always canonicalized on encoding.
- Update or add a parser if needed (in Python or JS) for the assembly.

Candidate syntax (draft only):
- `@<type> <value>` for a typed root.
- `#id = <value>` to bind a subtree.
- `*id` to reference a previously bound subtree.

### 3) Assembly <-> KVBF (bytes)

Tasks:
- Implement a core encoder from typed value AST to KVBF bytes.
- Implement a core decoder from KVBF bytes to typed value AST.
- Add DAG compression in the encoder (deduplicate subtrees by signature/hash).
- Add DAG expansion in the decoder (resolve back-references).
- Add round-trip tests (assembly -> bytes -> assembly).

### 4) Python LLVM pipeline skeleton

Tasks:
- Choose a minimal LLVM IR strategy (e.g., `llvmlite`).
- Define a minimal IR for:
  - reading KVBF bytes into a cursor
  - decoding a union tag
  - projecting a product field
  - emitting a back-reference resolution
- Start with a very small, fixed test type to validate the pipeline.

## Dependencies / external input

We will reuse the DAG compression approach from `dag-json`:
- Structural signatures are computed deterministically.
- Nodes are de-duplicated by signature.
- References are emitted by ids assigned in a stable order.

## Milestones (suggested)

1. DAG spec decision + update `DOCS/KVBF.md`.
2. ASCII assembly spec and parser stub.
3. KVBF encoder/decoder with DAG support (Python).
4. LLVM IR skeleton with a minimal example.

## Next concrete steps

- Bring in the DAG compression approach from `dag-json`.
- Extend KVBF spec accordingly.
- Draft the ASCII assembly grammar (typed value + DAG refs).
