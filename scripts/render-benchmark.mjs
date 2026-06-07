#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(root, process.argv[2] || "benchmark-results.json");
const outputPath = path.resolve(root, process.argv[3] || "benchmark-results.html");

const rowOrder = [
  "Native JS (Envelope-Aware)",
  "Native JS (Envelope-Free)",
  "kVM Interpreter (Env-Free)"
];

const columnGroups = [
  {
    title: "ieee",
    source: "Examples/ieee.k",
    columns: [
      { key: "ieee.add", label: "add" },
      { key: "ieee.div", label: "div" },
      { key: "ieee.mul", label: "mul" },
      { key: "ieee.sub", label: "sub" }
    ]
  },
  {
    title: "int",
    source: "Examples/arithmetics.k",
    columns: [
      { key: "int.factorial", label: "factorial" },
      { key: "int.gcd.90d", label: "gcd" },
      { key: "int.times.220d", label: "times" }
    ]
  }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function fmtMs(value) {
  return value == null ? "n/a" : `${value.toFixed(2)} ms`;
}

function fmtMiB(value) {
  return value == null ? "n/a" : `${value.toFixed(1)} MiB`;
}

function fmtRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "";
}

function resultMap(results) {
  const map = new Map();
  for (const result of results) {
    if (!map.has(result.mode)) map.set(result.mode, new Map());
    map.get(result.mode).set(result.case, result);
  }
  return map;
}

function factorialResults(byCase) {
  return [...byCase.entries()]
    .filter(([caseName]) => caseName.startsWith("int.factorial."))
    .sort(([a], [b]) => Number(a.split(".").at(-1)) - Number(b.split(".").at(-1)))
    .map(([caseName, result]) => ({
      input: caseName.split(".").at(-1),
      result
    }));
}

function bestForColumn(results, column) {
  const relevant = column.key === "int.factorial"
    ? results.filter(result => result.case.startsWith("int.factorial."))
    : results.filter(result => result.case === column.key);
  return relevant
    .filter(result => result.status === "ok" && typeof result.avgMs === "number")
    .sort((a, b) => a.avgMs - b.avgMs)[0] || null;
}

function cellFor(result, best) {
  if (!result) return `<span class="muted">not run</span>`;
  if (result.status !== "ok") return `<span class="bad">${escapeHtml(result.status)}</span>`;
  const ratio = best ? result.avgMs / best.avgMs : NaN;
  return `
    <div class="time">${fmtMs(result.avgMs)} <span>${fmtRatio(ratio)}</span></div>
    <div class="sub">rss ${fmtMiB(result.maxRssMiB)}</div>`;
}

function factorialCell(byCase, allResults) {
  const rows = factorialResults(byCase);
  if (rows.length === 0) return `<span class="muted">not run</span>`;
  return rows.map(({ input, result }) => {
    const best = bestForColumn(allResults, { key: result.case });
    return `
      <div class="mini">
        <span class="mini-label">${escapeHtml(input)}</span>
        <div>${cellFor(result, best)}</div>
      </div>`;
  }).join("");
}

