import {
  createState,
  evaluateInput,
  createCompleter,
  promptForState,
  helpText,
  analyzeRawSnippet,
  lineTerminatesSnippet,
  lineHasExplicitContinuation,
  savedLibrary,
  listCodecs,
  loadCodecModule,
  registerCodec,
  unregisterCodec,
  resolveCodec,
  codeHashToPattern,
  BUILTIN_CODECS
} from "../repl.mjs";
import { Value, isProduct, isVariant } from "../Value.mjs";
import { encodeLibrary } from "../object.mjs";
import { setVfsFile, getVfsFile, getAllVfsFiles } from "./shims/fs.mjs";

// Make Value and helpers globally available for custom codecs
if (typeof window !== "undefined") {
  window.Value = Value;
  window.isProduct = isProduct;
  window.isVariant = isVariant;
}

// Global REPL state
let state = createState();
let completer = createCompleter(state);
let isEvaluating = false;

// Command history
const HISTORY_KEY = "k_repl_history";
let history = [];
try {
  const saved = localStorage.getItem(HISTORY_KEY);
  if (saved) history = JSON.parse(saved);
} catch {
  history = [];
}
let historyIndex = history.length;
let currentDraft = "";

// DOM Elements
let outputEl;
let inputEl;
let promptEl;
let statusDot;
let statusText;
let autocompleteEl;
let vfsModal;
let vfsListEl;
let vfsPreviewEl;
let vfsPreviewNameEl;
let helpModal;
let dropOverlay;
let codecsModal;
let codecsBadgeEl;
let activeCodecsTbody;
let codecTypeSelect;

// Input Popup Modal Elements
let inputPopupModal;
let inputPopupType;
let inputPopupCodec;
let inputPopupText;
let inputPopupStatus;
let inputPopupHint;
let inputSamplesList;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ansiToHtml(str) {
  let inSpan = false;
  const escaped = escapeHtml(str);
  const formatted = escaped.replace(/\x1b\[([0-9;]+)m/g, (_, code) => {
    const codes = code.split(";");
    let style = "";
    for (const c of codes) {
      if (c === "0") {
        if (inSpan) {
          inSpan = false;
          return "</span>";
        }
        return "";
      }
      if (c === "1") style += "font-weight:600;";
      if (c === "31" || c === "91") style += "color:var(--color-red);";
      if (c === "32" || c === "92") style += "color:var(--color-green);";
      if (c === "33" || c === "93") style += "color:var(--color-yellow);";
      if (c === "34" || c === "94") style += "color:var(--color-blue);";
      if (c === "35" || c === "95") style += "color:var(--color-purple);";
      if (c === "36" || c === "96") style += "color:var(--color-cyan);";
    }
    if (style) {
      inSpan = true;
      return `<span style="${style}">`;
    }
    return "";
  });
  return inSpan ? formatted + "</span>" : formatted;
}

function countActiveCodecs() {
  const store = state.codecs || {};
  let count = 0;
  const seen = new Set();
  for (const list of Object.values(store)) {
    for (const c of list) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        count++;
      }
    }
  }
  return count;
}

function updateCodecsBadge() {
  if (!codecsBadgeEl) return;
  const count = countActiveCodecs();
  codecsBadgeEl.textContent = String(count);
  codecsBadgeEl.className = count > 0 ? "badge-count active" : "badge-count";
}

function updatePrompt() {
  const prompt = promptForState(state);
  if (promptEl) promptEl.textContent = prompt;
  if (inputEl) {
    inputEl.placeholder = state.pendingInput
      ? `Enter value for ${state.pendingInput.promptName || "input"}...`
      : "Enter K expression or command (:help, :codecs)...";
  }
  updateCodecsBadge();
}

function setStatus(busy, text = "Ready") {
  isEvaluating = busy;
  if (statusDot) {
    statusDot.className = busy ? "status-dot busy" : "status-dot ready";
  }
  if (statusText) {
    statusText.textContent = busy ? "Running..." : text;
  }
}

function appendEntry({ prompt, command, outputs = [], errors = [], warnings = [], duration = null }) {
  if (!outputEl) return;

  const entry = document.createElement("div");
  entry.className = "terminal-entry";

  if (command !== undefined && command !== null) {
    const header = document.createElement("div");
    header.className = "entry-header";

    const promptSpan = document.createElement("span");
    promptSpan.className = "entry-prompt";
    promptSpan.textContent = prompt || "> ";
    header.appendChild(promptSpan);

    const cmdSpan = document.createElement("span");
    cmdSpan.className = "entry-command";
    cmdSpan.textContent = command;
    header.appendChild(cmdSpan);

    if (duration !== null) {
      const metaSpan = document.createElement("span");
      metaSpan.className = "entry-meta";
      metaSpan.textContent = `${duration.toFixed(1)}ms`;
      header.appendChild(metaSpan);
    }

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy-entry";
    copyBtn.title = "Copy command";
    copyBtn.textContent = "📋";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(command);
      copyBtn.textContent = "✓";
      setTimeout(() => { copyBtn.textContent = "📋"; }, 1500);
    };
    header.appendChild(copyBtn);

    entry.appendChild(header);
  }

  // Warnings
  for (const warn of warnings) {
    const warnDiv = document.createElement("div");
    warnDiv.className = "entry-line line-warning";
    warnDiv.innerHTML = ansiToHtml(warn);
    entry.appendChild(warnDiv);
  }

  // Errors
  for (const err of errors) {
    const errDiv = document.createElement("div");
    errDiv.className = "entry-line line-error";
    errDiv.innerHTML = ansiToHtml(err);
    entry.appendChild(errDiv);
  }

  // Outputs
  for (const out of outputs) {
    const outDiv = document.createElement("div");
    outDiv.className = "entry-line line-output";
    outDiv.innerHTML = ansiToHtml(out);
    entry.appendChild(outDiv);
  }

  outputEl.appendChild(entry);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function appendSystemMessage(msg, isError = false, isHtml = false) {
  if (!outputEl) return;
  const entry = document.createElement("div");
  entry.className = `terminal-entry system-msg ${isError ? "line-error" : ""}`;
  if (isHtml || msg.trim().startsWith("<")) {
    entry.innerHTML = msg;
  } else {
    entry.innerHTML = ansiToHtml(msg);
  }
  outputEl.appendChild(entry);
  outputEl.scrollTop = outputEl.scrollHeight;
}

