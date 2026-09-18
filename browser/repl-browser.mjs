import {
  createState,
  evaluateInput,
  createCompleter,
  promptForState,
  helpText,
  analyzeRawSnippet,
  lineTerminatesSnippet,
  lineHasExplicitContinuation,
  savedLibrary
} from "../repl.mjs";
import { encodeLibrary } from "../object.mjs";
import { setVfsFile, getVfsFile, getAllVfsFiles } from "./shims/fs.mjs";

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

function updatePrompt() {
  const prompt = promptForState(state);
  if (promptEl) promptEl.textContent = prompt;
  if (inputEl) {
    inputEl.placeholder = state.pendingInput
      ? `Enter value for ${state.pendingInput.promptName || "input"}...`
      : "Enter K expression or command (:help)...";
  }
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
  if (!trimmed) return;

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
    executeCommand(`:load ${file.name}`);
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

  updatePrompt();

  // Welcome message
  appendSystemMessage(`
<div class="welcome-banner">
  <div class="welcome-title">λ k interactive repl</div>
  <div class="welcome-desc">First-order partial functions over algebraic data types &bull; WebAssembly execution engine</div>
  <div class="welcome-tips">
    <span>💡 Try: <a href="javascript:void(0)" class="quick-link" data-code=":load Examples/arithmetics.k">:load Examples/arithmetics.k</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code="10">10</a></span>
    <span>• <a href="javascript:void(0)" class="quick-link" data-code="{10 int x, 5 int y} plus">{10 int x, 5 int y} plus</a></span>
    <span>• Type <a href="javascript:void(0)" class="quick-link" data-code=":help">:help</a> for all commands</span>
  </div>
</div>
`);

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
    if (autocompleteEl.classList.contains("visible")) {
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
  });

  // Global focus input on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("button, select, input, .modal, .quick-link, .btn-copy-entry")) {
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
    getAllVfsFiles
  };
  if (document.readyState !== "loading") {
    initRepl();
  } else {
    document.addEventListener("DOMContentLoaded", initRepl);
  }
}