function buildMatrix(doc) {
  const results = doc.results || [];
  const byMode = resultMap(results);

  const groupHeader = columnGroups.map(group =>
    `<th colspan="${group.columns.length}" class="group">${escapeHtml(group.title)} <span>${escapeHtml(group.source)}</span></th>`
  ).join("");

  const columnHeader = columnGroups.flatMap(group => group.columns)
    .map(column => `<th>${escapeHtml(column.label)}</th>`)
    .join("");

  const body = rowOrder.map(mode => {
    const byCase = byMode.get(mode) || new Map();
    const cells = columnGroups.flatMap(group => group.columns).map(column => {
      if (column.key === "int.factorial") {
        return `<td>${factorialCell(byCase, results)}</td>`;
      }
      return `<td>${cellFor(byCase.get(column.key), bestForColumn(results, column))}</td>`;
    }).join("");
    return `<tr><th class="row-head">${escapeHtml(mode)}</th>${cells}</tr>`;
  }).join("");

  return `
    <table class="matrix">
      <thead>
        <tr><th></th>${groupHeader}</tr>
        <tr><th>implementation</th>${columnHeader}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function buildDetails(results) {
  return results
    .slice()
    .sort((a, b) => a.case.localeCompare(b.case) || a.mode.localeCompare(b.mode))
    .map(result => `
      <tr>
        <td>${escapeHtml(result.case)}</td>
        <td>${escapeHtml(result.mode)}</td>
        <td>${escapeHtml(result.status)}</td>
        <td class="num">${fmtMs(result.avgMs)}</td>
        <td class="num">${fmtMs(result.minMs)}</td>
        <td class="num">${fmtMs(result.maxMs)}</td>
        <td class="num">${fmtMiB(result.maxRssMiB)}</td>
        <td class="hash">${escapeHtml(result.resultDigest || "")}</td>
      </tr>`)
    .join("");
}

function render(doc) {
  const results = doc.results || [];
  const generatedAt = doc.generatedAt ? new Date(doc.generatedAt).toLocaleString() : "unknown";
  const completed = results.filter(result => result.status === "ok").length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>k Benchmark Results</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17212f;
      --muted: #627083;
      --line: #d9e0ea;
      --paper: #f5f7fa;
      --panel: #fff;
      --accent: #1d5fd1;
      --soft: #eef3fb;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--paper);
    }
    header {
      padding: 28px 32px 20px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: 0; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      color: var(--muted);
      font-size: 14px;
    }
    main {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px 32px 40px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric { padding: 14px 16px; }
    .metric .label { color: var(--muted); font-size: 13px; }
    .metric .value { margin-top: 5px; font-size: 22px; font-weight: 700; }
    .panel { overflow: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 12px;
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    thead th {
      background: #fafbfd;
      color: var(--muted);
      font-weight: 700;
    }
    .matrix {
      min-width: 980px;
    }
    .matrix .group {
      text-align: center;
      color: var(--ink);
      font-size: 15px;
      background: var(--soft);
    }
    .matrix .group span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      margin-top: 2px;
    }
    .row-head {
      width: 230px;
      color: var(--ink);
      font-weight: 800;
      background: #fbfcfe;
    }
    .time {
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .time span {
      color: var(--muted);
      font-weight: 600;
      margin-left: 4px;
    }
    .sub {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .mini {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid #edf1f6;
    }
    .mini:last-child { border-bottom: 0; }
    .mini-label {
      color: var(--muted);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .muted { color: var(--muted); }
    .bad { color: var(--bad); font-weight: 800; }
    h2 { margin: 24px 0 10px; font-size: 18px; }
    .details { margin-top: 16px; }
    .details table { min-width: 920px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .hash { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); }
    @media (max-width: 900px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      .summary { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>k Benchmark Results</h1>
    <div class="meta">
      <span>Generated: ${escapeHtml(generatedAt)}</span>
      <span>Node: ${escapeHtml(doc.node || "unknown")}</span>
      <span>Platform: ${escapeHtml(doc.platform || "unknown")}</span>
      <span>CPUs: ${escapeHtml(doc.cpuCount ?? "unknown")}</span>
      <span>Samples/job: ${escapeHtml(doc.samples ?? "unknown")}</span>
    </div>
  </header>
  <main>
    <section class="summary">
      <div class="metric"><div class="label">Completed Jobs</div><div class="value">${completed}/${results.length}</div></div>
      <div class="metric"><div class="label">Timeout</div><div class="value">${((doc.timeoutMs || 0) / 60000).toFixed(1)} min</div></div>
      <div class="metric"><div class="label">Parallel Jobs</div><div class="value">${escapeHtml(doc.parallelJobs ?? "n/a")}</div></div>
      <div class="metric"><div class="label">Result Rows</div><div class="value">${results.length}</div></div>
    </section>
    <section class="panel">
      ${buildMatrix(doc)}
    </section>
    <section class="details">
      <h2>Raw Result Rows</h2>
      <div class="panel">
        <table>
          <thead>
            <tr><th>Case</th><th>Mode</th><th>Status</th><th>Avg</th><th>Min</th><th>Max</th><th>Max RSS</th><th>Digest</th></tr>
          </thead>
          <tbody>${buildDetails(results)}</tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
fs.writeFileSync(outputPath, render(data));
console.log(`Rendered ${path.relative(root, outputPath)} from ${path.relative(root, inputPath)}`);
