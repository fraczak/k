#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");

function printHelp() {
  console.log(`Usage: node scripts/build-repl-html.mjs [options]

Builds the standalone, self-contained K web REPL (repl.html).
Bundles browser shims, virtual file system (core.k, Examples, Wasm),
and UI components into a single zero-dependency HTML file.

Options:
  -h, --help
      Show this help message and exit.`);
}

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

console.log("=== Building Self-Contained K REPL HTML ===");

// 1. Node shims plugin for esbuild
const nodeShimsPlugin = {
  name: "node-shims",
  setup(build) {
    const shims = {
      "fs": path.join(projectRoot, "browser/shims/fs.mjs"),
      "node:fs": path.join(projectRoot, "browser/shims/fs.mjs"),
      "path": path.join(projectRoot, "browser/shims/path.mjs"),
      "node:path": path.join(projectRoot, "browser/shims/path.mjs"),
      "crypto": path.join(projectRoot, "browser/shims/crypto.mjs"),
      "node:crypto": path.join(projectRoot, "browser/shims/crypto.mjs"),
      "buffer": path.join(projectRoot, "browser/shims/buffer.mjs"),
      "node:buffer": path.join(projectRoot, "browser/shims/buffer.mjs"),
      "os": path.join(projectRoot, "browser/shims/os.mjs"),
      "node:os": path.join(projectRoot, "browser/shims/os.mjs"),
      "process": path.join(projectRoot, "browser/shims/process.mjs"),
      "node:process": path.join(projectRoot, "browser/shims/process.mjs"),
      "readline": path.join(projectRoot, "browser/shims/readline.mjs"),
      "node:readline": path.join(projectRoot, "browser/shims/readline.mjs"),
      "url": path.join(projectRoot, "browser/shims/url.mjs"),
      "node:url": path.join(projectRoot, "browser/shims/url.mjs"),
      "assert": path.join(projectRoot, "browser/shims/assert.mjs"),
      "node:assert": path.join(projectRoot, "browser/shims/assert.mjs"),
    };

    build.onResolve({ filter: /^(node:)?(fs|path|crypto|buffer|os|process|readline|url|assert)$/ }, (args) => {
      if (shims[args.path]) {
        return { path: shims[args.path] };
      }
    });
  }
};

// 2. Scan and generate browser/vfs-data.mjs
console.log("1. Generating VFS data...");
const vfsFiles = {};

// Add runtime.wat
const runtimeWatPath = path.join(projectRoot, "backends/wasm/runtime.wat");
if (fs.existsSync(runtimeWatPath)) {
  vfsFiles["backends/wasm/runtime.wat"] = fs.readFileSync(runtimeWatPath, "utf8");
}

// Add core.k
const coreKPath = path.join(projectRoot, "core.k");
if (fs.existsSync(coreKPath)) {
  vfsFiles["core.k"] = fs.readFileSync(coreKPath, "utf8");
}

// Add verified k-code files: arithmetics.k, ieee.k, poly.k, karatsuba-mult.k
const verifiedExamples = ["arithmetics.k", "ieee.k", "poly.k", "karatsuba-mult.k"];
const examplesDir = path.join(projectRoot, "Examples");
for (const filename of verifiedExamples) {
  const fullPath = path.join(examplesDir, filename);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const content = fs.readFileSync(fullPath, "utf8");
    vfsFiles[filename] = content;
    vfsFiles[`Examples/${filename}`] = content;
  }
}

// Bundle verified codecs for browser VFS as 100% self-contained ES modules
const verifiedCodecs = ["json.mjs", "utf8.mjs", "int.mjs", "unit.mjs", "ieee.mjs"];
const codecsDir = path.join(projectRoot, "codecs");

const browserCodecSdkShim = `
export { Value, isProduct, isVariant, withPattern } from "../../Value.mjs";
export function runCodecCLI() {}
export function encodeToWire() {}
export function decodeWire() {}
export function patternFromFilter(script, options) {
  if (typeof globalThis !== "undefined" && typeof globalThis.patternFromFilter === "function") {
    return globalThis.patternFromFilter(script, options);
  }
  throw new Error("patternFromFilter is not available in browser environment");
}
`;

for (const filename of verifiedCodecs) {
  const fullPath = path.join(codecsDir, filename);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const buildRes = await esbuild.build({
      entryPoints: [fullPath],
      bundle: true,
      format: "esm",
      write: false,
      plugins: [{
        name: "codec-sdk-shim",
        setup(build) {
          build.onResolve({ filter: /(codec-sdk|pattern-k)\.mjs$/ }, (args) => ({
            path: args.path,
            namespace: "codec-sdk-shim"
          }));
          build.onLoad({ filter: /.*/, namespace: "codec-sdk-shim" }, () => ({
            contents: browserCodecSdkShim,
            resolveDir: path.join(codecsDir, "runtime")
          }));
        }
      }]
    });
    const bundledContent = buildRes.outputFiles[0].text;
    vfsFiles[filename] = bundledContent;
  }
}

const vfsDataContent = `// Auto-generated by scripts/build-repl-html.mjs - DO NOT EDIT MANUALLY\n` +
  `export const vfsData = ${JSON.stringify(vfsFiles, null, 2)};\n`;

