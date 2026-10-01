import {
  createState,
  evaluateInput,
  createCompleter,
  promptForState,
  analyzeRawSnippet,
  lineTerminatesSnippet,
  lineHasExplicitContinuation,
  savedLibrary,
  registerCodec,
  unregisterCodec,
  resolveCodec,
  codeHashToPattern,
  formatDuration,
  resolveInputTypeHash,
  resolveInputPattern,
  valueForPattern,
  codecNames,
  ensureEnveloped,
  patternFromFilter
} from "../repl.mjs";
import { Value, isProduct, isVariant, withPattern } from "../Value.mjs";
import { encodeLibrary } from "../object.mjs";
import { setVfsFile, getVfsFile, getAllVfsFiles } from "./shims/fs.mjs";
import { createOutputEntryElement } from "./tree-view.mjs";

// Make Value and helpers globally available in browser console
if (typeof window !== "undefined") {
  Object.assign(window, {
    Value,
    isProduct,
    isVariant,
    withPattern,
    patternFromFilter
  });
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
let enabledCodecsGrid;


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
  return Object.keys(store).length;
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

function appendEntry({ prompt, command, outputs = [], errors = [], warnings = [], duration = null, timing = null, value = null }) {
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

    if (timing && (timing.compileMs > 0 || timing.executeMs > 0)) {
      const metaSpan = document.createElement("span");
      metaSpan.className = "entry-meta";
      metaSpan.textContent = `comp: ${formatDuration(timing.compileMs)} | exec: ${formatDuration(timing.executeMs)}`;
      metaSpan.title = `Compilation: ${timing.compileMs.toFixed(1)}ms\nExecution: ${timing.executeMs.toFixed(1)}ms\nTotal: ${(duration ?? timing.totalMs).toFixed(1)}ms`;
      header.appendChild(metaSpan);
    } else if (duration !== null) {
      const metaSpan = document.createElement("span");
      metaSpan.className = "entry-meta";
      metaSpan.textContent = formatDuration(duration);
      metaSpan.title = `Total: ${duration.toFixed(1)}ms`;
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
  if (value && outputs.length > 0) {
    const rawText = outputs.join("\n");
    const allLines = outputs[0].split("\n");
    const codecOutputs = allLines.slice(1);
    const timingText = outputs.length > 1 ? outputs[1] : null;

    const outElement = createOutputEntryElement({
      value,
      rawText,
      codecOutputs,
      timingText
    });
    entry.appendChild(outElement);
  } else {
    for (const out of outputs) {
      const outDiv = document.createElement("div");
      outDiv.className = "entry-line line-output";
      outDiv.innerHTML = ansiToHtml(out);
      entry.appendChild(outDiv);
    }
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
    duration,
    timing: state.lastTiming,
    value: state.lastResult
  });

  // Re-create completer with updated state
  completer = createCompleter(state);
  updateCodecsBadge();
  if (codecsModal && codecsModal.classList.contains("open")) {
    renderCodecsModal();
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
    applyAutocomplete(matches[0]);
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
  const lineStart = cursorPos - lineBeforeCursor.length;
  const beforeLine = text.slice(0, lineStart);
  const afterCursor = text.slice(cursorPos);
  const insertSpace = (match.endsWith("/") || afterCursor.startsWith(" ")) ? "" : " ";
  inputEl.value = beforeLine + match + insertSpace + afterCursor;
  inputEl.selectionStart = inputEl.selectionEnd = beforeLine.length + match.length + insertSpace.length;
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
  if (currentPreviewFile.endsWith(".mjs") || currentPreviewFile.startsWith("codecs/")) {
    executeCommand(`:codec load ${currentPreviewFile}`);
  } else {
    executeCommand(`:load ${currentPreviewFile}`);
  }
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
  const grid = enabledCodecsGrid || document.getElementById("enabled-codecs-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const store = state.codecs || {};
  const entries = Object.values(store).sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "codecs-empty-state";
    empty.style.gridColumn = "1 / -1";
    empty.style.padding = "32px 16px";
    empty.style.textAlign = "center";
    empty.style.color = "var(--text-muted)";
    empty.style.background = "var(--bg-base)";
    empty.style.border = "1px dashed var(--border-color)";
    empty.style.borderRadius = "6px";
    empty.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 8px;">📦</div>
      <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">No codecs currently loaded</div>
      <div style="font-size: 12px; line-height: 1.5;">Codecs are ordinary <code>.mjs</code> files.<br>Load a codec using <code>:codec load &lt;file.mjs&gt;</code> in the terminal, or select a codec file in <b>Files</b> and click <b>Load into REPL</b>.</div>
    `;
    grid.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("div");
    card.className = "codec-card active";
    card.id = `card-codec-${entry.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    const titleEl = document.createElement("div");
    titleEl.className = "codec-card-title";
    titleEl.innerHTML = `
      <span class="codec-icon">📦</span>
      <span class="codec-name">${escapeHtml(entry.name)}</span>
      <span class="codec-status-badge active">Active</span>
    `;
    card.appendChild(titleEl);

    let targetDesc = "Self-describing";
    if (entry.name === "int.mjs") {
      targetDesc = "Pattern Family: $ int & lists";
    } else if (entry.name === "utf8.mjs") {
      targetDesc = "$ string";
    } else if (entry.name === "ieee.mjs") {
      targetDesc = "$ float64";
    } else if (entry.name === "unit.mjs") {
      targetDesc = "{}";
    } else if (entry.name === "json.mjs") {
      targetDesc = "Self-describing JSON";
    } else if (Array.isArray(entry.patterns) && entry.patterns.length > 0) {
      targetDesc = `Pattern Family (${entry.patterns.length})`;
    } else if (entry.pattern) {
      targetDesc = "Pattern Recipe";
    }

    const typeDiv = document.createElement("div");
    typeDiv.className = "codec-types";
    typeDiv.innerHTML = `Target: <span class="badge-type">${escapeHtml(targetDesc)}</span>`;
    card.appendChild(typeDiv);

    const descDiv = document.createElement("div");
    descDiv.className = "codec-desc";
    const src = entry.source || entry.name;
    descDiv.innerHTML = `Source: <code>${escapeHtml(src)}</code>`;
    card.appendChild(descDiv);

    const footer = document.createElement("div");
    footer.className = "codec-card-footer";

    const capsDiv = document.createElement("div");
    capsDiv.className = "codec-caps";
    const caps = [];
    if (typeof entry.print === "function") caps.push('<span class="cap-badge print">Serializer</span>');
    if (typeof entry.parse === "function") caps.push('<span class="cap-badge parse">Deserializer</span>');
    capsDiv.innerHTML = caps.join(" ");
    footer.appendChild(capsDiv);

    const unloadBtn = document.createElement("button");
    unloadBtn.className = "btn btn-sm btn-danger";
    unloadBtn.textContent = "Unload";
    unloadBtn.onclick = async () => {
      await executeCommand(`:codec unload ${entry.name}`);
      renderCodecsModal();
    };
    footer.appendChild(unloadBtn);

    card.appendChild(footer);
    grid.appendChild(card);
  }
}

function isCodecRegistered(name) {
  const store = state.codecs || {};
  return Boolean(store[name]);
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
  enabledCodecsGrid = document.getElementById("enabled-codecs-grid");


  updatePrompt();

  // Welcome message
  appendSystemMessage(`
<div class="welcome-banner">
  <div class="welcome-title">k interactive repl</div>
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
  });

  // Focus input when clicking anywhere in the input bar
  const inputBar = document.querySelector(".terminal-input-bar");
  if (inputBar) {
    inputBar.addEventListener("click", (e) => {
      if (inputEl && !e.target.closest("button, select, input, textarea")) {
        inputEl.focus();
      }
    });
  }

  // Focus input when typing printable characters outside modals and inputs
  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select") || document.querySelector(".modal.open")) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    if (e.key.length === 1 && inputEl) {
      inputEl.focus();
    }
  });

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
    registerCodec,
    unregisterCodec
  };
  if (document.readyState !== "loading") {
    initRepl();
  } else {
    document.addEventListener("DOMContentLoaded", initRepl);
  }
}
