import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function safeDeepEqual(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x === y) continue;
    if (x == null || y == null) {
      if (x !== y) return false;
      continue;
    }
    if (typeof x !== "object" || typeof y !== "object") {
      if (x !== y) return false;
      continue;
    }
    // Handle k Value objects
    if (x.type !== undefined || y.type !== undefined) {
      if (x.type !== y.type) return false;
      if (x.tag !== y.tag) return false;
      if (x.value !== undefined || y.value !== undefined) {
        stack.push([x.value, y.value]);
      }
      if (x.product !== undefined || y.product !== undefined) {
        const xp = x.product || {};
        const yp = y.product || {};
        const xk = Object.keys(xp);
        const yk = Object.keys(yp);
        if (xk.length !== yk.length) return false;
        for (const k of xk) {
          if (!Object.hasOwn(yp, k)) return false;
          stack.push([xp[k], yp[k]]);
        }
      }
      continue;
    }
    // Generic object/record comparison
    const xk = Object.keys(x);
    const yk = Object.keys(y);
    if (xk.length !== yk.length) return false;
    for (const k of xk) {
      if (!Object.hasOwn(y, k)) return false;
      stack.push([x[k], y[k]]);
    }
  }
  return true;
}

export function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

export function average(numbers) {
  if (!numbers || numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

export function stdDev(numbers) {
  if (!numbers || numbers.length < 2) return 0;
  const avg = average(numbers);
  const variance = numbers.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) / (numbers.length - 1);
  return Math.sqrt(variance);
}

export function min(numbers) {
  if (!numbers || numbers.length === 0) return 0;
  return Math.min(...numbers);
}

export function max(numbers) {
  if (!numbers || numbers.length === 0) return 0;
  return Math.max(...numbers);
}

export function formatTiming(result) {
  if (result == null) return "unavailable";
  if (result.status === "overflow") return "stack overflow (no TCO)";
  if (!result.iterationTimes) return "unavailable";
  const samples = result.iterationTimes.map(time => time.toFixed(2)).join(", ");
  return `(${samples}) ~ ${average(result.iterationTimes).toFixed(2)} ms/iteration`;
}

export function makeCacheDir(prefix = "k-harness-") {
  if (process.env.K_HARNESS_CACHE_DIR) {
    fs.mkdirSync(process.env.K_HARNESS_CACHE_DIR, { recursive: true });
    return process.env.K_HARNESS_CACHE_DIR;
  }
  const defaultDir = path.join(os.tmpdir(), `${prefix}cache`);
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}
