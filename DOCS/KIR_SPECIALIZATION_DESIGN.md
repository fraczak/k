# KIR: k Intermediate Representation, Retyping, and Conformance

The document defines an object IR and conformance platform for LLVM and
WebAssembly backends.

## Goals

- Define a portable polymorphic object IR.
- Define retyping for concrete input envelope patterns.
- Define conformance fixtures for interpreter, object execution,
  retyped execution, and future backends.
- Keep `.ko` and `.klib` inspectable.
- Record type-derivation convergence per relation.

## Out of Scope

- LLVM backend design.
- WebAssembly backend design.
- New language syntax.
- Replacing the current JavaScript evaluator.

## Execution Layers

### KIR-P: Polymorphic IR

KIR-P is the portable representation of a k relation. It keeps the current
pattern-carrying execution model.

KIR-P must:

- run any valid k program;
- preserve filters and pattern operations;
- store relation input and output patterns;
- be the canonical `.ko` / `.klib` relation format;
- be the reference for retyping and backend tests.

Alternative:

- Store source and re-run type derivation on load. This gives smaller objects,
  but makes object behavior depend on the compiler version. Do not use this for
  KIR.

### KIR-R: Retyped IR

KIR-R is produced from `KIR-P + input envelope pattern`.

KIR-R must:

- be equivalent to typing the entry expression `?P __main__`;
- derive the output pattern for that invocation;
- validate filters and pattern constraints before value execution;
- preserve the same value-level partial function semantics;
- support multiple pattern contexts for the same helper relation;
- be cacheable by relation hash and input pattern hash.

Alternative:

- Re-run full source compilation for each input pattern. This is acceptable for
  the first prototype, but the public API should still be
  `retype(rel, inputPattern)`.

### KIR-M: Backend IR

KIR-M is produced from KIR-R after call-site pattern contexts, layout, and ABI
decisions are fixed.

KIR-M should:

- use static product field offsets;
- use static union tag dispatch;
- represent partial failure explicitly;
- avoid envelope propagation only where call-site pattern contexts prove it safe;
- require converged type derivation for every compiled relation;
- target LLVM, Wasm, C, or another backend.

Alternative:

- Compile KIR-P directly. This is useful for a correctness experiment, but it
  recreates the polymorphic interpreter and is not the final performance path.

## Object IR

### Step 1: Define KIR-P

Add `DOCS/KIR_V1.md`.

Define:

- top-level object fields: `format`, `codes`, `rels`, `relAlias`,
  `compileStats`, `meta`, and `main`;
- canonical code table;
- polymorphic relation table;
- relation aliases;
- metadata;
- per-relation type-derivation status;
- optional origin source range;
- `.ko` main relation;
- `.klib` null main.

Current storage rules to preserve:

- `.klib` is plain UTF-8 JSON with no binary header;
- `.ko` is a `KOBJ\n` binary container around the JSON payload;
- no payload version field is stored;
- relation `typeDerivation` stores only `status`;
- code entries do not carry `typeDerivation`;
- relation bodies do not store generated input/output boundary filters;
- source ranges live only in metadata origin entries;
- origin entries do not have `kind`; the metadata entry has `type`.

Implementation:

- Add `kir.mjs`.
- Add a converter from current object payloads to KIR-P.
- Keep current object storage until KIR-P is validated.

Alternative:

- Change the stored object JSON immediately. This is less code, but risks
  mixing backend contracts with current JS evaluator internals.

### Step 1a: Record Type-Derivation Status

Each relation definition should carry:

```json
{
  "typeDerivation": {
    "status": "converged"
  }
}
```

Rules:

- valid statuses are `converged`, `not-converged`, and `unknown`;
- LLVM and Wasm compilation require `converged`;
- codes/types do not carry type-derivation status;
- `.ko` and `.klib` may still store non-converged relations;
- object execution may still use the JS evaluator for non-converged relations.

Alternative:

- Store one object-level `backendEligible` flag. This hides which relation
  blocks backend compilation and is not enough for libraries.

### Step 2: Normalize Opcodes

KIR-P should use a closed opcode set:

```json
{ "op": "identity" }
{ "op": "empty" }
{ "op": "dot", "label": "x" }
{ "op": "div", "tag": "some" }
{ "op": "vid", "tag": "some" }
{ "op": "code", "code": "@..." }
{ "op": "filter", "filter": {} }
{ "op": "ref", "ref": "@..." }
{ "op": "comp", "items": [] }
{ "op": "union", "items": [] }
{ "op": "product", "fields": [{ "label": "x", "expr": {} }] }
```

Alternative:

- Keep current AST field names. This is faster now, but backend code should not
  depend on parser-shaped fields.

### Step 3: Normalize Codes

Represent codes as canonical product or union nodes:

```json
{
  "@hash": {
    "kind": "product",
    "fields": [{ "label": "x", "code": "@..." }],
    "canonical": "$C0={...};"
  }
}
```

Rules:

- Sort labels and tags canonically.
- Store references as canonical hashes.
- Validate that each hash matches its canonical form.

Alternative:

- Omit `canonical` and recompute it. This reduces payload size. Keeping it helps
  debugging and validation during the POC.

### Step 4: Normalize Pattern Graphs

Do not expose `TypePatternGraph` internals as the backend contract.

Use:

```json
{
  "root": 0,
  "nodes": [
    {
      "id": 0,
      "kind": "open-product",
      "edges": [{ "label": "x", "target": 1 }]
    }
  ]
}
```

Rules:

