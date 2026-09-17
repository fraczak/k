// 7-phase trace protocol and aggregation

export const PHASES = [
  { name: "1. IPC Read (Pipe In)", key: "ipcReadNs" },
  { name: "2. Wire Decode & Validate", key: "decodeNs" },
  { name: "3. Flat Input Prep (Arena)", key: "flatInNs" },
  { name: "4. Pure Evaluation", key: "evalNs" },
  { name: "5. Flat Output Prep (Arena)", key: "flatOutNs" },
  { name: "6. Wire Encode", key: "encodeNs" },
  { name: "7. IPC Write (Pipe Out)", key: "ipcWriteNs" },
  { name: "Total Request Time", key: "totalNs", isTotal: true }
];

export function parseTraceLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== "K_TRACE_PHASES") return null;
  const result = {};
  for (let i = 1; i < parts.length; i++) {
    const [key, val] = parts[i].split("=");
    if (!key || val == null) continue;
    if (key === "backend") {
      result.backend = val;
    } else {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = Number(val);
    }
  }
  return result;
}

export function averageTrace(samples) {
  if (!samples || samples.length === 0) return null;
  const result = {};
  for (const phase of PHASES) {
    const key = phase.key;
    const values = samples.map(s => s[key]).filter(v => v != null && !isNaN(v));
    if (values.length > 0) {
      result[key] = values.reduce((sum, v) => sum + v, 0) / values.length;
    } else {
      result[key] = 0;
    }
  }
  return result;
}

export function formatUs(ns) {
  if (ns == null || ns === 0) return "      -     ";
  const us = ns / 1000;
  return `${us.toFixed(2)} µs`.padStart(12);
}