export async function executeCommand(input) {
  const trimmed = input.trim();
  if (!trimmed && !state.pendingInput) return;

  // Intercept :input without args -> open input popup
  if (trimmed === ":input") {
    openInputPopup();
    return;
  }

  // Add to history
  if (history.length === 0 || history[history.length - 1] !== input) {
    history.push(input);
    if (history.length > 200) history.shift();
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }
  historyIndex = history.length;
  currentDraft = "";

  const activePrompt = promptForState(state);
  setStatus(true);

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "));
    origWarn(...args);
  };

  const t0 = performance.now();
  let outputs = [];
  let errors = [];

  try {
    outputs = await evaluateInput(input, state);
  } catch (err) {
    errors.push(err.message || String(err));
  } finally {
    console.warn = origWarn;
  }

  const duration = performance.now() - t0;
  setStatus(false);
  updatePrompt();

  appendEntry({
    prompt: activePrompt,
    command: input,
    outputs,
    errors,
    warnings,
    duration
  });

  // Re-create completer with updated state
  completer = createCompleter(state);
  updateCodecsBadge();
  if (codecsModal && codecsModal.classList.contains("open")) {
    renderCodecsModal();
  }

  // If :input <type> [codec] was executed, state.pendingInput is now set!
  // Open the Input Popup immediately to prompt the user for the input string!
  if (errors.length === 0 && state.pendingInput && trimmed.startsWith(":input ")) {
    openInputPopup();
  }
}

function adjustInputHeight() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  const newHeight = Math.min(Math.max(inputEl.scrollHeight, 28), 240);
  inputEl.style.height = `${newHeight}px`;
}

// Autocomplete logic
function handleAutocomplete() {
  if (!inputEl || !autocompleteEl) return;
  const text = inputEl.value;
  const cursorPos = inputEl.selectionStart;
  const lineBeforeCursor = text.slice(0, cursorPos).split("\n").pop();

  const [matches, original] = completer(lineBeforeCursor);
  if (!matches || matches.length === 0) {
    hideAutocomplete();
    return;
  }

  if (matches.length === 1) {
    hideAutocomplete();
    const tokenStart = lineBeforeCursor.lastIndexOf(" ") + 1;
    const match = matches[0];
    const beforeToken = text.slice(0, cursorPos - (lineBeforeCursor.length - tokenStart));
    const afterCursor = text.slice(cursorPos);
    inputEl.value = beforeToken + match + (afterCursor.startsWith(" ") ? "" : " ") + afterCursor;
    inputEl.selectionStart = inputEl.selectionEnd = beforeToken.length + match.length + 1;
    adjustInputHeight();
    return;
  }

  // Multiple matches: show dropdown popup
  showAutocompletePopup(matches, lineBeforeCursor);
}

let activeMatchIndex = -1;
let currentMatches = [];

function showAutocompletePopup(matches, line) {
  currentMatches = matches;
  activeMatchIndex = 0;
  autocompleteEl.innerHTML = "";
  matches.forEach((m, idx) => {
    const item = document.createElement("div");
    item.className = `autocomplete-item ${idx === 0 ? "active" : ""}`;
    item.textContent = m;
    item.onmousedown = (e) => {
      e.preventDefault();
      applyAutocomplete(m);
    };
    autocompleteEl.appendChild(item);
  });
  autocompleteEl.classList.add("visible");
}

function hideAutocomplete() {
  if (autocompleteEl) {
    autocompleteEl.classList.remove("visible");
    autocompleteEl.innerHTML = "";
  }
  currentMatches = [];
  activeMatchIndex = -1;
}

function applyAutocomplete(match) {
  if (!inputEl) return;
  const text = inputEl.value;
  const cursorPos = inputEl.selectionStart;
  const lineBeforeCursor = text.slice(0, cursorPos).split("\n").pop();
  const tokenStart = Math.max(0, lineBeforeCursor.lastIndexOf(" ") + 1);
  const beforeToken = text.slice(0, cursorPos - (lineBeforeCursor.length - tokenStart));
  const afterCursor = text.slice(cursorPos);
  inputEl.value = beforeToken + match + (afterCursor.startsWith(" ") ? "" : " ") + afterCursor;
  inputEl.selectionStart = inputEl.selectionEnd = beforeToken.length + match.length + 1;
  hideAutocomplete();
  adjustInputHeight();
  inputEl.focus();
}

// History navigation
function navigateHistory(direction) {
  if (history.length === 0) return;
  if (historyIndex === history.length) {
    currentDraft = inputEl.value;
  }
  if (direction === "up") {
    if (historyIndex > 0) {
      historyIndex--;
      inputEl.value = history[historyIndex];
    }
  } else if (direction === "down") {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      inputEl.value = history[historyIndex];
    } else {
      historyIndex = history.length;
      inputEl.value = currentDraft;
    }
  }
  adjustInputHeight();
  inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
}

// VFS File Explorer Modal
function openVfsModal() {
  if (!vfsModal) return;
  renderVfsFileList();
  vfsModal.classList.add("open");
}

function closeVfsModal() {
  if (vfsModal) vfsModal.classList.remove("open");
}

function renderVfsFileList() {
  if (!vfsListEl) return;
  vfsListEl.innerHTML = "";
  const files = getAllVfsFiles().sort();

  for (const filename of files) {
    const item = document.createElement("div");
    item.className = "vfs-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "vfs-file-name";
    nameSpan.textContent = filename;
    item.appendChild(nameSpan);

    const data = getVfsFile(filename);
    const size = typeof data === "string" ? new TextEncoder().encode(data).length : (data?.length || 0);
    const sizeSpan = document.createElement("span");
    sizeSpan.className = "vfs-file-size";
    sizeSpan.textContent = `${(size / 1024).toFixed(1)} KB`;
    item.appendChild(sizeSpan);

    item.onclick = () => showVfsFilePreview(filename);
    vfsListEl.appendChild(item);
  }

  if (files.length > 0) {
    showVfsFilePreview(files[0]);
  }
}