- Valid kinds: `any`, `open-product`, `closed-product`, `open-union`,
  `closed-union`, `type`.
- Type nodes carry a code hash.
- Edge targets must exist.
- Edge order must be canonical.

Alternative:

- Store union-find state as debug metadata. Do not use it as backend input.

## Retyping

### Step 5: Add `retype(rel, inputPattern)`

Input:

- KIR-P relation;
- concrete canonical input pattern;
- code table;
- relation table.

Output:

- KIR-R relation;
- output pattern;
- call-site pattern summary.

Algorithm:

1. Type the entry as if the program were `?inputPattern __main__`.
2. Re-run pattern derivation over the reachable relation graph.
3. Preserve value-level partial operations.
4. Record the derived output pattern.
5. Record call-site pattern contexts for helper calls.

Alternative:

- Implement this inside `run.mjs` first. This may be useful for bootstrapping,
  but the final API should be separate from the evaluator.

### Step 6: Execution After Retyping

Safe baseline:

- keep current envelope-carrying execution;
- use KIR-R only to derive the top-level output pattern;
- treat filters as already validated by retyping.

Optimized mode:

- remove envelope propagation only when every call site has a known stable
  pattern context;
- keep value-level partiality for `.field`, `/tag`, merge, and composition;
- attach the derived output pattern after execution.

Alternative:

- Never remove envelopes in the JS evaluator. This is simplest and remains the
  reference path. Envelope-free execution can be left to KIR-M.

### Step 7: Call-Site Retyping

One relation may be called under multiple patterns:

```text
f@P1
f@P2
```

KIR-R should model these as separate instances:

```text
relation hash + input pattern hash
```

Recursive definitions require fixed-point iteration over these instances.

Alternative:

- Use one annotation per relation. This is easier, but too coarse for precise
  output patterns and unsafe for envelope-free execution.

### Step 8: Cache Retyping Results

Cache key:

```text
relation-hash + input-pattern-hash
```

Cache value:

- KIR-R relation;
- output pattern;
- call-site pattern summary;
- optional backend artifact.

Alternative:

- Cache by pattern JSON first. Replace with pattern hashes once pattern hashing
  is stable.

## Conformance

### Step 9: Fixture Format

Use one directory per case:

```text
conformance/projection-field/
  case.json
  program.k
  input.kv
  expected.kv
```

Example:

```json
{
  "name": "project field",
  "program": "program.k",
  "input": "input.kv",
  "expected": "expected.kv",
  "modes": ["source", "object", "retyped"],
  "tags": ["runtime", "projection"]
}
```

Alternative:

- Store all fixtures in one JSON file. This is compact but harder to debug.

### Step 10: Runner

Add `conformance/run.mjs`.

Modes:

- `source`: compile source and run the JS evaluator;
- `object`: compile `.ko`, load it, and run object evaluation;
- `retyped`: retype using the input wire pattern and run the retyped evaluator;
- future `wasm` / `llvm`: run backend artifacts.

Comparison:

- Parse `input.kv` through `k-parse`.
- Run one mode.
- Print through `k-print`.
- Compare normalized textual output.

Alternative:

- Compare JS values directly. This is faster, but fixtures should not depend on
  JS object representation.

### Step 11: Initial Fixtures

Runtime:

- identity;
- product projection;
- union projection;
- variant construction;
- composition;
- merge fallback;
- product construction.

Typing and patterns:

- `$type` filter;
- open product filter;
- open union filter;
- recursive list/tree filter;
- incompatible filter error.

Objects and libraries:

- compile `.klib`;
- compile `.ko` with `--lib`;
- load aliases from metadata;
- `:load --no-alias`;
- reload `extract-aliases` output.

Codecs:

- unit;
- nested product;
- nested variant;
- Unicode labels;
- explicit pattern vs derived witness pattern.

Retyping:

- output pattern derived from `?P __main__`;
- helper called under two different patterns;
- recursive helper retyping convergence;
- retyping cache reuse.

Backend eligibility:

- converged relation compiles to KIR-M;
- non-converged relation is rejected by LLVM/Wasm compiler;
- `.klib` with mixed relations reports the exact rejected aliases.

Alternative:

- Start with fuzzing. Do this later. First fixtures should be deterministic and
  readable.

## Tooling Ideas

- `k-inspect-object`: print object sections, KIR-P, aliases, metadata, and
  pattern summaries.
- `k-validate-object`: validate `.ko` and `.klib` schemas and references.
- `k-retype-object`: precompute KIR-R for one relation and input pattern.
- Retyping heat counters in the JS runtime.
- Pattern-hash backend artifact cache.
- Optional binary executable object payload after KIR stabilizes.
- Minimal C backend before LLVM.
- Wasm KIR-R interpreter before native LLVM.

## Implementation Order

1. Write `DOCS/KIR_V1.md`.
2. Treat current `.ko` / `.klib` storage as the initial KIR-P input format.
3. Add `kir.mjs` to export KIR-P from current objects.
4. Add `objects/inspect.mjs --kir`.
5. Add `objects/validate.mjs`.
6. Add conformance fixture format and runner.
7. Add entry retyping for `?P __main__`.
8. Add a KIR-R JS evaluator or retyped execution wrapper.
9. Compare KIR-R execution against `run.mjs`.
10. Add call-site retyping for helper relations.
11. Add retyping cache.
12. Reject non-converged relations in LLVM/Wasm compilation.
13. Prototype a small C or Wasm backend for KIR-R.

Rule:

- KIR-P is the portable semantic contract.
- KIR-R is the retyping contract.
- KIR-M is backend material.