const vfsDataPath = path.join(projectRoot, "browser/vfs-data.mjs");
fs.writeFileSync(vfsDataPath, vfsDataContent, "utf8");
console.log(`   Generated ${vfsDataPath} with ${Object.keys(vfsFiles).length} files.`);

// 3. Bundle browser/repl-browser.mjs
console.log("2. Bundling with esbuild...");
const entryPoint = path.join(projectRoot, "browser/repl-browser.mjs");

const buildResult = await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  plugins: [nodeShimsPlugin],
  define: {
    "global": "globalThis",
    "process.env.NODE_ENV": '"production"'
  },
  write: false,
  minify: false,
});

if (buildResult.errors.length > 0) {
  console.error("Esbuild errors:", buildResult.errors);
  process.exit(1);
}

const bundledJs = buildResult.outputFiles[0].text;
console.log(`   Bundled JavaScript size: ${(bundledJs.length / 1024).toFixed(1)} KB`);

// 4. Read or generate HTML Template
console.log("3. Generating self-contained HTML...");

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>k interactive repl</title>
  <style>
    :root {
      --bg-base: #0d1117;
      --bg-surface: #161b22;
      --bg-subtle: #21262d;
      --bg-input: #090d12;
      --border-color: #30363d;
      --border-focus: #58a6ff;
      --text-main: #e6edf3;
      --text-muted: #8b949e;
      --color-prompt: #58a6ff;
      --color-green: #3fb950;
      --color-yellow: #d29922;
      --color-red: #f85149;
      --color-purple: #bc8cff;
      --color-cyan: #39c5cf;
      --color-blue: #58a6ff;
      --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body, html {
      height: 100%;
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.5;
      overflow: hidden;
    }

    #app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
    }

    /* Header */
    .navbar {
      min-height: 48px;
      height: auto;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 16px;
      flex-shrink: 0;
      flex-wrap: wrap;
      gap: 8px 12px;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 16px;
      user-select: none;
    }

    .brand-name {
      letter-spacing: 0.5px;
    }

    .engine-badge {
      font-size: 11px;
      font-weight: 600;
      background: rgba(88, 166, 255, 0.15);
      color: var(--color-prompt);
      border: 1px solid rgba(88, 166, 255, 0.3);
      padding: 2px 8px;
      border-radius: 12px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }

    .engine-badge:hover {
      background: rgba(88, 166, 255, 0.3);
      border-color: rgba(88, 166, 255, 0.6);
    }

    .engine-badge.js-mode {
      background: rgba(240, 180, 41, 0.15);
      color: #e3b341;
      border-color: rgba(240, 180, 41, 0.4);
    }

    .engine-badge.js-mode:hover {
      background: rgba(240, 180, 41, 0.3);
      border-color: rgba(240, 180, 41, 0.7);
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .status-dot.ready {
      background: var(--color-green);
      box-shadow: 0 0 8px rgba(63, 185, 80, 0.6);
    }

    .status-dot.busy {
      background: var(--color-yellow);
      box-shadow: 0 0 8px rgba(210, 153, 34, 0.6);
      animation: pulse 1s infinite alternate;
    }

    @keyframes pulse {
      from { opacity: 0.4; }
      to { opacity: 1; }
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: 6px 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      flex: 1 1 auto;
      min-width: 0;
    }

    .control-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    select, button, .btn {
      font-family: inherit;
      font-size: 12px;
      border-radius: 6px;
      padding: 5px 10px;
      cursor: pointer;
      border: 1px solid var(--border-color);
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    select {
      background: var(--bg-base);
      color: var(--text-main);
      max-width: 220px;
    }

    select:focus, button:focus {
      outline: none;
      border-color: var(--border-focus);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }

    .btn-primary {
      background: #238636;
      color: #ffffff;
      border-color: rgba(240, 246, 252, 0.1);
      font-weight: 500;
    }

    .btn-primary:hover {
      background: #2ea043;
    }

    .btn-secondary {
      background: var(--bg-subtle);
      color: var(--text-main);
    }

    .btn-secondary:hover {
      background: #30363d;
      border-color: #8b949e;
    }

    .btn-sm {
      padding: 3px 8px;
      font-size: 11px;
    }

    /* Terminal */
    .terminal-main {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-base);
      position: relative;
    }

    .terminal-output {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      scroll-behavior: smooth;
      user-select: text;
      -webkit-user-select: text;
    }

    .terminal-output::-webkit-scrollbar,
    .vfs-code-view::-webkit-scrollbar,
    .vfs-files-list::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    .terminal-output::-webkit-scrollbar-thumb,
    .vfs-code-view::-webkit-scrollbar-thumb,
    .vfs-files-list::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }

    .terminal-output::-webkit-scrollbar-track,
    .vfs-code-view::-webkit-scrollbar-track,
    .vfs-files-list::-webkit-scrollbar-track {
      background: transparent;
    }

    /* Entries */
    .terminal-entry {
      margin-bottom: 12px;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
    }

    .terminal-entry.system-msg {
      padding: 8px 12px;
      background: rgba(22, 27, 34, 0.6);
      border-left: 3px solid var(--border-color);
      border-radius: 0 6px 6px 0;
      color: var(--text-muted);
      user-select: text;
      -webkit-user-select: text;
    }

    .entry-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
      position: relative;
    }

    .entry-prompt {
      color: var(--color-prompt);
      font-weight: 700;
      user-select: none;
      -webkit-user-select: none;
    }

    .entry-command {
      color: #ffffff;
      font-weight: 600;
      flex: 1;
      white-space: pre-wrap;
      user-select: text;
      -webkit-user-select: text;
    }

    .entry-meta {
      font-size: 11px;
      color: var(--text-muted);
      background: rgba(139, 148, 158, 0.15);
      padding: 1px 6px;
      border-radius: 4px;
      user-select: none;
    }

    .btn-copy-entry {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      padding: 2px 4px;
      opacity: 0.3;
      transition: opacity 0.15s;
    }

    .entry-header:hover .btn-copy-entry {
      opacity: 1;
    }

    .btn-copy-entry:hover {
      color: var(--text-main);
    }

    .entry-line {
      white-space: pre-wrap;
      padding-left: 16px;
      margin-top: 2px;
      user-select: text;
      -webkit-user-select: text;
    }

    .line-output {
      color: var(--color-green);
    }

    .line-warning {
      color: var(--color-yellow);
      background: rgba(210, 153, 34, 0.1);
      padding: 4px 12px;
      border-radius: 4px;
      margin: 4px 0 4px 16px;
    }

    .line-error {
      color: var(--color-red);
      background: rgba(248, 81, 73, 0.1);
      padding: 4px 12px;
      border-radius: 4px;
      margin: 4px 0 4px 16px;
    }

    /* Tree View & Toolbar */
    .k-entry-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }

    .k-output-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 2px;
      flex-wrap: wrap;
    }

    .k-mode-group, .k-action-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .k-btn-mode, .k-btn-action {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .k-btn-mode:hover, .k-btn-action:hover {
      background: var(--bg-subtle);
      color: var(--text-main);
      border-color: #8b949e;
    }

    .k-btn-mode.active {
      background: rgba(88, 166, 255, 0.2);
      border-color: var(--color-prompt);
      color: var(--color-prompt);
      font-weight: 600;
    }

    .k-tree-view {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .k-tree-section {
      background: rgba(22, 27, 34, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
    }

    .k-tree-section-summary {
      background: rgba(33, 38, 45, 0.5);
      padding: 6px 10px;
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      user-select: none;
      border-bottom: 1px solid transparent;
      transition: background 0.15s;
    }

    .k-tree-section[open] > .k-tree-section-summary {
      border-bottom-color: rgba(48, 54, 61, 0.5);
    }

    .k-tree-section-summary::-webkit-details-marker {
      display: none;
    }

    .k-tree-section-summary:hover {
      background: rgba(33, 38, 45, 0.8);
    }

    .k-section-title {
      font-weight: 700;
      color: var(--color-prompt);
      white-space: nowrap;
    }

    .k-section-preview {
      color: var(--text-muted);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .k-tree-section-body {
      padding: 8px 10px;
      font-size: 13px;
      line-height: 1.6;
      overflow-x: auto;
    }

    /* Tree Node & Summary */
    .k-tree-node {
      margin-left: 12px;
      border-left: 1px dashed rgba(48, 54, 61, 0.6);
      padding-left: 8px;
    }

    .k-tree-summary {
      cursor: pointer;
      list-style: none;
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      outline: none;
      user-select: none;
      padding: 1px 4px;
      border-radius: 4px;
      transition: background 0.15s;
    }

    .k-tree-summary::-webkit-details-marker {
      display: none;
    }

    .k-tree-summary:hover {
      background: rgba(88, 166, 255, 0.1);
    }

    .k-tree-arrow {
      display: inline-block;
      font-size: 8px;
      width: 10px;
      height: 10px;
      line-height: 10px;
      text-align: center;
      transition: transform 0.15s ease;
      color: var(--text-muted);
    }

    details[open] > summary > .k-tree-arrow {
      transform: rotate(90deg);
    }

    .k-tree-children {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .k-tree-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding-left: 8px;
      margin: 1px 0;
    }

    .k-tree-child-val, .k-tree-child-pat {
      flex: 1;
    }

    .k-tree-leaf {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      padding: 1px 4px;
    }

    /* Syntax Highlighting */
    .k-val-brace, .k-pat-brace {
      color: var(--color-yellow);
      font-weight: 600;
    }

    .k-pat-union {
      color: var(--color-cyan);
      font-weight: 600;
    }

    .k-val-pipe {
      color: var(--text-muted);
      font-weight: 700;
    }

    .k-val-tag {
      color: var(--color-purple);
      font-weight: 600;
    }

    .k-pat-tag {
      color: var(--color-cyan);
      font-weight: 600;
    }

    .k-tree-field-key, .k-pat-field-key {
      color: var(--color-blue);
      font-weight: 600;
    }

    .k-val-empty, .k-pat-empty {
      color: var(--text-muted);
      font-style: italic;
    }

    .k-pat-var {
      color: var(--color-green);
      font-weight: 700;
    }

    .k-pat-vardef {
      color: var(--color-green);
      font-size: 11px;
      font-weight: 600;
      background: rgba(63, 185, 80, 0.15);
      border-radius: 3px;
      padding: 0 4px;
    }

    .k-pat-any {
      color: var(--color-yellow);
      font-style: italic;
    }

    .k-pat-ellipsis {
      color: var(--text-muted);
      letter-spacing: 2px;
    }

    .k-val-preview {
      color: var(--text-muted);
      font-size: 11px;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .k-tree-badge {
      font-size: 10px;
      background: rgba(139, 148, 158, 0.15);
      color: var(--text-muted);
      padding: 1px 5px;
      border-radius: 10px;
      font-weight: 500;
    }

    .k-badge-cycle {
      background: rgba(248, 81, 73, 0.2);
      color: var(--color-red);
      font-weight: 600;
    }

    .k-codecs-box {
      background: rgba(22, 27, 34, 0.8);
      border: 1px solid var(--border-color);
      border-left: 3px solid var(--color-green);
      border-radius: 0 6px 6px 0;
      padding: 6px 12px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .k-codec-row {
      color: var(--color-green);
      font-weight: 500;
      font-size: 13px;
    }

    .k-timing-row {
      color: var(--text-muted);
      font-size: 11px;
      font-style: italic;
      padding: 2px 4px;
    }

    .k-raw-pre {
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: inherit;
      font-size: 13px;
      color: var(--color-green);
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
    }

    /* Welcome banner */
    .welcome-banner {
      padding: 12px 16px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 16px;
    }

    .welcome-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--color-prompt);
      margin-bottom: 0;
    }

    .welcome-desc {
      color: var(--text-muted);
      font-size: 13px;
      margin-bottom: 12px;
    }

    .welcome-tips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: var(--text-main);
    }

    .quick-link {
      color: var(--color-prompt);
      text-decoration: none;
      background: rgba(88, 166, 255, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid rgba(88, 166, 255, 0.2);
    }

    .quick-link:hover {
      text-decoration: underline;
      background: rgba(88, 166, 255, 0.2);
    }

    /* Input Bar */
    .terminal-input-bar {
      background: var(--bg-surface);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: flex-start;
      padding: 10px 16px;
      gap: 8px;
      position: relative;
    }

    .prompt-label {
      color: var(--color-prompt);
      font-weight: 700;
      font-size: 15px;
      padding-top: 4px;
      user-select: none;
      min-width: 18px;
    }

    .input-wrapper {
      flex: 1;
      position: relative;
    }

    #repl-input {
      width: 100%;
      background: var(--bg-input);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.4;
      resize: none;
      outline: none;
      min-height: 32px;
      max-height: 240px;
      transition: border-color 0.15s;
    }

    #repl-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
    }

    .btn-run {
      background: var(--color-prompt);
      color: #0d1117;
      border: none;
      font-weight: 700;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      align-self: flex-start;
    }

    .btn-run:hover {
      background: #79c0ff;
    }

    /* Autocomplete popup */
    .autocomplete-popup {
      display: none;
      position: absolute;
      bottom: calc(100% + 4px);
      left: 0;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      max-height: 180px;
      overflow-y: auto;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      z-index: 100;
      min-width: 240px;
    }

    .autocomplete-popup.visible {
      display: block;
    }

    .autocomplete-item {
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-main);
    }

    .autocomplete-item:hover, .autocomplete-item.active {
      background: rgba(88, 166, 255, 0.2);
      color: var(--color-prompt);
    }

    /* Footer hints */
    .terminal-footer {
      height: 24px;
      background: var(--bg-surface);
      border-top: 1px solid rgba(48, 54, 61, 0.5);
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 11px;
      color: var(--text-muted);
      gap: 8px;
      user-select: none;
      overflow-x: auto;
      white-space: nowrap;
    }

    /* Modals */
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 200;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .modal.open {
      display: flex;
    }

    .modal-dialog {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      width: 100%;
      max-width: 840px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }

    .modal-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-header h3 {
      font-size: 16px;
      font-weight: 600;
    }

    .btn-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
    }

    .btn-close:hover {
      color: var(--text-main);
    }

    .modal-body {
      padding: 20px;
      overflow-y: auto;
    }

    /* Help table */
    .help-section {
      margin-bottom: 20px;
    }

    .help-section h4 {
      font-size: 14px;
      color: var(--color-prompt);
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 4px;
    }

    .help-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .help-table th {
      text-align: left;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-color);
    }

    .help-table td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(48, 54, 61, 0.4);
    }

    .help-table td:first-child {
      width: 35%;
      font-family: var(--font-mono);
      color: var(--color-cyan);
    }

    .help-bridge-box {
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.25);
      border-left: 3px solid var(--color-prompt);
      border-radius: 4px;
      padding: 10px 14px;
      margin: 12px 0 16px 0;
      font-size: 12px;
      line-height: 1.5;
    }

    .help-category-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      margin: 16px 0 6px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .help-section ul {
      padding-left: 24px;
      font-size: 13px;
      color: var(--text-main);
    }

    .help-section li {
      margin-bottom: 6px;
    }

    /* VFS Dialog */
    .vfs-dialog {
      max-width: 900px;
      height: 75vh;
    }

    .vfs-body {
      padding: 0;
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .vfs-sidebar {
      width: 280px;
      background: var(--bg-base);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
    }

    .vfs-sidebar-title {
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
    }

    .vfs-files-list {
      flex: 1;
      overflow-y: auto;
    }

    .vfs-list-item {
      padding: 8px 14px;
      border-bottom: 1px solid rgba(48, 54, 61, 0.3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      transition: background 0.15s;
    }

    .vfs-list-item:hover {
      background: var(--bg-subtle);
      color: var(--color-prompt);
    }

    .vfs-file-size {
      color: var(--text-muted);
      font-size: 11px;
    }

    .vfs-viewer {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .vfs-viewer-header {
      height: 40px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: var(--bg-surface);
    }

    .vfs-preview-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--color-prompt);
    }

    .vfs-viewer-actions {
      display: flex;
      gap: 6px;
    }

    .vfs-code-view {
      flex: 1;
      padding: 16px;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      background: #090d12;
      color: var(--text-main);
      white-space: pre;
    }

    /* Drop Overlay */
    .drop-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(13, 17, 23, 0.85);
      border: 3px dashed var(--color-prompt);
      z-index: 500;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    .drop-overlay.visible {
      display: flex;
    }

    .drop-box {
      text-align: center;
    }

    .drop-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }

    .drop-text {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-prompt);
    }

    /* Codecs Subsystem & Badges */
    .badge-count {
      display: inline-block;
      min-width: 18px;
      height: 18px;
      line-height: 16px;
      text-align: center;
      padding: 0 5px;
      border-radius: 9px;
      font-size: 11px;
      font-weight: 700;
      background: rgba(139, 148, 158, 0.2);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
    }

    .badge-count.active {
      background: rgba(63, 185, 80, 0.2);
      color: var(--color-green);
      border-color: rgba(63, 185, 80, 0.4);
    }

    .codecs-dialog {
      max-width: 960px;
      max-height: 90vh;
    }

    .codecs-body {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
    }

    .codecs-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .codecs-section-header {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .codecs-section-header h4 {
      font-size: 14px;
      color: var(--color-prompt);
    }

    .section-subtitle {
      font-size: 11px;
      color: var(--text-muted);
    }

    .codec-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }

    .codec-card {
      background: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
      transition: border-color 0.15s;
    }

    .codec-card:hover {
      border-color: var(--border-focus);
    }

    .codec-card-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 6px;
    }

    .codec-icon {
      font-size: 16px;
    }

    .codec-name {
      flex: 1;
      color: #ffffff;
    }

    .codec-status-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(139, 148, 158, 0.15);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
    }

    .codec-status-badge.active {
      background: rgba(63, 185, 80, 0.15);
      color: var(--color-green);
      border-color: rgba(63, 185, 80, 0.4);
    }

    .codec-types {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .codec-desc {
      font-size: 11px;
      color: var(--text-main);
      line-height: 1.4;
    }

    .codec-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      border-top: 1px solid rgba(48, 54, 61, 0.4);
      padding-top: 8px;
    }

    .codec-caps {
      display: flex;
      gap: 4px;
    }

    .cap-badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 4px;
      font-weight: 500;
    }

    .cap-badge.print {
      background: rgba(188, 140, 255, 0.15);
      color: var(--color-purple);
      border: 1px solid rgba(188, 140, 255, 0.3);
    }

    .cap-badge.parse {
      background: rgba(57, 197, 207, 0.15);
      color: var(--color-cyan);
      border: 1px solid rgba(57, 197, 207, 0.3);
    }

    .badge-type {
      background: rgba(88, 166, 255, 0.15);
      color: var(--color-prompt);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: var(--font-mono);
      border: 1px solid rgba(88, 166, 255, 0.25);
    }

    .badge-type.universal {
      background: rgba(210, 153, 34, 0.15);
      color: var(--color-yellow);
      border-color: rgba(210, 153, 34, 0.3);
    }

    .badge-type.parameterized {
      background: rgba(187, 128, 179, 0.15);
      color: var(--color-purple);
      border-color: rgba(187, 128, 179, 0.3);
    }

    .codecs-table-container {
      background: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow-x: auto;
    }

    .codec-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .codec-table th {
      background: var(--bg-subtle);
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .codec-table td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(48, 54, 61, 0.3);
      vertical-align: middle;
    }

    .codec-cell-name {
      font-weight: 600;
      color: #ffffff;
    }

    .btn-danger {
      background: rgba(248, 81, 73, 0.1);
      color: var(--color-red);
      border-color: rgba(248, 81, 73, 0.3);
    }

    .btn-danger:hover {
      background: rgba(248, 81, 73, 0.25);
      border-color: var(--color-red);
    }

    .codec-studio-box {
      background: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .studio-top-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-end;
    }

    .studio-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .studio-field label {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 500;
    }

    .studio-field input, .studio-field select {
      background: var(--bg-input);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 12px;
    }

    .studio-field input:focus, .studio-field select:focus {
      border-color: var(--border-focus);
      outline: none;
    }

    .studio-editors-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    @media (max-width: 700px) {
      .studio-editors-grid {
        grid-template-columns: 1fr;
      }
    }

    .studio-editor-pane {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pane-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .pane-hint {
      font-size: 11px;
      color: var(--text-muted);
    }

    .codec-code-area {
      width: 100%;
      background: #090d12;
      color: var(--text-main);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.4;
      resize: vertical;
      min-height: 120px;
    }

    .codec-code-area:focus {
      border-color: var(--border-focus);
      outline: none;
    }

    .studio-test-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      border-top: 1px solid rgba(48, 54, 61, 0.4);
      padding-top: 10px;
    }

    .studio-test-input-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 200px;
    }

    .studio-test-input-wrap label {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .studio-test-input-wrap input {
      flex: 1;
      background: var(--bg-input);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 12px;
    }

    .studio-test-input-wrap input:focus {
      border-color: var(--border-focus);
      outline: none;
    }

    .studio-status-box {
      font-size: 12px;
      min-height: 20px;
    }


    /* Responsive */
    @media (max-width: 768px) {
      .navbar {
        padding: 8px 12px;
        gap: 8px;
      }
      .nav-left {
        width: 100%;
        justify-content: space-between;
      }
      .nav-right {
        width: 100%;
        justify-content: flex-start;
        overflow-x: visible;
        flex-wrap: wrap;
        gap: 6px;
      }
      .control-group {
        flex: 1 1 180px;
      }
      .control-group select {
        flex: 1 1 auto;
        max-width: 100%;
        min-width: 120px;
      }
      .vfs-body {
        flex-direction: column;
      }
      .vfs-sidebar {
        width: 100%;
        height: 160px;
        border-right: none;
        border-bottom: 1px solid var(--border-color);
      }
    }
  </style>
</head>
<body>
  <div id="app">
    <!-- Navbar -->
    <header class="navbar">
      <div class="nav-left">
        <div class="brand">
          <span class="brand-name">k repl</span>
          <span id="engine-badge" class="engine-badge" title="Click to toggle engine (wasm/js)">wasm-in-process</span>
        </div>
        <div class="status-indicator">
          <span id="status-dot" class="status-dot ready"></span>
          <span id="status-text">Ready</span>
        </div>
      </div>

      <div class="nav-right">
        <!-- Examples -->
        <div class="control-group">
          <select id="example-select" title="Choose an example or expression">
            <option value="">-- Example / Expression --</option>
            <optgroup label="Standard Examples">
              <option value="core.k">core.k</option>
              <option value="arithmetics.k">arithmetics.k</option>
              <option value="ieee.k">ieee.k</option>
              <option value="poly.k">poly.k</option>
              <option value="karatsuba-mult.k">karatsuba-mult.k</option>
            </optgroup>
            <optgroup label="Quick Expressions">
              <option value="expr:{} | ok">{} | ok</option>
              <option value="expr:not = &lt; / true | false, / false | true &gt;; {} | true not">not (boolean relation)</option>
              <option value="expr:1 succ">1 succ</option>
              <option value="expr:{10 int x, 5 int y} plus">{10 int x, 5 int y} plus (int)</option>
              <option value="expr:{10 int x, 5 int y} karatsuba">{10 int x, 5 int y} karatsuba</option>
              <option value="expr::rels">:rels (list relations)</option>
              <option value="expr::engine">:engine (show engine)</option>
              <option value="expr::engine wasm">:engine wasm</option>
              <option value="expr::engine js">:engine js</option>
            </optgroup>
            <optgroup label="Codecs &amp; Format Adapters">
              <option value="expr::codecs">:codecs</option>
              <option value="expr::input">:input (interactive dialog)</option>
              <option value="expr::codec load int.mjs">:codec load int.mjs</option>
              <option value="expr::codec load utf8.mjs">:codec load utf8.mjs</option>
              <option value="expr::codec load json.mjs">:codec load json.mjs</option>
              <option value="expr::codec load ieee.mjs">:codec load ieee.mjs</option>
              <option value="expr::codec load unit.mjs">:codec load unit.mjs</option>
              <option value="expr::input json.mjs {&quot;a&quot;:12,&quot;b&quot;:&quot;hello&quot;}">:input json.mjs {"a":12,"b":"hello"}</option>
              <option value="expr::input int.mjs [0,1,2]">:input int.mjs [0,1,2]</option>
            </optgroup>
          </select>
          <button id="btn-load-example" class="btn btn-primary">Load</button>
        </div>

        <!-- File Upload -->
        <label class="btn btn-secondary btn-file" title="Upload local file into VFS">
          <input type="file" id="file-upload" accept=".k,.klib,.wat,.ko,.mjs,.js,.json" style="display:none;">
          <span>📁 Upload</span>
        </label>

        <!-- VFS Explorer -->
        <button id="btn-vfs" class="btn btn-secondary" title="Explore Virtual File System">🗂 Files</button>

        <!-- Codecs Subsystem -->
        <button id="btn-codecs" class="btn btn-secondary" title="Codecs &amp; Custom Serializers (:codecs)">⚙ Codecs <span id="codecs-count-badge" class="badge-count">0</span></button>


        <!-- Clear -->
        <button id="btn-clear" class="btn btn-secondary" title="Clear terminal screen (Ctrl+L)">⌫ Clear</button>

        <!-- Export -->
        <button id="btn-export" class="btn btn-secondary" title="Export session to .klib">💾 Save .klib</button>

        <!-- Help -->
        <button id="btn-help" class="btn btn-secondary" title="Help & Reference (:help)">? Help</button>
      </div>
    </header>

    <!-- Terminal Main -->
    <main class="terminal-main">
      <div id="terminal-output" class="terminal-output"></div>

      <!-- Input Bar -->
      <div class="terminal-input-bar">
        <div id="prompt-label" class="prompt-label">> </div>
        <div class="input-wrapper">
          <textarea id="repl-input" rows="1" spellcheck="false" autocomplete="off" placeholder="Enter K expression or command (:help)..."></textarea>
          <div id="autocomplete-popup" class="autocomplete-popup"></div>
        </div>
        <button id="btn-run" class="btn-run" title="Execute (Enter / Ctrl+Enter)">▶ Run</button>
      </div>

      <!-- Footer Hints -->
      <div class="terminal-footer">
        <span>Enter: run</span>
        <span>• Shift+Enter: newline</span>
        <span>• Tab: autocomplete</span>
        <span>• ↑/↓: history</span>
        <span>• Ctrl+L: clear</span>
        <span>• Drag &amp; drop .k/.klib files anywhere</span>
      </div>
    </main>

    <!-- VFS Modal -->
    <div id="vfs-modal" class="modal">
      <div class="modal-dialog vfs-dialog">
        <div class="modal-header">
          <h3>Virtual File System (VFS)</h3>
          <button id="btn-close-vfs" class="btn-close">&times;</button>
        </div>
        <div class="modal-body vfs-body">
          <div class="vfs-sidebar">
            <div class="vfs-sidebar-title">Files in VFS</div>
            <div id="vfs-files-list" class="vfs-files-list"></div>
          </div>
          <div class="vfs-viewer">
            <div class="vfs-viewer-header">
              <span id="vfs-preview-name" class="vfs-preview-title">No file selected</span>
              <div class="vfs-viewer-actions">
                <button id="btn-vfs-load" class="btn btn-primary btn-sm">Load into REPL</button>
                <button id="btn-vfs-download" class="btn btn-secondary btn-sm">Download</button>
              </div>
            </div>
            <pre id="vfs-preview-content" class="vfs-code-view"></pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Codecs Modal -->
    <div id="codecs-modal" class="modal">
      <div class="modal-dialog codecs-dialog">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <h3>Enabled Codecs</h3>
            <span class="engine-badge">:codecs subsystem</span>
          </div>
          <button id="btn-close-codecs" class="btn-close">&times;</button>
        </div>
        <div class="modal-body codecs-body">
          <div class="codecs-section">
            <div class="codecs-section-header">
              <h4>Active Codecs in Current Session</h4>
              <span class="section-subtitle">Codecs format evaluation results and parse input for <code>:input &lt;codec.mjs&gt; [text]</code>. Codecs can only be loaded through <code>:codec load &lt;file.mjs&gt;</code> in the REPL or through the <b>Files</b> explorer.</span>
            </div>
            <div id="enabled-codecs-grid" class="codec-grid">
              <!-- dynamically populated: cards for only enabled/loaded codecs -->
            </div>
          </div>
        </div>
      </div>
    </div>


    <!-- Help Modal -->
    <div id="help-modal" class="modal">
      <div class="modal-dialog help-dialog">
        <div class="modal-header">
          <h3>K REPL Help &amp; Reference</h3>
          <button id="btn-close-help" class="btn-close">&times;</button>
        </div>
        <div class="modal-body help-body">
          <div class="help-section">
            <h4>Language Overview</h4>
            <p style="margin-bottom: 8px; color: var(--text-muted); line-height: 1.45;">
              <b>k</b> is a concise language of <b>relations</b> (functions) over tree-like (JSON-like) documents. Every expression denotes a relation that transforms an input document into an output document.
            </p>
            <p style="margin-bottom: 10px; color: var(--text-muted); line-height: 1.45;">
              <b>Content-Addressed:</b> Relations are identified by their canonical content hash (<code>@...</code>) derived directly from their structure. Local names are just temporary aliases used for recursion and readability.
            </p>

            <div class="help-category-title">1. Definitions (Local Aliases)</div>
            <p style="margin-bottom: 6px; color: var(--text-muted); font-size: 12px;">Definitions introduce local aliases for recursion and convenience (terminated by <code>;</code>):</p>
            <table class="help-table">
              <thead>
                <tr><th style="width: 38%;">Syntax</th><th>Description &amp; Example</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>name = relExpr;</code></td>
                  <td><b>Relation Alias:</b> Defines a local alias for a relation expression.<br><i>e.g.</i> <code>swap = { . y x, . x y };</code></td>
                </tr>
              </tbody>
            </table>

            <div class="help-category-title">2. Relation Expressions (<code>relExpr</code>)</div>
            <p style="margin-bottom: 6px; color: var(--text-muted); font-size: 12px;">Functions transforming an input document to an output document:</p>
            <table class="help-table">
              <thead>
                <tr><th style="width: 45%;">Syntax</th><th>Description</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>{ rel_1 label_1, ..., rel_k label_k }</code></td>
                  <td><b>Product:</b> Evaluates <i>k</i> relations into record fields (special case: <code>{}</code> evaluates 0 relations, producing empty record <code>{}</code>)</td>
                </tr>
                <tr>
                  <td><code>&lt; rel_1, ..., rel_k &gt;</code></td>
                  <td><b>Union (Choice):</b> Evaluates relations in order of arity <i>k</i> (tries <code>rel_1</code>; if it fails, tries <code>rel_2</code>, ..., <code>rel_k</code>)</td>
                </tr>
                <tr>
                  <td><code>( rel_1 ... rel_k )</code></td>
                  <td><b>Composition:</b> Sequentially composes <i>k</i> relations (special case: <code>()</code> is the 0-ary composition, denoting identity; parentheses may be omitted when non-empty: <code>f g</code>)</td>
                </tr>
                <tr>
                  <td><code>. label</code></td>
                  <td><b>Field Projection:</b> Extracts field <code>label</code> from a record</td>
                </tr>
                <tr>
                  <td><code>/ tag</code></td>
                  <td><b>Variant Branch:</b> Extracts payload of variant <code>tag</code> (fails if tag differs)</td>
                </tr>
                <tr>
                  <td><code>| tag</code></td>
                  <td><b>Variant Constructor:</b> Wraps document into variant <code>tag</code></td>
                </tr>
                <tr>
                  <td><code>? filterExpr</code></td>
                  <td><b>Pattern Filter:</b> Asserts input matches pattern; acts as partial identity and inductive termination witness (<i>e.g.</i> <code>?&lt; {} true, {} false &gt;</code>)</td>
                </tr>
                <tr>
                  <td><code>name</code> / <code>@hash</code></td>
                  <td><b>Relation Reference:</b> Calls a relation by local alias or canonical content hash</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="help-section">
            <h4>REPL Commands</h4>
            <table class="help-table">
              <tr><td><code>:engine [wasm|js]</code></td><td>Display or switch evaluation engine (<code>wasm</code> or <code>js</code>)</td></tr>
              <tr><td><code>:load &lt;file&gt;</code></td><td>Load a <code>.k</code> source or <code>.klib</code> library into current state</td></tr>
              <tr><td><code>:rel &lt;name&gt;</code></td><td>Display definition of relation <code>&lt;name&gt;</code></td></tr>
              <tr><td><code>:rels</code></td><td>List all relation aliases</td></tr>
              <tr><td><code>:codecs</code></td><td>List all loaded format codecs</td></tr>
              <tr><td><code>:codec load &lt;file.mjs&gt;</code></td><td>Load a codec from file (or load through Files)</td></tr>
              <tr><td><code>:codec unload &lt;file.mjs&gt;</code></td><td>Unload a loaded codec</td></tr>
              <tr><td><code>:input &lt;codec.mjs&gt; [text]</code></td><td>Parse input using specified codec (opens dialog if text omitted)</td></tr>
              <tr><td><code>:klib &lt;file&gt;</code></td><td>Export current state as a <code>.klib</code> binary file</td></tr>
              <tr><td><code>:reset</code></td><td>Clear state and reset to initial environment</td></tr>
              <tr><td><code>:help</code></td><td>Show command reference</td></tr>
            </table>
          </div>

          <div class="help-section">
            <h4>Expressions &amp; Snippets</h4>
            <p style="margin-bottom: 8px; color: var(--text-muted);">Any raw K expression entered at the prompt is compiled and evaluated on top of the current state using WebAssembly.</p>
            <ul>
              <li><code>{} | ok</code> &mdash; Constant relation producing variant <code>ok</code> with empty document payload <code>{}</code></li>
              <li><code>not = &lt; / true | false, / false | true &gt;;</code> &mdash; Polymorphic negation via branch projections and ordered choice</li>
              <li><code>{} | true not</code> &mdash; Compose constant relation <code>{} | true</code> with <code>not</code> (evaluates to <code>{} | false</code>)</li>
              <li><code>bool = ?&lt; {} true, {} false &gt;;</code> &mdash; Define a boolean pattern filter relation</li>
              <li><code>not = bool ?X &lt; / true | false, {} | true &gt; ?X;</code> &mdash; Filtered boolean negation: guarded by <code>bool</code>, defaulting to <code>{} | true</code></li>
              <li><code>swap = { . y x, . x y };</code> &mdash; Define a product field-swapping relation</li>
              <li><code>{ {} | ok x, {} | nil y } swap</code> &mdash; Construct a product and pass it through <code>swap</code></li>
            </ul>
          </div>

          <div class="help-section">
            <h4>Keyboard Shortcuts</h4>
            <table class="help-table">
              <tr><td><code>Enter</code></td><td>Execute if snippet is complete, otherwise insert newline</td></tr>
              <tr><td><code>Shift+Enter</code></td><td>Insert newline without executing</td></tr>
              <tr><td><code>Ctrl+Enter</code> / <code>Cmd+Enter</code></td><td>Force execute whatever is in input</td></tr>
              <tr><td><code>Tab</code></td><td>Autocomplete commands, aliases, and filenames</td></tr>
              <tr><td><code>↑</code> / <code>↓</code></td><td>Navigate command history</td></tr>
              <tr><td><code>Ctrl+L</code></td><td>Clear terminal output</td></tr>
              <tr><td><code>Esc</code></td><td>Dismiss autocomplete / clear input</td></tr>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Drop Overlay -->
    <div id="drop-overlay" class="drop-overlay">
      <div class="drop-box">
        <div class="drop-icon">📥</div>
        <div class="drop-text">Drop .k or .klib file to load into REPL</div>
      </div>
    </div>
  </div>

  <script type="module">
${bundledJs}
  </script>
</body>
</html>
`;

// 5. Write to repl.html in package dir and workspace root
const outPath = path.join(projectRoot, "repl.html");
fs.writeFileSync(outPath, htmlContent, "utf8");
console.log(`4. Successfully wrote: ${outPath} (${(htmlContent.length / 1024).toFixed(1)} KB)`);

// Also copy to workspace root if different
if (workspaceRoot !== projectRoot && fs.existsSync(workspaceRoot)) {
  const wsOutPath = path.join(workspaceRoot, "repl.html");
  fs.writeFileSync(wsOutPath, htmlContent, "utf8");
  console.log(`   Also wrote to: ${wsOutPath}`);
}

console.log("=== Build complete! ===");
