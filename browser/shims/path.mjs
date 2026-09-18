export function normalize(path) {
  const parts = path.split("/").filter(Boolean);
  const stack = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  const prefix = path.startsWith("/") ? "/" : "";
  return prefix + stack.join("/");
}

export function join(...parts) {
  return normalize(parts.filter(Boolean).join("/"));
}

export function dirname(path) {
  const normalized = normalize(path);
  const idx = normalized.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return normalized.slice(0, idx);
}

export function basename(path, ext) {
  const normalized = normalize(path);
  let base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

export function extname(path) {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx);
}

export function resolve(...parts) {
  return join(...parts);
}

export default {
  normalize,
  join,
  dirname,
  basename,
  extname,
  resolve
};
