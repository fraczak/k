import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { encodeToWire, decodeWire } from "./codecs/runtime/prefix-codec.mjs";
import { deriveClosedPattern } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { finalize } from "./codes.mjs";


function closedPatternToCodeHash(pattern) {
  if (!Array.isArray(pattern) || pattern.length === 0) {
    return null;
  }

  const codeDefs = {};
  for (let i = 0; i < pattern.length; i++) {
    const [kind, edges] = pattern[i] || [];
    if (kind !== "closed-product" && kind !== "closed-union") {
      return null;
    }
    if (!Array.isArray(edges)) {
      throw new Error(`Invalid closed pattern node ${i}`);
    }

    const code = kind === "closed-product" ? "product" : "union";
    codeDefs[`C${i}`] = {
      code,
      [code]: Object.fromEntries(edges.map(([label, target]) => {
        if (!Number.isInteger(target) || target < 0 || target >= pattern.length) {
          throw new Error(`Invalid closed pattern edge target ${target}`);
        }
        return [label, `C${target}`];
      }))
    };
  }

  return finalize(codeDefs).representatives.C0 || null;
}

function codeHashToPattern(codeHash, findCode) {
  const code = findCode(codeHash);
  if (!code || code.code === "undefined") {
    throw new Error(`Unknown type '${codeHash}'`);
  }
  const resolveType = (name) => {
    const resolved = findCode(name);
    if (!resolved || resolved.code === "undefined") {
      throw new Error(`Unknown type '${name}'`);
    }
    return resolved;
  };
  return patternToPropertyList(deriveClosedPattern(codeHash, code, resolveType));
}

function valueForPattern(value, pattern = null) {
  if (pattern) {
    return decodeWire(encodeToWire(value, pattern)).value;
  }
  return decodeWire(encodeToWire(value)).value;
}

function valueForCode(value, codeHash, findCode) {
  const pattern = codeHashToPattern(codeHash, findCode);
  return valueForPattern(value, pattern);
}

function ensureEnveloped(value, codec = null) {
  if (!value || typeof value !== "object") return value;
  if (value.pattern) return value;
  if (codec?.pattern) {
    try {
      return decodeWire(encodeToWire(value, codec.pattern)).value;
    } catch {}
  }
  try {
    return decodeWire(encodeToWire(value)).value;
  } catch {}
  return value;
}

function normalizeCodecModule(mod, name) {
  const codec = mod.replCodec || mod.codec || mod.default || mod;
  return {
    name,
    parse: codec.parse,
    print: codec.print,
    pattern: codec.pattern
  };
}

function codecStore(state) {
  if (!state.codecs) state.codecs = {};
  return state.codecs;
}

function registerCodec(state, rawCodec, filePath) {
  const name = path.basename(filePath);
  const codec = normalizeCodecModule(rawCodec, name);
  const store = codecStore(state);
  store[codec.name] = {
    ...codec,
    source: filePath
  };
  return [{ name: codec.name, source: filePath }];
}

function unregisterCodec(state, codecName) {
  const store = codecStore(state);
  const baseName = path.basename(codecName);
  const key = store[codecName] ? codecName : (store[baseName] ? baseName : null);
  if (!key) return 0;
  delete store[key];
  return 1;
}

function listCodecs(state) {
  const store = codecStore(state);
  const entries = Object.values(store).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) return "(none)";
  return entries.map((c) => `${c.name}${c.source ? ` (${c.source})` : ""}`).join("\n");
}

function codecNames(state) {
  const store = codecStore(state);
  return Object.keys(store).sort();
}

function resolveCodec(state, codecName, capability = null) {
  if (!codecName) {
    throw new Error("Codec name is required");
  }
  const store = codecStore(state);
  const baseName = path.basename(codecName);
  const codec = store[codecName] || store[baseName];
  if (!codec) {
    throw new Error(`Codec '${codecName}' is not loaded`);
  }
  if (capability && typeof codec[capability] !== "function") {
    throw new Error(`Codec '${codecName}' does not support ${capability}`);
  }
  return codec;
}

async function loadCodecModule(state, filePath) {
  let mod;
  if (typeof process !== "undefined" && process?.versions?.node) {
    const fullPath = path.resolve(filePath);
    const url = pathToFileURL(fullPath);
    try {
      const stats = fs.statSync(fullPath);
      if (stats?.mtimeMs) url.searchParams.set("mtime", String(stats.mtimeMs));
    } catch {}
    mod = await import(url.href);
  } else {
    const rawSource = fs.readFileSync(filePath, "utf8");
    const source = rawSource.replace(/^#![^\n]*\n/, "");
    const blob = new Blob([source], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      mod = await import(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  return registerCodec(state, mod, filePath);
}

export {
  codecNames,
  codeHashToPattern,
  listCodecs,
  loadCodecModule,
  normalizeCodecModule,
  registerCodec,
  resolveCodec,
  unregisterCodec,
  closedPatternToCodeHash,
  valueForCode,
  valueForPattern,
  ensureEnveloped
};
