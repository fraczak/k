import { PHASES, formatUs } from "./trace.mjs";

export function formatPhaseTable(phaseResults, backendIds = ["arm64", "llvm", "wasm", "kvm"]) {
  const lines = [];

  for (const item of phaseResults) {
    lines.push(`\n--- Operation: ${item.op || item.name} (${item.label || ""}) ---`);
    const header = ["Phase".padEnd(25), ...backendIds.map(id => id.padEnd(14))].join(" | ");
    lines.push(header);
    lines.push("-".repeat(header.length));

    for (const phase of PHASES) {
      if (phase.isTotal) {
        lines.push("-".repeat(header.length));
      }
      const pName = phase.name.padEnd(25);
      const cols = backendIds.map(id => {
        const val = item[id]?.[phase.key];
        return formatUs(val).padEnd(14);
      });
      lines.push([pName, ...cols].join(" | "));
    }
  }

  return lines.join("\n");
}

export function formatProfileTable(profileResults, backendIds = ["arm64", "wasm", "kvm"]) {
  const lines = [];

  for (const item of profileResults) {
    lines.push(`\nFunction Call Profile: ${item.op || item.name}`);
    const header = ["Function Name".padEnd(30), ...backendIds.map(id => `${id} Calls`.padEnd(18))].join(" | ");
    lines.push(header);
    lines.push("-".repeat(header.length));

    const funcNames = new Set();
    for (const id of backendIds) {
      const prof = item[id] || {};
      for (const fn of Object.keys(prof)) funcNames.add(fn);
    }

    const sortedFuncs = [...funcNames].sort();
    const totals = Object.fromEntries(backendIds.map(id => [id, 0]));

    for (const fn of sortedFuncs) {
      const rowCols = backendIds.map(id => {
        const count = item[id]?.[fn];
        if (count != null) {
          totals[id] += count;
          return String(count).padStart(18);
        }
        return " - ".padStart(18);
      });
      lines.push([fn.padEnd(30), ...rowCols].join(" | "));
    }

    lines.push("-".repeat(header.length));
    const totalRow = backendIds.map(id => String(totals[id]).padStart(18));
    lines.push(["Total Calls".padEnd(30), ...totalRow].join(" | "));
  }

  return lines.join("\n");
}

export function formatBenchmarkTable(benchResults) {
  const lines = [];
  const hasPureEval = benchResults.some(r => r.pureEvalMs != null);
  const header = [
    "Backend".padEnd(35),
    "Mean (ms/iter)".padStart(15),
    ...(hasPureEval ? ["Pure Eval (ms)".padStart(15)] : []),
    "Min (ms)".padStart(12),
    "Max (ms)".padStart(12),
    "Samples".padStart(10)
  ].join(" | ");

  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const res of benchResults) {
    const name = (res.name || res.id).padEnd(35);
    const mean = (res.perIterationMs != null ? res.perIterationMs.toFixed(3) : "N/A").padStart(15);
    const pureEval = hasPureEval
      ? (res.pureEvalMs != null ? res.pureEvalMs.toFixed(3) : "-").padStart(15)
      : null;
    const min = (res.minMs != null ? res.minMs.toFixed(3) : "-").padStart(12);
    const max = (res.maxMs != null ? res.maxMs.toFixed(3) : "-").padStart(12);
    const samples = (res.samples != null ? String(res.samples) : "0").padStart(10);
    const cols = [name, mean, ...(pureEval ? [pureEval] : []), min, max, samples];
    lines.push(cols.join(" | "));
  }

  return lines.join("\n");
}
