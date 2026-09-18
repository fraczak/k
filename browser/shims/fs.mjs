import { Buffer } from "./buffer.mjs";
import { vfsData } from "../vfs-data.mjs";

const vfs = new Map();
if (vfsData && typeof vfsData === "object") {
  for (const [k, v] of Object.entries(vfsData)) {
    vfs.set(k, v);
  }
}

function cleanPath(p) {
  let s = (p instanceof URL ? p.pathname : (p?.pathname || String(p))).replace(/\\/g, "/");
  if (s.startsWith("file://")) s = s.replace(/^file:\/\//, "");
  if (s.endsWith("runtime.wat")) return "backends/wasm/runtime.wat";
  const exIdx = s.lastIndexOf("Examples/");
  if (exIdx !== -1) return s.slice(exIdx);
  const wasmIdx = s.lastIndexOf("backends/wasm/");
  if (wasmIdx !== -1) return s.slice(wasmIdx);
  if (s.startsWith("./")) s = s.slice(2);
  while (s.startsWith("/")) s = s.slice(1);
  return s;
}

export function setVfsFile(path, content) {
  const cleaned = cleanPath(path);
  vfs.set(cleaned, content);
}

export function getVfsFile(path) {
  return vfs.get(cleanPath(path));
}

export function getAllVfsFiles() {
  return Array.from(vfs.keys());
}

export function readFileSync(filePath, options) {
  const cleaned = cleanPath(filePath);
  const data = vfs.get(cleaned);
  if (data === undefined) {
    throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
  }
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (encoding === "utf8" || encoding === "utf-8") {
    if (typeof data === "string") return data;
    return new TextDecoder().decode(data);
  }
  if (typeof data === "string") {
    return Buffer.from(data, "utf8");
  }
  return Buffer.from(data);
}

export function writeFileSync(filePath, data) {
  const cleaned = cleanPath(filePath);
  vfs.set(cleaned, data);
}

export function existsSync(filePath) {
  const cleaned = cleanPath(filePath);
  return vfs.has(cleaned);
}

export function readdirSync(dirPath, options = {}) {
  const cleanedDir = cleanPath(dirPath);
  const prefix = (!cleanedDir || cleanedDir === ".") ? "" : (cleanedDir.endsWith("/") ? cleanedDir : cleanedDir + "/");
  const results = new Set();
  for (const key of vfs.keys()) {
    if (prefix === "" || key.startsWith(prefix)) {
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) results.add(name);
    }
  }
  const withFileTypes = options?.withFileTypes ?? false;
  if (withFileTypes) {
    return Array.from(results).map(name => {
      const subPrefix = prefix + name + "/";
      let isDir = false;
      for (const k of vfs.keys()) {
        if (k.startsWith(subPrefix)) {
          isDir = true;
          break;
        }
      }
      return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir
      };
    });
  }
  return Array.from(results);
}

export function realpathSync(p) {
  return cleanPath(p);
}

export function statSync(p) {
  const data = readFileSync(p);
  const size = typeof data === "string" ? new TextEncoder().encode(data).length : data.length;
  return {
    size,
    isFile: () => true,
    isDirectory: () => false
  };
}

export default {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
  setVfsFile,
  getVfsFile,
  getAllVfsFiles
};
