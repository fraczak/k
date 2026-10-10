# Web REPL Improvements & Conceptual Cleanup Plan

This document details the issues, conceptual improvements, and completed enhancements for the `k` Web REPL (`browser/repl-browser.mjs`, `scripts/build-repl-html.mjs`, and `repl.html`).

---

## 1. General Branding & Visual Cleanup

### Removal of `λ` (Lambda) Symbol
- [x] Remove `<span class="brand-lambda">λ</span>` from the navbar in `scripts/build-repl-html.mjs`.
- [x] Remove the `.brand-lambda` CSS class.
- [x] Update welcome banner in `browser/repl-browser.mjs` to `k interactive repl`.
- [x] Replace `λ` in string codec sample inputs with ASCII/Unicode text samples (e.g. `"abc"`).

---

## 2. Help Modal (`? Help` / `:help`) Overhaul

### Language Overview & Grammar Categorization
- [x] **Language Overview**: Short, positive, accessible description: `k` is a concise language of relations (functions) over tree-like (JSON-like) documents.
- [x] **Content-Addressed Identity**: Relations are identified by their canonical content hash (`@...`) derived directly from their structure; local names are just temporary aliases used for recursion and readability.
- [x] **Grammar Categories**:
   1. **Definitions (Local Aliases)**:
     - `name = relExpr;` &mdash; Relation alias (e.g. `swap = { . y x, . x y };`).
   2. **Relation Expressions (`relExpr`)**: Functions transforming an input document to an output document:
     - `{ rel_1 label_1, ..., rel_k label_k }` &mdash; Product of arity $k$ (evaluates relations into record fields; special case: `{}` evaluates 0 relations, producing empty record `{}`).
     - `< rel_1, ..., rel_k >` &mdash; Union / ordered choice of arity $k$ (evaluates relations in order until one succeeds).
     - `( rel_1 ... rel_k )` &mdash; Composition of arity $k$ (sequentially composes relations; special case: `()` is the 0-ary composition denoting identity; parentheses can be omitted when non-empty: `f g`).
     - `. label` &mdash; Field projection (extracts field `label`).
     - `/ tag` &mdash; Variant branch projection (extracts payload of variant `tag`).
     - `| tag` &mdash; Variant constructor (wraps document into variant `tag`).
     - `? filterExpr` &mdash; Pattern filter (asserts input matches pattern; serves as inductive termination witness).
     - `name` / `@hash` &mdash; Relation reference.
- [x] **Simplified Intro**:
  - Made arbitrary arity explicit across products `{...}`, unions `<...>`, and compositions `(...)`; explained `{}` and `()` as the natural 0-ary special cases; omitted the pattern/filter expressions table from the introductory reference.
- [x] **Replaced Misleading Expressions & Snippets**:
  - Removed phantom concepts (`10` as literal, "bit-path", `{10 int x, 5 int y} plus` in default state).
  - Added self-contained snippets (`{} | ok`, `not = < / true | false, / false | true >;`, `bool = ?< {} true, {} false >;`, `not = bool ?X < / true | false, {} | true > ?X;`, `swap = { . y x, . x y };`).
- [x] **Command Reference Table**:
  - Added `:time <expr>`.
  - Removed obsolete commands: `:rel <name> = expr`, `:val`, `:timing [on|off]`, `:codec define n t b`.
  - Removed obsolete commands: `:type`, `:types`, `:code`, `:codes`.
  - Timing is now always enabled by default across all evaluations.
  - Updated `:input` documentation to note the interactive browser dialog.
  - Clarified `:rels` (relation aliases).

---

## 3. Codecs Modal Overhaul

### Concept Correction: External Format Adapters
- [x] Reframed codecs as format adapters translating external text to/from $k$ values defined as pairs `(filter, tree)`.
- [x] **Type-Specific Codecs**:
  - `int`: Converts decimal integers to/from `int = ?< bits '+', bits '-' >`.
  - `ieee`: Converts decimal floats to/from `float64` records (`sign`, `exponent`, `fraction`).
  - `utf8`: Converts text to/from `string` (aliased to `utf8`), a list of Unicode scalar values (`unicode`) partitioned by Unicode planes.
  - `unit`: Converts to/from `{}`.
- [x] **Parameterized Codecs**:
  - `json`: JSON text is untyped; deserializing JSON requires a target $k$ type schema parameter (e.g. `:input {float64 x, string n} json`).
- [x] **Custom Codec Studio**:
  - Updated explanation to emphasize pairs `(filter, tree)`.
  - Fixed `yn` preset to provide self-contained relation definition `bool = ?< {} true, {} false >;`.
  - Fixed `blank` preset with proper Value payload formatting.

---

## 4. 'Input' Modal Overhaul

- [x] **Parameterized Codec Support**:
  - Converted "Target Type" control into an editable combobox / text input with datalist autocomplete for known aliases, while allowing arbitrary composite type expressions (`{float64 x, string n}`, `<int ok, string err>`).
  - Integrated `resolveInputTypeHash(state, rawType)` into live validation and modal submit.
  - Marked `json` as a Parameterized Codec requiring a target type schema.
  - Added composite quick samples demonstrating type + JSON payload pairs (e.g. `{float64 x, string n}` with `{"x":12, "n":"Woj"}`).
  - Preserved CLI-specified type expressions when opening via `:input <type> [codec]`.

---

## 5. Welcome Banner

- [x] Shortened initial welcome message to just the title line: `k interactive repl`.
- [x] Removed secondary description and quick link lists to keep the terminal prompt clean and uncluttered.

---

## 6. Curated VFS & Navbar Examples Dropdown

- [x] Added `poly.k` to `verifiedExamples` and `#example-select`.
- [x] Structured Navbar Examples dropdown into self-contained basic expressions vs. library-dependent workflows.
- [x] Removed `:val` from example dropdown list.
- [x] Fixed `() ()` option display text.

---

## 7. Responsive Navbar & Obsolete Command Removal

- [x] **Responsive Navbar on Narrow Screens**:
  - Changed `.navbar` from fixed `height: 48px;` to `min-height: 48px; height: auto; flex-wrap: wrap; padding: 6px 16px; gap: 8px 12px;`.
  - Styled `.nav-right` with `flex-wrap: wrap; justify-content: flex-end; min-width: 0;` so controls wrap smoothly without overflowing or clipping buttons (such as `? Help`).
  - Added comprehensive responsive media query for narrow screens ($\le 768\text{px}$) with full width wrapping and adaptable control inputs.
  - Verified via headless Chromium CDP automated tests that `#btn-help` is completely visible and interactable at narrow viewport widths (e.g. 600px).
- [x] **Removed Obsolete Commands**:
  - Removed `:rel <name> = expr` and `:def` (relations are defined using native syntax `name = expr;`).
  - Removed `:type`, `:types`, `:code`, `:codes` commands completely on `no-codes`.
  - Removed `:val` completely.
  - Removed `:timing [on|off]` (timing reporting is now permanently enabled by default for all evaluations; `:time <expr>` remains for explicit timing).
  - Removed `:codec define n t b` (custom codecs are created using the browser Custom Codec Studio UI or loaded from modules via `:codec load`).

