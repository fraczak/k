# Web REPL Requirements & Architecture Specification

**Branch**: `web-repl`  
**Status**: Approved Specification  
**Target Area**: Web REPL UI (`browser/repl-browser.mjs`), Build Pipeline (`scripts/build-repl-html.mjs`), and REPL Engine (`repl.mjs`, `repl-codecs.mjs`)

---

## 1. Context & Objectives

The goal of this initiative is to improve the user experience, robustness, and out-of-the-box readiness of the K Web REPL.

The scope encompasses four primary objectives:
1. **Console Text Selection**: Ensure all output in the terminal console is smoothly selectable and copyable across all desktop and mobile browsers without focus-stealing interference.
2. **Prioritize `core.k`**: Make `core.k` the default first choice for loading, examples, dropdowns, and quick exploration.
3. **Curate VFS Files**: Restrict the bundled Virtual File System (VFS) to verified, useful `.k` files (`core.k`, `Examples/arithmetics.k`, `Examples/ieee.k`, `Examples/poly.k`), auditing and verifying types used by REPL codecs.
4. **Automatic Dependency Loading & Type Aliasing for Codecs**:
   - Automatically load the required `.k` source file whenever a codec is loaded, ensuring that necessary type aliases, canonical codes, and operational relations are present before the user attempts `:input` or evaluations.
   - Establish bidirectional type alias naming so codec names are direct aliases to the underlying type hashes (e.g. `$ieee` and `$float64` both point to `@AR4s...`, `$utf8` and `$string` both point to `@Pt3Mw...`, and `$int` points to `@Nws3v...`).

---

## 2. Detailed Requirements & Architectural Decisions

### Objective 1: Selectable Console Output

#### Current Problem
- When users highlight and copy output text from `#terminal-output`:
  1. A global click event listener on `document` listens for clicks to focus `#repl-input`:
     ```js
     document.addEventListener("click", (e) => {
       if (!e.target.closest("button, select, input, textarea, .modal, .quick-link, .btn-copy-entry")) {
         inputEl.focus();
       }
     });
     ```
  2. Clicking or releasing a drag selection within `#terminal-output` does not match the excluded selector list.
  3. Consequently, `inputEl.focus()` is called immediately upon `mouseup`/`click`.
  4. In modern browsers (Chromium, Firefox, Safari), focusing a text input field collapses the window's text selection, destroying the active selection.
  5. In addition, double-clicking or triple-clicking a word or line in the terminal is aborted.

#### Requirements
1. **Selection Preservation**: Users must be able to click, drag-select, double-click, and triple-click any text inside the terminal output without losing selection.
2. **Clipboard Compatibility**: Standard copy shortcuts (`Ctrl+C`, `Cmd+C`) must copy the selected text, not the input buffer.
3. **Styling & Presentation**:
   - Terminal entries (`.terminal-entry`, `.entry-command`, `.entry-line`, `.line-output`, `.line-error`, `.line-warning`, `.system-msg`) must have explicit `user-select: text; -webkit-user-select: text;`.
   - Prompt decorations (`.entry-prompt`, `.entry-meta`, `.prompt-label`) retain `user-select: none;` to avoid cluttering copied text with prompt symbols (`> `).
4. **Smart Focus Restoration**:
   - If `window.getSelection() && !window.getSelection().isCollapsed && window.getSelection().toString().trim().length > 0`, the click handler must **never** steal focus to `#repl-input`.
   - Clicking directly inside `#terminal-output` on text content should allow text cursor placement and selection without snapping focus away.
   - Only clicking on empty dead space or background when no text is selected should optionally focus the input.

---

### Objective 2: Prioritize `core.k` as the First Choice

#### Requirements
1. **Dropdown Ordering**: In `#example-select`, `core.k` must be the top-most option under standard examples.
2. **Onboarding Banner**: The welcome message and quick-start hints in `browser/repl-browser.mjs` must showcase `:load core.k` as the primary recommended action.
3. **Quick Expressions**: Ensure the quick expressions section provides expressions compatible with `core.k` out-of-the-box (e.g. `1 succ`, `10`, `$bits`, `$string`).

---

### Objective 3: Verified Useful Files in VFS & Codec Type Audit

