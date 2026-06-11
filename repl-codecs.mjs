import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { encodeToWire, decodeWire } from "./codecs/runtime/prefix-codec.mjs";
import { deriveClosedPattern } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import { finalize } from "./codes.mjs";

const UNIVERSAL_CODE = "*";

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

function valueForCode(value, codeHash, findCode) {
  const pattern = codeHashToPattern(codeHash, findCode);
  return decodeWire(encodeToWire(value, pattern)).value;
}

function normalizeCodecModule(mod, fallbackName) {
  const codec = mod.replCodec || mod.codec || mod.default || mod;
  const name = codec.name || mod.name || fallbackName;
  const universal = codec.universal === true;
  const patterns = codec.patterns || (codec.pattern ? [codec.pattern] : null);
  const codes = codec.codes || codec.codeHashes || (codec.code ? [codec.code] : null) ||
    patterns?.map((pattern, index) => {
      const codeHash = closedPatternToCodeHash(pattern);
      if (!codeHash) throw new Error(`Codec '${name}' pattern ${index} must be a closed property-list pattern`);
      return codeHash;
    });
  if (!name || typeof name !== "string") {
    throw new Error("Codec module must export a string name");
  }
  if (!universal && (!Array.isArray(codes) || codes.length === 0)) {
    throw new Error(`Codec '${name}' must export a non-empty codes array`);
  }
  if (codec.parse != null && typeof codec.parse !== "function") {
    throw new Error(`Codec '${name}' parse export must be a function`);
  }
  if (codec.print != null && typeof codec.print !== "function") {
    throw new Error(`Codec '${name}' print export must be a function`);
  }
  return {
    name,
    codes: universal ? [UNIVERSAL_CODE] : codes,
    universal,
    parse: codec.parse,
    print: codec.print
  };
}

function codecStore(state) {
  if (!state.codecs) state.codecs = {};
  return state.codecs;
}

function registerCodec(state, codec, source = null) {
  const registered = [];
  const store = codecStore(state);
  for (const codeHash of codec.codes) {
    const universal = codeHash === UNIVERSAL_CODE;
    if (!universal && !isCanonicalCodeName(codeHash)) {
      throw new Error(`Codec '${codec.name}' has non-canonical code '${codeHash}'`);
    }
    if (!store[codeHash]) store[codeHash] = [];
    const entry = {
      name: codec.name,
      source,
      universal,
      parse: codec.parse,
      print: codec.print
    };
    const existingIndex = store[codeHash].findIndex((existing) =>
      existing.name === entry.name && existing.source === entry.source
    );
    if (existingIndex === -1) {
      store[codeHash].push(entry);
    } else {
      store[codeHash][existingIndex] = entry;
    }
    registered.push({ codeHash, ...entry });
  }
  return registered;
}

async function loadCodecModule(state, filePath) {
  const resolved = path.resolve(filePath);
  const url = pathToFileURL(resolved);
  url.searchParams.set("mtime", String(fs.statSync(resolved).mtimeMs));
  const mod = await import(url.href);
  const codec = normalizeCodecModule(mod, path.basename(resolved, path.extname(resolved)));
  return registerCodec(state, codec, resolved);
}

function listCodecs(state) {
  const entries = Object.entries(codecStore(state))
    .flatMap(([codeHash, codecs]) => codecs.map((codec) => ({ codeHash, ...codec })))
    .sort((a, b) => a.name.localeCompare(b.name) || a.codeHash.localeCompare(b.codeHash));
  if (entries.length === 0) return "(none)";
  return entries.map((entry) => `${entry.name} ${entry.codeHash === UNIVERSAL_CODE ? "all" : entry.codeHash}${entry.source ? ` (${entry.source})` : ""}`).join("\n");
}

function codecNames(state, codeHash = null) {
  const store = codecStore(state);
  const codecs = codeHash
    ? [...(store[codeHash] || []), ...(store[UNIVERSAL_CODE] || [])]
    : Object.values(store).flat();
  return [...new Set(codecs.map((codec) => codec.name))].sort();
}

function resolveCodec(state, codeHash, codecName = null, capability = null) {
  const store = codecStore(state);
  const matchesCodec = (codec) =>
    (codecName == null || codec.name === codecName) &&
    (capability == null || typeof codec[capability] === "function");
  const exactMatches = (store[codeHash] || []).filter(matchesCodec);
  const universalMatches = (store[UNIVERSAL_CODE] || []).filter(matchesCodec);
  const matches = codecName == null && exactMatches.length > 0
    ? exactMatches
    : [...exactMatches, ...universalMatches];
  if (matches.length === 0) {
    const suffix = codecName ? ` named '${codecName}'` : "";
    throw new Error(`No ${capability || "usable"} codec${suffix} for ${codeHash}`);
  }
  if (matches.length > 1 && codecName == null) {
    throw new Error(`Multiple codecs for ${codeHash}; specify one of: ${matches.map((codec) => codec.name).join(", ")}`);
  }
  return matches[0];
}

export {
  codecNames,
  codeHashToPattern,
  listCodecs,
  loadCodecModule,
  registerCodec,
  resolveCodec,
  closedPatternToCodeHash,
  UNIVERSAL_CODE,
  valueForCode
};
