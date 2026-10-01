import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { encodeToWire, decodeWire } from "./codecs/runtime/prefix-codec.mjs";
import { deriveClosedPattern } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { finalize } from "./codes.mjs";
import * as intCodec from "./codecs/int.mjs";
import * as utf8Codec from "./codecs/utf8.mjs";
import * as jsonCodec from "./codecs/json.mjs";
import * as ieeeCodec from "./codecs/ieee.mjs";
import * as unitCodec from "./codecs/unit.mjs";

const BUILTIN_CODECS = {
  int: intCodec,
  utf8: utf8Codec,
  json: jsonCodec,
  ieee: ieeeCodec,
  unit: unitCodec
};

const UNIVERSAL_CODE = "*";
const NAME_RE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function isCanonicalCodeName(name) {
  return typeof name === "string" && name.startsWith("@");
}

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
  if (Array.isArray(codec?.patterns) && codec.patterns.length > 0) {
    for (const pat of codec.patterns) {
      try {
        return decodeWire(encodeToWire(value, pat)).value;
      } catch {}
    }
  }
  try {
    return decodeWire(encodeToWire(value)).value;
  } catch {}
  return value;
}

function normalizeCodecModule(mod, fallbackName) {
  const codec = mod.replCodec || mod.codec || mod.default || mod;
  const name = codec.name || mod.name || fallbackName;
  if (!name || typeof name !== "string") {
    throw new Error("Codec module must export a string name");
  }
  if (codec.parse != null && typeof codec.parse !== "function") {
    throw new Error(`Codec '${name}' parse export must be a function`);
  }
  if (codec.print != null && typeof codec.print !== "function") {
    throw new Error(`Codec '${name}' print export must be a function`);
  }
  return {
    name,
    parse: codec.parse,
    print: codec.print,
    pattern: codec.pattern,
    patterns: codec.patterns
  };
}

function codecStore(state) {
  if (!state.codecs) state.codecs = {};
  return state.codecs;
}

function registerCodec(state, rawCodec, source = null) {
  const codec = normalizeCodecModule(rawCodec, rawCodec.name);
  const store = codecStore(state);
  store[codec.name] = {
    ...codec,
    source
  };
  return [{ name: codec.name, source }];
}

function unregisterCodec(state, codecName) {
  const store = codecStore(state);
  if (!store[codecName]) return 0;
  delete store[codecName];
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
  const loaded = Object.keys(store);
  const builtins = Object.keys(BUILTIN_CODECS);
  return [...new Set([...loaded, ...builtins])].sort();
}

function matchBuiltinCodec(target) {
  const normalized = target.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const base = path.basename(normalized, path.extname(normalized));
  if (BUILTIN_CODECS[base]) return { name: base, mod: BUILTIN_CODECS[base] };
  return null;
}

function resolveCodec(state, codecName, capability = null) {
  if (!codecName) {
    throw new Error("Codec name is required");
  }
  const store = codecStore(state);
  let codec = store[codecName];
  if (!codec) {
    const builtin = matchBuiltinCodec(codecName);
    if (builtin) {
      registerCodec(state, builtin.mod, "built-in");
      codec = store[builtin.name];
    }
  }
  if (!codec) {
    throw new Error(`Codec '${codecName}' is not loaded`);
  }
  if (capability && typeof codec[capability] !== "function") {
    throw new Error(`Codec '${codecName}' does not support ${capability}`);
  }
  return codec;
}

async function loadCodecModule(state, filePath) {
  const builtin = matchBuiltinCodec(filePath);
  if (builtin) {
    return registerCodec(state, builtin.mod, "built-in");
  }

  let source = null;
  try {
    if (fs.existsSync(filePath)) {
      source = fs.readFileSync(filePath, "utf8");
    }
  } catch {}

  const resolved = path.resolve(filePath);
  if (!source && fs.existsSync(resolved)) {
    try {
      source = fs.readFileSync(resolved, "utf8");
    } catch {}
  }

  if (typeof process !== "undefined" && process?.versions?.node && fs.existsSync(resolved)) {
    try {
      const url = pathToFileURL(resolved);
      try {
        const stats = fs.statSync(resolved);
        if (stats?.mtimeMs) url.searchParams.set("mtime", String(stats.mtimeMs));
      } catch {}
      const mod = await import(url.href);
      return registerCodec(state, mod, resolved);
    } catch (nodeErr) {
      if (!source) throw nodeErr;
    }
  }

  if (!source) {
    throw new Error(`Cannot find codec file '${filePath}'`);
  }

  const sanitized = source.replace(
    /import\s+[^;]*from\s+['"][^'"]*['"];?/g,
    "const { Value, isProduct, isVariant, NODE_KIND } = globalThis;"
  );
  const dataUrl = "data:text/javascript;charset=utf-8," + encodeURIComponent(sanitized);
  const mod = await import(dataUrl);
  return registerCodec(state, mod, filePath);
}

export {
  BUILTIN_CODECS,
  codecNames,
  codeHashToPattern,
  listCodecs,
  loadCodecModule,
  normalizeCodecModule,
  registerCodec,
  resolveCodec,
  unregisterCodec,
  closedPatternToCodeHash,
  UNIVERSAL_CODE,
  valueForCode,
  valueForPattern,
  matchBuiltinCodec,
  ensureEnveloped
};