#### Curated File Set
The bundled VFS and UI examples must include only verified useful files:
- `core.k` — The foundational standard library (bits, arithmetic on bits, Unicode `$unicode`, `$string`, `$pattern`).
- `Examples/arithmetics.k` — Arbitrary-precision signed integers (`$int`), rationals (`$rat`), GCD/LCM, factorial, Fibonacci.
- `Examples/ieee.k` — IEEE-754 double-precision floating point type (`$float64`) and arithmetic operations.
- `Examples/poly.k` — Polymorphic list functions (`concat`, `reverse`, `length`, `get_nth`, `split_by`, `take`, `drop`, `zip`).

#### Dependency Management for `poly.k`
- `Examples/poly.k` depends on `dec`, `nat`, and `zero_int?` from `Examples/arithmetics.k`.
- Loading `Examples/poly.k` on a fresh session will automatically ensure `Examples/arithmetics.k` is loaded first if not already loaded in the session.

---

### Objective 4: Auto-Loading `.k` Files on Codec Load & Code Aliasing

#### Requirements
1. **Codec-to-File Auto-Loading**:
   When a codec is registered or loaded (via `:codec load <name>`, REPL initialization, or UI action):
   - Check if the required `.k` file is already loaded in `state.loadedFiles`.
   - If not loaded, automatically load and evaluate the corresponding `.k` file before completing codec registration:
     - `int` -> auto-loads `Examples/arithmetics.k`
     - `utf8` -> auto-loads `core.k`
     - `json` -> auto-loads `core.k`
     - `ieee` -> auto-loads `Examples/ieee.k`
   - Print an informative message, e.g.: `(auto-loaded Examples/arithmetics.k for codec 'int')`.

2. **Bidirectional Code Aliasing**:
   Establish code aliasing so that codec names and their standard type names are both valid aliases pointing to the same canonical type hash:
   - **IEEE / Float64**:
     - Canonical Hash: `@AR4sFGMwXgjj5p7dhi8sJKDWNbrXxLefQUCBRNm5fP6t`
     - Aliases: `$float64` and `$ieee`
   - **UTF-8 / String**:
     - Canonical Hash: `@Pt3MwQwzUPxQKu58zXR3qUBHWTzfycx5bSZGzcK6EZQK`
     - Aliases: `$string` and `$utf8`
   - **Int**:
     - Canonical Hash: `@Nws3vysWqC9PznraTP4kWPp44Rd77NAqrx9dgbtHAjGA`
     - Alias: `$int`
   This guarantees that both `:input utf8` and `:input string`, as well as `:input ieee` and `:input float64`, work seamlessly.

3. **Idempotence**:
   - `state.loadedFiles = new Set()` tracks loaded file paths (normalized).
   - Re-running `:codec load` or loading multiple codecs referencing the same file (`utf8` and `json` both referencing `core.k`) will not recompile or reload the file redundantly.

---

### Phase 2: Curated VFS, Browser Buffer & Selection Persistence

#### 1. Curated Files Explorer
In the Web REPL "Files" (VFS) explorer, the visible files are strictly curated to verified examples and codecs:
- **k-codes**: `core.k`, `arithmetics.k`, `ieee.k`
- **codecs**: `json.mjs`, `utf8.mjs`, `int.mjs`, `unit.mjs`, `ieee.mjs`
- User-created or uploaded files remain visible.
- Internal runtime artifacts (`backends/wasm/runtime.wat`) and redundant directory prefixes (`Examples/`, `codecs/`) are kept accessible internally but hidden from the default file listing.
- Clicking "Load" on a `.mjs` file automatically executes `:codec load <filename>`.

#### 2. Browser Buffer 64-bit Float & Int Methods
`browser/shims/buffer.mjs` implements:
- `writeDoubleBE`, `readDoubleBE`, `writeDoubleLE`, `readDoubleLE`
- `writeFloatBE`, `readFloatBE`, `writeFloatLE`, `readFloatLE`
- `writeBigUInt64BE`, `readBigUInt64BE`, `writeBigUInt64LE`, `readBigUInt64LE`
- `writeBigInt64BE`, `readBigInt64BE`, `writeBigInt64LE`, `readBigInt64LE`
- Complete integer read/write methods (`UInt32`, `Int32`, `UInt16`, `Int16`, `UInt8`, `Int8`).
- `globalThis.Buffer = Buffer` set unconditionally in the browser environment.
This fixes `:input {string a, float64 n}` number parsing in JSON and IEEE codecs in browser runtime.

#### 3. Persistent Console Selection
- Replaced the global document click focus-stealer with:
  - Click listener on `.terminal-input-bar` (clicking prompt line focuses input).
  - Keydown typing handler on `window` (typing printable characters outside modals/inputs focuses input).
- Mouse selection in `.terminal-output` never collapses on click/mouseup.