let currentPreviewFile = null;
function showVfsFilePreview(filename) {
  currentPreviewFile = filename;
  if (!vfsPreviewEl || !vfsPreviewNameEl) return;
  vfsPreviewNameEl.textContent = filename;
  const content = getVfsFile(filename);
  if (typeof content === "string") {
    vfsPreviewEl.textContent = content;
  } else if (content instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(content))) {
    vfsPreviewEl.textContent = `<binary data, ${content.length} bytes>`;
  } else {
    vfsPreviewEl.textContent = String(content || "");
  }
}

function loadPreviewedFile() {
  if (!currentPreviewFile) return;
  closeVfsModal();
  executeCommand(`:load ${currentPreviewFile}`);
}

function downloadPreviewedFile() {
  if (!currentPreviewFile) return;
  const content = getVfsFile(currentPreviewFile);
  const blob = typeof content === "string"
    ? new Blob([content], { type: "text/plain;charset=utf-8" })
    : new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = currentPreviewFile.split("/").pop();
  a.click();
  URL.revokeObjectURL(url);
}

// File Upload Handler
function handleFileUpload(file) {
  const reader = new FileReader();
  const isBinary = file.name.endsWith(".klib") || file.name.endsWith(".ko") || file.name.endsWith(".wasm");

  reader.onload = (e) => {
    let data;
    if (isBinary) {
      data = new Uint8Array(e.target.result);
    } else {
      data = e.target.result;
    }
    setVfsFile(file.name, data);
    appendSystemMessage(`📁 Uploaded <b>${escapeHtml(file.name)}</b> into VFS (${(data.length / 1024).toFixed(1)} KB).`);
    if (file.name.endsWith("-codec.mjs") || file.name.endsWith("-codec.js") || file.name.includes("codec")) {
      executeCommand(`:codec load ${file.name}`);
    } else {
      executeCommand(`:load ${file.name}`);
    }
  };

  if (isBinary) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

// Export State as .klib
function exportKlib() {
  try {
    const lib = savedLibrary(state);
    const encoded = encodeLibrary(lib);
    const blob = new Blob([encoded], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "session.klib";
    a.click();
    URL.revokeObjectURL(url);
    appendSystemMessage("💾 Exported current session state to <b>session.klib</b>.");
  } catch (err) {
    appendSystemMessage(`Failed to export .klib: ${err.message}`, true);
  }
}

// ==========================================
// CODECS SUBSYSTEM UI & CONTROLS
// ==========================================

const CODEC_PRESETS = {
  yn: {
    name: "yn",
    type: "bool",
    universal: false,
    parse: `// Parse 'yes', 'no', 'true', 'false' into $bool
const tag = text.trim().toLowerCase();
if (tag === "yes" || tag === "true" || tag === "1") {
  return Value.variant("true", Value.product({}));
}
if (tag === "no" || tag === "false" || tag === "0") {
  return Value.variant("false", Value.product({}));
}
throw new Error("Expected yes/no or true/false");`,
    print: `// Serialize boolean value to YES / NO
return value.tag === "true" ? "YES" : "NO";`
  },
  hex: {
    name: "hex",
    type: "int",
    universal: false,
    parse: `// Parse decimal or hex (e.g. 0x2a, 42, -0x10) into $int
let str = text.trim();
let sign = "+";
if (str.startsWith("-")) { sign = "-"; str = str.slice(1).trim(); }
else if (str.startsWith("+")) { str = str.slice(1).trim(); }

const num = str.startsWith("0x") || str.startsWith("0X") ? BigInt(str) : BigInt(str);
if (num === 0n) sign = "+";

const bitChars = num === 0n ? ["0"] : num.toString(2).split("");
let v = Value.variant("_", Value.product({}));
for (let i = bitChars.length - 1; i >= 0; i--) {
  v = Value.variant(bitChars[i], v);
}
return Value.variant(sign, v);`,
    print: `// Serialize $int to hexadecimal string (0x...)
if (!isVariant(value) || (value.tag !== "+" && value.tag !== "-")) {
  throw new Error("Not a valid int value");
}
let bits = "";
let node = value.value;
while (isVariant(node) && node.tag !== "_") {
  bits += node.tag;
  node = node.value;
}
const n = bits === "" ? 0n : BigInt("0b" + bits);
const hex = "0x" + n.toString(16).toUpperCase();
return (value.tag === "-" && n !== 0n ? "-" : "") + hex;`
  },
  currency: {
    name: "currency",
    type: "int",
    universal: false,
    parse: `// Parse currency e.g. $42.50 or $100 into cents int
const clean = text.trim().replace(/^\\$/, "").trim();
const parts = clean.split(".");
const dollars = BigInt(parts[0] || "0");
const cents = BigInt((parts[1] || "0").padEnd(2, "0").slice(0, 2));
const total = dollars * 100n + cents;

const bitChars = total === 0n ? ["0"] : total.toString(2).split("");
let v = Value.variant("_", Value.product({}));
for (let i = bitChars.length - 1; i >= 0; i--) {
  v = Value.variant(bitChars[i], v);
}
return Value.variant("+", v);`,
    print: `// Format cents int as currency string ($X.XX)
let bits = "";
let node = value.value;
while (isVariant(node) && node.tag !== "_") {
  bits += node.tag;
  node = node.value;
}
const n = bits === "" ? 0n : BigInt("0b" + bits);
const dollars = n / 100n;
const cents = (n % 100n).toString().padStart(2, "0");
return "$" + dollars.toString() + "." + cents;`
  },
  blank: {
    name: "custom",
    type: "",
    universal: false,
    parse: `// Parse text string and return a K Value
// Available: Value.product({ field: val }), Value.variant("tag", val)
return Value.product({});`,
    print: `// Serialize K Value into string or Buffer
return JSON.stringify(value);`
  }
};

function openCodecsModal() {
  if (!codecsModal) return;
  renderCodecsModal();
  codecsModal.classList.add("open");
}

function closeCodecsModal() {
  if (codecsModal) codecsModal.classList.remove("open");
}

function renderCodecsModal() {
  updateCodecsBadge();

  // 1. Built-in codec buttons state
  const standardCodecs = ["int", "utf8", "json", "ieee"];
  for (const name of standardCodecs) {
    const btn = document.getElementById(`btn-toggle-codec-${name}`);
    const badge = document.getElementById(`codec-badge-${name}`);
    const isLoaded = isCodecRegistered(name);
    if (btn) {
      btn.textContent = isLoaded ? "Unload" : "Load";
      btn.className = isLoaded ? "btn btn-sm btn-secondary" : "btn btn-sm btn-primary";
    }
    if (badge) {
      badge.textContent = isLoaded ? "Active" : "Inactive";
      badge.className = isLoaded ? "codec-status-badge active" : "codec-status-badge";
    }
  }

  // 2. Populate target type dropdown
  if (codecTypeSelect) {
    const prev = codecTypeSelect.value;
    codecTypeSelect.innerHTML = `<option value="">-- Choose Type Alias or Code Hash --</option>`;
    const typeGroup = document.createElement("optgroup");
    typeGroup.label = "Available Type Aliases in State";
    const aliases = Object.entries(state.typeAliases || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [alias, hash] of aliases) {
      const opt = document.createElement("option");
      opt.value = alias;
      opt.textContent = `$${alias} (${hash.slice(0, 10)}...)`;
      typeGroup.appendChild(opt);
    }
    codecTypeSelect.appendChild(typeGroup);

    const universalOpt = document.createElement("option");
    universalOpt.value = "*";
    universalOpt.textContent = "* (Universal - all types)";
    codecTypeSelect.appendChild(universalOpt);

    if (prev) codecTypeSelect.value = prev;
  }

  // 3. Render active codecs table
  if (activeCodecsTbody) {
    activeCodecsTbody.innerHTML = "";
    const store = state.codecs || {};
    const entries = [];
    for (const [codeHash, list] of Object.entries(store)) {
      for (const c of list) {
        entries.push({ codeHash, ...c });
      }
    }

    if (entries.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5" style="text-align:center;color:var(--text-muted);padding:16px;">No codecs currently loaded. Load a built-in codec or register a custom serializer/deserializer below.</td>`;
      activeCodecsTbody.appendChild(tr);
      return;
    }

    // Invert type aliases for display
    const hashToAlias = {};
    for (const [name, hash] of Object.entries(state.typeAliases || {})) {
      hashToAlias[hash] = name;
    }

    for (const entry of entries) {
      const tr = document.createElement("tr");

      const nameTd = document.createElement("td");
      nameTd.className = "codec-cell-name";
      nameTd.textContent = entry.name;
      tr.appendChild(nameTd);

      const typeTd = document.createElement("td");
      typeTd.className = "codec-cell-type";
      if (entry.codeHash === "*") {
        typeTd.innerHTML = `<span class="badge-type universal">Universal (*)</span>`;
      } else {
        const alias = hashToAlias[entry.codeHash];
        typeTd.innerHTML = `<span class="badge-type">${alias ? `$${alias} ` : ""}<code title="${entry.codeHash}">${entry.codeHash.slice(0, 10)}...</code></span>`;
      }
      tr.appendChild(typeTd);

      const capTd = document.createElement("td");
      const caps = [];
      if (typeof entry.print === "function") caps.push(`<span class="cap-badge print">Serializer</span>`);
      if (typeof entry.parse === "function") caps.push(`<span class="cap-badge parse">Deserializer</span>`);
      capTd.innerHTML = caps.join(" ");
      tr.appendChild(capTd);

      const srcTd = document.createElement("td");
      srcTd.className = "codec-cell-src";
      srcTd.textContent = entry.source ? (entry.source === "built-in" ? "Built-in" : entry.source.split("/").pop()) : "Custom";
      tr.appendChild(srcTd);

      const actTd = document.createElement("td");
      const unloadBtn = document.createElement("button");
      unloadBtn.className = "btn btn-sm btn-danger";
      unloadBtn.textContent = "Unload";
      unloadBtn.onclick = () => {
        executeCommand(`:codec unload ${entry.name}`);
        renderCodecsModal();
      };
      actTd.appendChild(unloadBtn);
      tr.appendChild(actTd);

      activeCodecsTbody.appendChild(tr);
    }
  }
}

function isCodecRegistered(name) {
  const store = state.codecs || {};
  for (const list of Object.values(store)) {
    if (list.some(c => c.name === name)) return true;
  }
  return false;
}

function applyCodecPreset(presetKey) {
  const preset = CODEC_PRESETS[presetKey];
  if (!preset) return;
  const nameInput = document.getElementById("codec-custom-name");
  const parseArea = document.getElementById("codec-custom-parse");
  const printArea = document.getElementById("codec-custom-print");

  if (nameInput) nameInput.value = preset.name;
  if (parseArea) parseArea.value = preset.parse;
  if (printArea) printArea.value = preset.print;
  if (codecTypeSelect) {
    if (preset.type) {
      codecTypeSelect.value = preset.type;
    }
  }
}

function registerCustomCodecFromForm() {
  const nameInput = document.getElementById("codec-custom-name");
  const parseArea = document.getElementById("codec-custom-parse");
  const printArea = document.getElementById("codec-custom-print");
  const statusBox = document.getElementById("codec-studio-status");

  const name = nameInput?.value.trim();
  const rawType = codecTypeSelect?.value.trim() || "*";
  const parseCode = parseArea?.value.trim();
  const printCode = printArea?.value.trim();

  if (!name) {
    if (statusBox) statusBox.innerHTML = `<span class="line-error">Codec name is required.</span>`;
    return;
  }

  try {
    let parseFn = null;
    let printFn = null;

    if (parseCode) {
      parseFn = new Function(
        "text", "context",
        `const { Value, isProduct, isVariant } = globalThis;\n${parseCode}`
      );
    }

    if (printCode) {
      printFn = new Function(
        "value", "context",
        `const { Value, isProduct, isVariant } = globalThis;\n${printCode}`
      );
    }

    let codeHash = rawType === "*" ? "*" : state.typeAliases[rawType] || rawType;
    if (!codeHash.startsWith("@") && codeHash !== "*") {
      throw new Error(`Cannot resolve type '${rawType}' to a canonical code hash. Define the type first (e.g. :type ${rawType} = ...).`);
    }

    registerCodec(state, {
      name,
      codes: [codeHash],
      universal: codeHash === "*",
      parse: parseFn,
      print: printFn
    }, "<custom-studio>");

    if (statusBox) {
      statusBox.innerHTML = `<span class="line-output">✓ Successfully registered codec <b>${name}</b> for ${codeHash === "*" ? "all types" : codeHash}!</span>`;
    }

    appendSystemMessage(`⚙ Registered custom codec <b>${name}</b> (serializer/deserializer) for ${codeHash === "*" ? "all types" : codeHash}.`);
    renderCodecsModal();
  } catch (err) {
    if (statusBox) {
      statusBox.innerHTML = `<span class="line-error">Error: ${escapeHtml(err.message)}</span>`;
    }
  }
}

function testCustomParse() {
  const parseArea = document.getElementById("codec-custom-parse");
  const testInput = document.getElementById("codec-test-input");
  const statusBox = document.getElementById("codec-studio-status");

  try {
    const parseFn = new Function(
      "text", "context",
      `const { Value, isProduct, isVariant } = globalThis;\n${parseArea.value}`
    );
    const result = parseFn(testInput.value, { Value, isProduct, isVariant, state });
    if (statusBox) {
      statusBox.innerHTML = `<span class="line-output"><b>Parse Result:</b> ${escapeHtml(JSON.stringify(result, null, 2))}</span>`;
    }
  } catch (err) {
    if (statusBox) {
      statusBox.innerHTML = `<span class="line-error">Parse Error: ${escapeHtml(err.message)}</span>`;
    }
  }
}

function testCustomPrint() {
  const printArea = document.getElementById("codec-custom-print");
  const statusBox = document.getElementById("codec-studio-status");

  try {
    const printFn = new Function(
      "value", "context",
      `const { Value, isProduct, isVariant } = globalThis;\n${printArea.value}`
    );
    const result = printFn(state.value, { Value, isProduct, isVariant, state });
    if (statusBox) {
      statusBox.innerHTML = `<span class="line-output"><b>Print Output:</b> ${escapeHtml(String(result))}</span>`;
    }
  } catch (err) {
    if (statusBox) {
      statusBox.innerHTML = `<span class="line-error">Print Error: ${escapeHtml(err.message)}</span>`;
    }
  }
}

function saveCustomCodecToVfs() {
  const nameInput = document.getElementById("codec-custom-name");
  const parseArea = document.getElementById("codec-custom-parse");
  const printArea = document.getElementById("codec-custom-print");
  const statusBox = document.getElementById("codec-studio-status");

  const name = nameInput?.value.trim() || "custom";
  const rawType = codecTypeSelect?.value.trim() || "*";
  const codeHash = rawType === "*" ? "*" : state.typeAliases[rawType] || rawType;
  const fileName = `codecs/${name}-codec.mjs`;

  const fileContent = `// Custom K Codec: ${name}
import { Value, isProduct, isVariant } from "../Value.mjs";

export const name = ${JSON.stringify(name)};
export const codes = [${JSON.stringify(codeHash)}];
export const universal = ${codeHash === "*"};

export function parse(text, context) {
  ${parseArea?.value || ""}
}

export function print(value, context) {
  ${printArea?.value || ""}
}
`;

  setVfsFile(fileName, fileContent);
  if (statusBox) {
    statusBox.innerHTML = `<span class="line-output">💾 Saved codec file to VFS as <b>${fileName}</b></span>`;
  }
  appendSystemMessage(`💾 Saved codec file to VFS: <b>${fileName}</b>. You can reload it anytime via <code>:codec load ${fileName}</code>.`);
}

// ==========================================
// CODEC INPUT POPUP SUBSYSTEM (:input)
// ==========================================

const CODEC_SAMPLES = {
  int: ["0", "10", "42", "-15", "1000000"],
  utf8: ["hello", "hello world", "k repl", "λ"],
  json: ['{"name":"Alice"}', '{"x":10,"y":20}', 'true', '[1, 2, 3]'],
  ieee: ["0.0", "3.14159", "-2.718", "1e6"],
  yn: ["yes", "no", "true", "false"],
  hex: ["0x2A", "0xFF", "0x1000", "-0x10"],
  currency: ["$10.00", "$42.50", "$99.99"]
};

export function openInputPopup(preselectedType = null, preselectedCodec = null) {
  if (!inputPopupModal) return;

  populateInputPopupDropdowns(preselectedType, preselectedCodec);

  if (inputPopupText) {
    inputPopupText.value = "";
  }
  updateLiveValidation();

  inputPopupModal.classList.add("open");
  setTimeout(() => {
    if (inputPopupText) inputPopupText.focus();
  }, 50);
}

export function closeInputPopup() {
  if (inputPopupModal) {
    inputPopupModal.classList.remove("open");
  }
  if (inputEl) inputEl.focus();
}

export function cancelInputPopup() {
  if (state.pendingInput) {
    state.pendingInput = null;
    updatePrompt();
    appendSystemMessage("Input cancelled.");
  }
  closeInputPopup();
}

function renderInputSamples(codecName) {
  if (!inputSamplesList) return;
  inputSamplesList.innerHTML = "";
  const samples = CODEC_SAMPLES[codecName] || ["()"];
  for (const s of samples) {
    const btn = document.createElement("span");
    btn.className = "sample-pill";
    btn.textContent = s;
    btn.title = `Click to insert sample "${s}"`;
    btn.onclick = () => {
      if (inputPopupText) {
        inputPopupText.value = s;
        inputPopupText.focus();
        updateLiveValidation();
      }
    };
    inputSamplesList.appendChild(btn);
  }
}

function updateInputPopupHint() {
  if (!inputPopupHint) return;
  if (state.pendingInput) {
    const rawType = inputPopupType?.value || state.pendingInput.codeHash;
    const codecName = inputPopupCodec?.value || state.pendingInput.codecName;
    inputPopupHint.innerHTML = `Enter input value for <b>$${escapeHtml(rawType)}</b> using codec <b>${escapeHtml(codecName || "default")}</b>:`;
  } else {
    inputPopupHint.innerHTML = `Choose target type &amp; deserializer, then enter input string:`;
  }
}

function updateInputPopupCodecs() {
  if (!inputPopupCodec) return;
  const rawType = inputPopupType?.value || "*";
  const codeHash = rawType === "*" ? "*" : state.typeAliases?.[rawType] || rawType;
  const prev = inputPopupCodec.value;

  inputPopupCodec.innerHTML = "";
  const matchingCodecs = [];
  const store = state.codecs || {};

  const candidates = [
    ...(store[codeHash] || []),
    ...(codeHash !== "*" ? (store["*"] || []) : [])
  ];

  const seen = new Set();
  for (const c of candidates) {
    if (typeof c.parse === "function" && !seen.has(c.name)) {
      seen.add(c.name);
      matchingCodecs.push(c.name);
    }
  }

  if (matchingCodecs.length === 0) {
    if (rawType === "int") matchingCodecs.push("int");
    if (rawType === "bool") matchingCodecs.push("yn");
    if (rawType === "string") matchingCodecs.push("utf8");
    matchingCodecs.push("json");
  }

  for (const name of matchingCodecs) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    inputPopupCodec.appendChild(opt);
  }

  if (prev && matchingCodecs.includes(prev)) {
    inputPopupCodec.value = prev;
  } else if (matchingCodecs.length > 0) {
    inputPopupCodec.value = matchingCodecs[0];
  }

  renderInputSamples(inputPopupCodec.value);
  updateInputPopupHint();
  updateLiveValidation();
}

function populateInputPopupDropdowns(preselectedType = null, preselectedCodec = null) {
  if (!inputPopupType) return;

  let prevType = preselectedType;
  if (!prevType && state.pendingInput) {
    const foundAlias = Object.entries(state.typeAliases || {}).find(([, h]) => h === state.pendingInput.codeHash);
    prevType = foundAlias ? foundAlias[0] : state.pendingInput.codeHash;
  }
  if (!prevType) {
    prevType = inputPopupType.value;
  }

  inputPopupType.innerHTML = "";

  const aliases = Object.entries(state.typeAliases || {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [alias, hash] of aliases) {
    const opt = document.createElement("option");
    opt.value = alias;
    opt.textContent = `$${alias} (${hash.slice(0, 10)}...)`;
    inputPopupType.appendChild(opt);
  }

  const universalOpt = document.createElement("option");
  universalOpt.value = "*";
  universalOpt.textContent = "* (Universal / Any)";
  inputPopupType.appendChild(universalOpt);

  if (prevType && (aliases.some(([a]) => a === prevType) || prevType === "*")) {
    inputPopupType.value = prevType;
  } else if (aliases.length > 0) {
    inputPopupType.value = aliases[0][0];
  }

  updateInputPopupCodecs();

  const targetCodec = preselectedCodec || state.pendingInput?.codecName;
  if (targetCodec && inputPopupCodec) {
    inputPopupCodec.value = targetCodec;
    renderInputSamples(targetCodec);
  }
}

function updateLiveValidation() {
  if (!inputPopupStatus) return;
  const text = inputPopupText ? inputPopupText.value : "";
  if (!text) {
    inputPopupStatus.innerHTML = `<span style="color:var(--text-muted);font-size:11px;">Ready for input.</span>`;
    return;
  }

  const rawType = inputPopupType?.value;
  const codecName = inputPopupCodec?.value;
  if (!rawType) {
    inputPopupStatus.innerHTML = `<span class="line-warning" style="margin:0;padding:2px 6px;">Select a target type first.</span>`;
    return;
  }

  const codeHash = rawType === "*" ? "*" : state.typeAliases?.[rawType] || rawType;
  try {
    const codec = resolveCodec(state, codeHash, codecName || null, "parse");
    const pattern = codeHashToPattern(codeHash, (h) => state.codes?.[h]);
    const parsed = codec.parse(text, {
      codeHash,
      pattern,
      state,
      Value,
      isProduct,
      isVariant
    });
    const repr = parsed instanceof Value ? parsed.toJSON() : (typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed));
    inputPopupStatus.innerHTML = `<span class="line-output" style="margin:0;padding:2px 6px;">✓ Valid: <code>${escapeHtml(String(repr))}</code></span>`;
  } catch (err) {
    inputPopupStatus.innerHTML = `<span class="line-warning" style="margin:0;padding:2px 6px;">⚠ ${escapeHtml(err.message || String(err))}</span>`;
  }
}

export async function submitInputPopup() {
  const text = inputPopupText?.value ?? "";

  // If state.pendingInput is not set, configure it from the popup selections
  if (!state.pendingInput) {
    const rawType = inputPopupType?.value;
    const codecName = inputPopupCodec?.value;
    if (!rawType) {
      if (inputPopupStatus) inputPopupStatus.innerHTML = `<span class="line-error">Please select a target type.</span>`;
      return;
    }
    const codeHash = rawType === "*" ? "*" : state.typeAliases?.[rawType] || rawType;
    try {
      const codec = resolveCodec(state, codeHash, codecName || null, "parse");
      state.pendingInput = { codeHash, codecName: codec.name, promptName: codec.name };
    } catch (err) {
      if (inputPopupStatus) inputPopupStatus.innerHTML = `<span class="line-error">${escapeHtml(err.message)}</span>`;
      return;
    }
  }

  closeInputPopup();
  await executeCommand(text);
}

// Initialization on DOMContentLoaded
export function initRepl() {
  outputEl = document.getElementById("terminal-output");
  inputEl = document.getElementById("repl-input");
  promptEl = document.getElementById("prompt-label");
  statusDot = document.getElementById("status-dot");
  statusText = document.getElementById("status-text");
  autocompleteEl = document.getElementById("autocomplete-popup");
  vfsModal = document.getElementById("vfs-modal");
  vfsListEl = document.getElementById("vfs-files-list");
  vfsPreviewEl = document.getElementById("vfs-preview-content");
  vfsPreviewNameEl = document.getElementById("vfs-preview-name");
  helpModal = document.getElementById("help-modal");
  dropOverlay = document.getElementById("drop-overlay");
  codecsModal = document.getElementById("codecs-modal");
  codecsBadgeEl = document.getElementById("codecs-count-badge");
  activeCodecsTbody = document.getElementById("active-codecs-tbody");
  codecTypeSelect = document.getElementById("codec-custom-type");

  inputPopupModal = document.getElementById("input-popup-modal");
  inputPopupType = document.getElementById("input-popup-type");
  inputPopupCodec = document.getElementById("input-popup-codec");
  inputPopupText = document.getElementById("input-popup-text");
  inputPopupStatus = document.getElementById("input-popup-status");
  inputPopupHint = document.getElementById("input-popup-hint");
  inputSamplesList = document.getElementById("input-samples-list");

  updatePrompt();

  // Welcome message
  appendSystemMessage(`
<div class="welcome-banner">
  <div class="welcome-title">λ k interactive repl</div>
  <div class="welcome-desc">First-order partial functions over algebraic data types &bull; WebAssembly execution engine &bull; Custom Serializers &amp; Deserializers (:codecs)</div>
  <div class="welcome-tips">
    <span>💡 Try: <a href="javascript:void(0)" class="quick-link" data-code=":load Examples/arithmetics.k">:load Examples/arithmetics.k</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code=":codec load int">:codec load int</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code="10 int">10 int</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code="{10 int x, 5 int y} plus">{10 int x, 5 int y} plus</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code=":codecs">:codecs</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code=":help">:help</a></span>
  </div>
</div>
`, false, true);

  // Delegate quick links
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".quick-link");
    if (link && link.dataset.code) {
      e.preventDefault();
      inputEl.value = link.dataset.code;
      adjustInputHeight();
      executeCommand(link.dataset.code);
    }
  });

  // Input events
  inputEl.addEventListener("input", () => {
    adjustInputHeight();
    hideAutocomplete();
  });

  inputEl.addEventListener("keydown", (e) => {
    // Autocomplete popup navigation
    if (autocompleteEl && autocompleteEl.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeMatchIndex = (activeMatchIndex + 1) % currentMatches.length;
        Array.from(autocompleteEl.children).forEach((child, i) => {
          child.classList.toggle("active", i === activeMatchIndex);
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeMatchIndex = (activeMatchIndex - 1 + currentMatches.length) % currentMatches.length;
        Array.from(autocompleteEl.children).forEach((child, i) => {
          child.classList.toggle("active", i === activeMatchIndex);
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (activeMatchIndex >= 0 && activeMatchIndex < currentMatches.length) {
          applyAutocomplete(currentMatches[activeMatchIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        hideAutocomplete();
        return;
      }
    }

    // Tab for completion
    if (e.key === "Tab") {
      e.preventDefault();
      handleAutocomplete();
      return;
    }

    // Enter to run
    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter: let default newline happen
        setTimeout(adjustInputHeight, 0);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        // Force run
        e.preventDefault();
        const code = inputEl.value;
        inputEl.value = "";
        adjustInputHeight();
        executeCommand(code);
        return;
      }

      // Normal Enter
      const val = inputEl.value;
      // Check if explicit continuation with \
      if (lineHasExplicitContinuation(val)) {
        setTimeout(adjustInputHeight, 0);
        return;
      }

      // Check if incomplete snippet
      if (!val.trim().startsWith(":") && !lineTerminatesSnippet(val)) {
        try {
          const analysis = analyzeRawSnippet(val);
          if (analysis.kind === "incomplete") {
            // Let it wrap to next line
            setTimeout(adjustInputHeight, 0);
            return;
          }
        } catch {
          // Syntax error or complete, let executeCommand display error
        }
      }

      e.preventDefault();
      const code = inputEl.value;
      inputEl.value = "";
      adjustInputHeight();
      executeCommand(code);
      return;
    }

    // Up / Down history
    if (e.key === "ArrowUp") {
      const isFirstLine = inputEl.value.slice(0, inputEl.selectionStart).indexOf("\n") === -1;
      if (isFirstLine) {
        e.preventDefault();
        navigateHistory("up");
        return;
      }
    }
    if (e.key === "ArrowDown") {
      const isLastLine = inputEl.value.slice(inputEl.selectionEnd).indexOf("\n") === -1;
      if (isLastLine) {
        e.preventDefault();
        navigateHistory("down");
        return;
      }
    }

    // Ctrl+L: Clear
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      clearOutput();
      return;
    }

    // Escape: clear input
    if (e.key === "Escape") {
      inputEl.value = "";
      adjustInputHeight();
      return;
    }
  });

  // Run button
  const runBtn = document.getElementById("btn-run");
  if (runBtn) {
    runBtn.onclick = () => {
      const code = inputEl.value;
      if (code.trim()) {
        inputEl.value = "";
        adjustInputHeight();
        executeCommand(code);
      }
      inputEl.focus();
    };
  }

  // Clear button
  const clearBtn = document.getElementById("btn-clear");
  if (clearBtn) clearBtn.onclick = clearOutput;

  // Reset button
  const resetBtn = document.getElementById("btn-reset");
  if (resetBtn) {
    resetBtn.onclick = () => {
      executeCommand(":reset");
    };
  }

  // Help button
  const helpBtn = document.getElementById("btn-help");
  if (helpBtn) {
    helpBtn.onclick = () => {
      if (helpModal) helpModal.classList.add("open");
    };
  }

  const closeHelpBtn = document.getElementById("btn-close-help");
  if (closeHelpBtn) {
    closeHelpBtn.onclick = () => {
      if (helpModal) helpModal.classList.remove("open");
    };
  }

  // VFS Explorer button
  const vfsBtn = document.getElementById("btn-vfs");
  if (vfsBtn) vfsBtn.onclick = openVfsModal;

  const closeVfsBtn = document.getElementById("btn-close-vfs");
  if (closeVfsBtn) closeVfsBtn.onclick = closeVfsModal;

  const loadVfsFileBtn = document.getElementById("btn-vfs-load");
  if (loadVfsFileBtn) loadVfsFileBtn.onclick = loadPreviewedFile;

  const downloadVfsFileBtn = document.getElementById("btn-vfs-download");
  if (downloadVfsFileBtn) downloadVfsFileBtn.onclick = downloadPreviewedFile;

  // Codecs Subsystem button & modal
  const codecsBtn = document.getElementById("btn-codecs");
  if (codecsBtn) codecsBtn.onclick = openCodecsModal;

  const closeCodecsBtn = document.getElementById("btn-close-codecs");
  if (closeCodecsBtn) closeCodecsBtn.onclick = closeCodecsModal;

  // Toggle built-in codecs buttons
  ["int", "utf8", "json", "ieee"].forEach(name => {
    const btn = document.getElementById(`btn-toggle-codec-${name}`);
    if (btn) {
      btn.onclick = () => {
        if (isCodecRegistered(name)) {
          executeCommand(`:codec unload ${name}`);
        } else {
          executeCommand(`:codec load ${name}`);
        }
        renderCodecsModal();
      };
    }
  });

  // Codec Studio controls
  const presetSelect = document.getElementById("codec-preset-select");
  if (presetSelect) {
    presetSelect.addEventListener("change", () => {
      if (presetSelect.value) applyCodecPreset(presetSelect.value);
    });
  }

  const btnRegisterCodec = document.getElementById("btn-register-codec");
  if (btnRegisterCodec) btnRegisterCodec.onclick = registerCustomCodecFromForm;

  const btnTestParse = document.getElementById("btn-test-parse");
  if (btnTestParse) btnTestParse.onclick = testCustomParse;

  const btnTestPrint = document.getElementById("btn-test-print");
  if (btnTestPrint) btnTestPrint.onclick = testCustomPrint;

  const btnSaveCodecVfs = document.getElementById("btn-save-codec-vfs");
  if (btnSaveCodecVfs) btnSaveCodecVfs.onclick = saveCustomCodecToVfs;

  // Codec Input Popup controls
  const btnInputNavbar = document.getElementById("btn-input-popup");
  if (btnInputNavbar) btnInputNavbar.onclick = () => openInputPopup();

  const btnCloseInput = document.getElementById("btn-close-input-popup");
  if (btnCloseInput) btnCloseInput.onclick = cancelInputPopup;

  const btnCancelInput = document.getElementById("btn-cancel-input");
  if (btnCancelInput) btnCancelInput.onclick = cancelInputPopup;

  const btnSubmitInput = document.getElementById("btn-submit-input");
  if (btnSubmitInput) btnSubmitInput.onclick = submitInputPopup;

  if (inputPopupType) {
    inputPopupType.addEventListener("change", updateInputPopupCodecs);
  }

  if (inputPopupCodec) {
    inputPopupCodec.addEventListener("change", () => {
      renderInputSamples(inputPopupCodec.value);
      updateLiveValidation();
    });
  }

  if (inputPopupText) {
    inputPopupText.addEventListener("input", updateLiveValidation);
    inputPopupText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
        e.preventDefault();
        submitInputPopup();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelInputPopup();
      }
    });
  }

  // Export .klib button
  const exportBtn = document.getElementById("btn-export");
  if (exportBtn) exportBtn.onclick = exportKlib;

  // Example selector
  const exampleSelect = document.getElementById("example-select");
  const loadExampleBtn = document.getElementById("btn-load-example");
  if (exampleSelect && loadExampleBtn) {
    loadExampleBtn.onclick = () => {
      const val = exampleSelect.value;
      if (!val) return;
      if (val.startsWith("expr:")) {
        const expr = val.slice("expr:".length);
        inputEl.value = expr;
        adjustInputHeight();
        executeCommand(expr);
      } else {
        executeCommand(`:load ${val}`);
      }
      inputEl.focus();
    };
  }

  // File Upload
  const fileInput = document.getElementById("file-upload");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      fileInput.value = "";
    });
  }

  // Drag and drop onto window
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (dropOverlay) dropOverlay.classList.add("visible");
  });

  window.addEventListener("dragleave", (e) => {
    if (e.target === dropOverlay || !e.relatedTarget) {
      if (dropOverlay) dropOverlay.classList.remove("visible");
    }
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dropOverlay) dropOverlay.classList.remove("visible");
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  });

  // Modal close when clicking backdrop
  window.addEventListener("click", (e) => {
    if (e.target === vfsModal) closeVfsModal();
    if (e.target === helpModal) helpModal.classList.remove("open");
    if (e.target === codecsModal) closeCodecsModal();
    if (e.target === inputPopupModal) cancelInputPopup();
  });

  // Global focus input on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("button, select, input, textarea, .modal, .quick-link, .btn-copy-entry")) {
      inputEl.focus();
    }
  });

  // Apply initial yn preset to custom form
  applyCodecPreset("yn");

  inputEl.focus();
}

function clearOutput() {
  if (outputEl) {
    outputEl.innerHTML = "";
    appendSystemMessage("<span style='color:var(--color-muted)'>Terminal cleared.</span>");
  }
}

// Auto-run if in browser
if (typeof window !== "undefined") {
  window.kRepl = {
    executeCommand,
    initRepl,
    getState: () => state,
    getVfsFile,
    setVfsFile,
    getAllVfsFiles,
    openCodecsModal,
    openInputPopup,
    closeInputPopup,
    submitInputPopup,
    cancelInputPopup,
    registerCodec,
    unregisterCodec
  };
  if (document.readyState !== "loading") {
    initRepl();
  } else {
    document.addEventListener("DOMContentLoaded", initRepl);
  }
}
