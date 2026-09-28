#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { argv, exit, stdin, stdout } from "node:process";

import { annotate, parse } from "./index.mjs";
import { constrainWithPattern } from "./run.mjs";
import { compileWasmArtifactFromObject, instantiateWasmArtifact } from "./backends/wasm/src/wasm.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";
import codes from "./codes.mjs";
import { Value, isProduct, isVariant } from "./Value.mjs";
if (typeof globalThis !== "undefined") {
  globalThis.Value = Value;
  globalThis.isProduct = isProduct;
  globalThis.isVariant = isVariant;
}
import { patterns2filters, prettyCode, prettyRel } from "./pretty.mjs";
import {
  compileObject,
  compileLibrary,
  decodeLibrary,
  encodeObject,
  encodeLibrary,
  hydrateObject,
  loadLibrary,
  prettyRelation
} from "./object.mjs";
import { propertyListToFilter, valueToK, valueWithEnvelopeToK } from "./codecs/runtime/show-value.mjs";
import {
  codecNames,
  codeHashToPattern,
  listCodecs,
  loadCodecModule,
  registerCodec,
  resolveCodec,
  unregisterCodec,
  BUILTIN_CODECS,
  closedPatternToCodeHash,
  UNIVERSAL_CODE,
  valueForPattern,
  matchBuiltinCodec
} from "./repl-codecs.mjs";

const NAME_RE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;
const COMMAND_NAMES = [
  "help", "type", "code", "run", "eval", "t", "d", "C",
  "codes", "codecs", "rels", "codec", "input", "reset", "klib", "ko", "load",
  "time",
  "quit", "exit"
];
const CODEC_COMMAND_NAMES = ["load", "unload", "list"];
const PATH_COMMANDS = new Set(["klib", "ko", "load"]);
const INPUT_TYPE_NAME = "__input__";
const initialCodes = codes.dump();

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyValue() {
  return Value.product({}, [["closed-product", []]]);
}

function createState() {
  codes.load(cloneJSON(initialCodes));
  return {
    codes: codes.dump(),
    rels: {},
    relAliases: {},
    typeAliases: {},
    codecs: {},
    loadedFiles: new Set(),
    pendingInput: null,
    meta: {},
    value: emptyValue(),
    lastResult: null,
    lastMain: null,
    lastTiming: null,
    showTiming: true
  };
}

function stateLibrary(state) {
  return {
    format: "k-object",
    codes: state.codes,
    rels: state.rels,
    relAlias: state.relAliases,
    meta: state.meta,
    main: null
  };
}

function restoreCodes(state) {
  codes.load(state.codes);
}

function aliasLine(kind, name, hash) {
  if (!NAME_RE.test(name)) return null;
  const body = hash.startsWith("@") ? hash.slice(1) : hash;
  return kind === "code" ? `$ ${name} = @${body};` : `${name} = @${body};`;
}

function aliasPreamble(state, omitName = null) {
  const lines = [];
  for (const [name, hash] of Object.entries(state.typeAliases).sort()) {
    if (name !== omitName) lines.push(aliasLine("code", name, hash));
  }
  for (const [name, hash] of Object.entries(state.relAliases).sort()) {
    if (name !== omitName) lines.push(aliasLine("rel", name, hash));
  }
  return lines.filter(Boolean).join("\n");
}

function preambleLineCount(preamble) {
  if (!preamble) return 0;
  return preamble.split("\n").length;
}

function remapLineNumber(line, offset) {
  return Math.max(1, line - offset);
}

function remapDiagnosticMessage(message, lineOffset) {
  if (!lineOffset) return message;

  let rewritten = message.replace(
    /\(lines (\d+):(\d+)\.\.\.(\d+):(\d+)\)/g,
    (_, startLine, startCol, endLine, endCol) =>
      `(lines ${remapLineNumber(Number(startLine), lineOffset)}:${startCol}...${remapLineNumber(Number(endLine), lineOffset)}:${endCol})`
  );

  rewritten = rewritten.replace(
    /Parse error on line (\d+):/g,
    (_, line) => `Parse error on line ${remapLineNumber(Number(line), lineOffset)}:`
  );

  return rewritten;
}

function remapError(error, lineOffset) {
  if (!lineOffset || !error?.message) return error;
  const remapped = new Error(remapDiagnosticMessage(error.message, lineOffset));
  remapped.name = error.name;
  if (error.stack) {
    remapped.stack = error.stack.replace(error.message, remapped.message);
  }
  if ("cause" in error) remapped.cause = error.cause;
  return remapped;
}

function compileWithOptionalIdentity(source, options) {
  try {
    return hydrateObject(compileLibrary(source, options));
  } catch (error) {
    if (!/got 'EOF'|Expecting/.test(error.message)) throw error;
    return hydrateObject(compileLibrary(`${ensureSemicolon(source)}\n()`, options));
  }
}

function annotateWithOptionalIdentity(source, options) {
  try {
    return annotate(source, options);
  } catch (error) {
    if (!/got 'EOF'|Expecting/.test(error.message)) throw error;
    return annotate(`${ensureSemicolon(source)}\n()`, options);
  }
}

function mergeMeta(state, meta = {}) {
  for (const [hash, entry] of Object.entries(meta)) {
    const origins = entry?.origins || [];
    const entryType = entry?.type;
    if (!state.meta[hash]) state.meta[hash] = { type: entryType, origins: [] };
    if (state.meta[hash].type == null && entryType != null) state.meta[hash].type = entryType;
    state.meta[hash].origins.push(...origins.map((origin) => ({ ...origin })));
  }
}

function rememberOrigin(state, hash, name, type, source = "<repl>") {
  if (!state.meta[hash]) state.meta[hash] = { type, origins: [] };
  if (state.meta[hash].type == null) state.meta[hash].type = type;
  const exists = state.meta[hash].origins.some((origin) =>
    origin.name === name && state.meta[hash].type === type && origin.source === source
  );
  if (!exists) {
    state.meta[hash].origins.push({
      source,
      name,
      compiledAt: new Date().toISOString()
    });
  }
}

function recoverAliasesFromMeta(state, lib) {
  for (const [hash, entry] of Object.entries(lib.meta || {})) {
    for (const origin of entry?.origins || []) {
      if (!origin?.name || !NAME_RE.test(origin.name)) continue;
      const type = entry?.type;
      if (type === "code" || (!type && hash in state.codes && !(hash in state.rels))) {
        state.typeAliases[origin.name] = hash;
      } else if (type === "rel" || hash in state.rels) {
        state.relAliases[origin.name] = hash;
      }
    }
  }
}

function mergeLibrary(state, lib, source = "<load>", options = {}) {
  const loadAliases = options.loadAliases ?? true;
  state.codes = { ...state.codes, ...(lib.codes || {}) };
  state.rels = { ...state.rels, ...(lib.rels || {}) };
  mergeMeta(state, lib.meta);

  if (loadAliases) {
    state.relAliases = { ...state.relAliases, ...(lib.relAlias || {}) };
    for (const [name, hash] of Object.entries(lib.relAlias || {})) {
      if (name !== "__main__" && NAME_RE.test(name) && hash in state.rels) {
        state.relAliases[name] = hash;
        rememberOrigin(state, hash, name, "rel", source);
      }
    }
    recoverAliasesFromMeta(state, lib);
    if (state.typeAliases.string && !state.typeAliases.utf8) {
      state.typeAliases.utf8 = state.typeAliases.string;
    } else if (state.typeAliases.utf8 && !state.typeAliases.string) {
      state.typeAliases.string = state.typeAliases.utf8;
    }
    if (state.typeAliases.float64 && !state.typeAliases.ieee) {
      state.typeAliases.ieee = state.typeAliases.float64;
    } else if (state.typeAliases.ieee && !state.typeAliases.float64) {
      state.typeAliases.float64 = state.typeAliases.ieee;
    }
  }
  restoreCodes(state);
}

function reachableRelations(rels, roots) {
  const reachable = new Set();
  const queue = [...roots];

  function walkExp(exp) {
    if (!exp) return;
    switch (exp.op) {
      case "ref":
        if (exp.ref in rels && !reachable.has(exp.ref)) queue.push(exp.ref);
        break;
      case "comp":
        exp.comp.forEach(walkExp);
        break;
      case "union":
        exp.union.forEach(walkExp);
        break;
      case "product":
        exp.product.forEach(({ exp: child }) => walkExp(child));
        break;
    }
  }

  while (queue.length > 0) {
    const hash = queue.shift();
    if (reachable.has(hash) || !(hash in rels)) continue;
    reachable.add(hash);
    walkExp(rels[hash].def);
  }

  return Object.fromEntries(
    Object.entries(rels).filter(([hash]) => reachable.has(hash))
  );
}

function savedLibrary(state) {
  const meta = cloneJSON(state.meta);
  const now = new Date().toISOString();
  for (const [name, hash] of Object.entries(state.typeAliases)) {
    if (!meta[hash]) meta[hash] = { type: "code", origins: [] };
    if (meta[hash].type == null) meta[hash].type = "code";
    meta[hash].origins.push({ source: "<repl>", name, compiledAt: now });
  }
  for (const [name, hash] of Object.entries(state.relAliases)) {
    if (!meta[hash]) meta[hash] = { type: "rel", origins: [] };
    if (meta[hash].type == null) meta[hash].type = "rel";
    meta[hash].origins.push({ source: "<repl>", name, compiledAt: now });
  }
  const rels = reachableRelations(state.rels, Object.values(state.relAliases));
  const storedHashes = new Set([
    ...Object.keys(state.codes),
    ...Object.keys(rels)
  ]);
  return {
    format: "k-object",
    codes: state.codes,
    rels,
    relAlias: state.relAliases,
    compileStats: { sccs: [], sccCount: 0 },
    meta: Object.fromEntries(
      Object.entries(meta).filter(([hash]) => storedHashes.has(hash))
    ),
    main: null
  };
}

function executableObject(state, mainExpression) {
  const main = (mainExpression || state.lastMain || "").trim();
  if (!main) {
    throw new Error(":ko file expr requires a main expression unless one has already been evaluated or defined");
  }

  restoreCodes(state);
  const preamble = aliasPreamble(state);
  try {
    return compileObject([preamble, main].filter(Boolean).join("\n"), {
      source: "<repl>",
      libraries: [stateLibrary(state)]
    });
  } catch (error) {
    throw remapError(error, preambleLineCount(preamble));
  } finally {
    restoreCodes(state);
  }
}

function resolveRel(state, name) {
  const hash = state.relAliases[name] || (name.startsWith("@") ? name : null);
  return hash ? { hash, rel: state.rels[hash] } : { hash: null, rel: null };
}

function relTypeString(rel) {
  const filters = patterns2filters(rel.typePatternGraph, ...rel.def.patterns);
  return filters.map((filter) => prettyRel({ op: "filter", filter })).join("  -->  ");
}

function listAliases(aliases) {
  const entries = Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "(none)";
  return entries.map(([name, hash]) => `${name} = ${hash}`).join("\n");
}

function formatCodecOutput(output) {
  if (Buffer.isBuffer(output)) return output.toString("utf8");
  return String(output);
}

function printValue(value, state = null) {
  const lines = [valueWithEnvelopeToK(value)];
  if (!state || value === undefined) return lines[0];

  const codeHash = closedPatternToCodeHash(value.pattern);
  const codecs = [
    ...(codeHash ? state.codecs?.[codeHash] || [] : []),
    ...(state.codecs?.[UNIVERSAL_CODE] || [])
  ];
  if (codecs.length === 0) return lines[0];
  for (const codec of codecs) {
    if (typeof codec.print !== "function") continue;
    try {
      lines.push(`${codec.name}: ${formatCodecOutput(codec.print(value, { codeHash, state }))}`);
    } catch (error) {
      if (codec.universal) continue;
      lines.push(`${codec.name}: <error: ${error.message || String(error)}>`);
    }
  }
  return lines.join("\n");
}

function commitResult(state, result, lastMain) {
  if (result !== undefined) {
    state.value = result;
    state.lastMain = lastMain;
    state.lastResult = result;
  }
  return [printValue(result, state)];
}

function userDefinedNames(source) {
  let parsed;
  try {
    parsed = parse(source);
  } catch (error) {
    if (!/got 'EOF'|Expecting/.test(error.message)) throw error;
    parsed = parse(`${source}\n()`);
  }

  return {
    typeNames: Object.keys(parsed.defs.codes).filter((name) =>
      NAME_RE.test(name) && !name.startsWith("@") && !name.startsWith(":")
    ),
    relNames: Object.keys(parsed.defs.rels).filter((name) =>
      NAME_RE.test(name) && !name.startsWith("@") && name !== "__main__"
    )
  };
}

function originFromSourceNode(source, name, compiledAt, node) {
  return {
    source,
    name,
    compiledAt,
    ...(node?.start ? { start: node.start } : {}),
    ...(node?.end ? { end: node.end } : {})
  };
}

function libraryOriginsFromSource(source, fullSource, lib, options) {
  const { typeNames, relNames } = userDefinedNames(source);
  const annotated = annotateWithOptionalIdentity(fullSource, options);
  const meta = {};
  const now = new Date().toISOString();

  for (const name of typeNames) {
    const hash = annotated.representatives?.[name];
    if (!hash) continue;
    if (!meta[hash]) meta[hash] = { type: "code", origins: [] };
    meta[hash].origins.push(originFromSourceNode(
      options.source || null,
      name,
      now,
      annotated.sourceDefs?.codes?.[name]
    ));
  }

  const relAlias = Object.fromEntries(
    relNames
      .map((name) => [name, lib.relAlias?.[name]])
      .filter(([, hash]) => hash != null)
  );

  for (const [name, hash] of Object.entries(relAlias)) {
    if (!meta[hash]) meta[hash] = { type: "rel", origins: [] };
    meta[hash].origins.push(originFromSourceNode(
      options.source || null,
      name,
      now,
      annotated.rels?.[name]?.def
    ));
  }

  return { relAlias, meta };
}

function canonicalNames(state) {
  return [...new Set([
    ...Object.keys(state.codes),
    ...Object.keys(state.rels),
    ...Object.values(state.typeAliases),
    ...Object.values(state.relAliases)
  ])].filter((name) => name.startsWith("@")).sort();
}

function canonicalCodeNames(state) {
  return [...new Set([
    ...Object.keys(state.codes),
    ...Object.values(state.typeAliases)
  ])].filter((name) => name.startsWith("@")).sort();
}

function aliasNames(state) {
  return [...new Set([
    ...Object.keys(state.typeAliases),
    ...Object.keys(state.relAliases)
  ])].sort();
}

function displayAliases(state) {
  const aliases = {};
  for (const [name, hash] of [
    ...Object.entries(state.typeAliases),
    ...Object.entries(state.relAliases)
  ].sort(([a], [b]) => a.localeCompare(b))) {
    if (!aliases[hash]) aliases[hash] = name;
  }
  return aliases;
}

function expandHome(input) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function completionTokenStart(text) {
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\s/.test(text[i])) return i + 1;
  }
  return 0;
}

function completeCommandName(line) {
  const partial = line.slice(1);
  const matches = COMMAND_NAMES
    .filter((command) => command.startsWith(partial))
    .map((command) => `:${command}`);
  return [matches, line];
}

function completeCanonical(line, state) {
  const match = line.match(/^(.*?)(@[A-Za-z0-9_?!+-]*)$/);
  if (!match) return [[], line];
  const [, prefix, partial] = match;
  const matches = canonicalNames(state)
    .filter((name) => name.startsWith(partial))
    .map((name) => `${prefix}${name}`);
  return [matches, line];
}

function completeCanonicalCode(line, state) {
  const match = line.match(/^(.*?)(@[A-Za-z0-9_?!+-]*)$/);
  if (!match) return [[], line];
  const [, prefix, partial] = match;
  const matches = canonicalCodeNames(state)
    .filter((name) => name.startsWith(partial))
    .map((name) => `${prefix}${name}`);
  return [matches, line];
}

function completeIdentifier(line, state) {
  const match = line.match(/^(.*?)(\$?[A-Za-z0-9_+-][A-Za-z0-9_?!+-]*)$/);
  if (!match) return [[], line];
  const [, prefix, partial] = match;
  const isTypeToken = partial.startsWith("$");
  const barePartial = isTypeToken ? partial.slice(1) : partial;
  const names = isTypeToken ? Object.keys(state.typeAliases).sort() : aliasNames(state);
  const matches = names
    .filter((name) => name.startsWith(barePartial))
    .map((name) => `${prefix}${isTypeToken ? "$" : ""}${name}`);
  return [matches, line];
}

function completeTypeIdentifier(line, state) {
  const match = line.match(/^(.*?)(\$?[A-Za-z0-9_+-][A-Za-z0-9_?!+-]*)$/);
  if (!match) return [[], line];
  const [, prefix, partial] = match;
  const isTypeToken = partial.startsWith("$");
  const barePartial = isTypeToken ? partial.slice(1) : partial;
  const matches = Object.keys(state.typeAliases)
    .sort()
    .filter((name) => name.startsWith(barePartial))
    .map((name) => `${prefix}${isTypeToken ? "$" : ""}${name}`);
  return [matches, line];
}

function completePath(line, tokenStart) {
  const token = line.slice(tokenStart);
  const quote = token[0] === "\"" || token[0] === "'" ? token[0] : "";
  const rawToken = quote ? token.slice(1) : token;
  const expanded = expandHome(rawToken);
  const hasTrailingSlash = rawToken.endsWith("/") || rawToken.endsWith(path.sep);
  const partial = rawToken === "" || hasTrailingSlash ? "" : path.basename(rawToken);
  const rawPrefix = rawToken.slice(0, rawToken.length - partial.length);
  const searchDir = rawToken === ""
    ? "."
    : hasTrailingSlash
      ? expanded
      : (path.dirname(expanded) || ".");

  let entries;
  try {
    entries = fs.readdirSync(searchDir, { withFileTypes: true });
  } catch {
    return [[], line];
  }

  const matches = entries
    .filter((entry) => entry.name.startsWith(partial))
    .map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      return `${line.slice(0, tokenStart)}${quote}${rawPrefix}${entry.name}${suffix}`;
    })
    .sort();

  return [matches, line];
}

function commandArgIndex(arg) {
  const trimmed = arg.trimStart();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length - 1;
}

function loadPathCompletionStart(argStart, arg) {
  const leadingWhitespace = arg.length - arg.trimStart().length;
  const trimmed = arg.trimStart();
  if (trimmed === "" || !trimmed.startsWith("--no-alias")) {
    if (commandArgIndex(arg) !== 0) return null;
    return argStart + completionTokenStart(arg);
  }
  if (!"--no-alias".startsWith(trimmed) && !trimmed.startsWith("--no-alias ")) {
    return null;
  }
  if (trimmed !== "--no-alias" && !trimmed.startsWith("--no-alias ")) {
    return null;
  }
  if (trimmed === "--no-alias") return null;
  const restStart = leadingWhitespace + "--no-alias".length;
  const rest = arg.slice(restStart);
  const restLeadingWhitespace = rest.length - rest.trimStart().length;
  return argStart + restStart + restLeadingWhitespace + completionTokenStart(rest.trimStart());
}

function completeCommandWord(line, argStart, arg, words) {
  const leadingWhitespace = arg.length - arg.trimStart().length;
  const trimmed = arg.trimStart();
  if (/\s/.test(trimmed)) return [[], line];
  const prefix = line.slice(0, argStart + leadingWhitespace);
  const matches = words
    .filter((word) => word.startsWith(trimmed))
    .map((word) => `${prefix}${word}`);
  return [matches, line];
}

function codecLoadPathCompletionStart(argStart, arg) {
  const match = arg.match(/^(\s*)load(?:\s+(.*))?$/);
  if (!match) return null;
  if (match[2] == null) return null;
  const [, leading, rest] = match;
  const restLeadingWhitespace = rest.length - rest.trimStart().length;
  return argStart + leading.length + "load".length + 1 + restLeadingWhitespace + completionTokenStart(rest.trimStart());
}

function completeCodecCommand(line, argStart, arg, state) {
  const trimmed = arg.trimStart();
  if (trimmed === "" || !/\s/.test(trimmed)) {
    return completeCommandWord(line, argStart, arg, CODEC_COMMAND_NAMES);
  }

  const unloadMatch = arg.match(/^(\s*)unload(?:\s+(.*))?$/);
  if (unloadMatch) {
    const [, leading, partial = ""] = unloadMatch;
    const prefix = line.slice(0, argStart + leading.length + "unload".length + 1);
    const names = state ? codecNames(state) : [];
    const matches = names
      .filter((name) => name.startsWith(partial.trim()))
      .map((name) => `${prefix}${name}`);
    return [matches, line];
  }

  const tokenStart = codecLoadPathCompletionStart(argStart, arg);
  if (tokenStart == null) return [[], line];
  const [pathMatches] = completePath(line, tokenStart);
  const match = arg.match(/^(\s*)load(?:\s+(.*))?$/);
  const partial = match && match[2] != null ? match[2].trim() : "";
  const prefix = line.slice(0, tokenStart);
  const builtinMatches = ["int", "utf8", "json", "ieee"]
    .filter((name) => name.startsWith(partial))
    .map((name) => `${prefix}${name}`);
  return [[...builtinMatches, ...pathMatches], line];
}

function resolveTypeHash(state, rawName) {
  const token = rawName.trim();
  const bareName = token.startsWith("$") ? token.slice(1).trim() : token;
  const hash = state.typeAliases[bareName] || (token.startsWith("@") ? token : null);
  if (!hash || !(hash in state.codes)) throw new Error(`Unknown type '${rawName}'`);
  return hash;
}

function isSimpleTypeReference(rawType) {
  return /^\$?\s*[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/.test(rawType.trim());
}

function resolveTypeExpressionHash(state, rawType) {
  restoreCodes(state);
  const preamble = aliasPreamble(state, INPUT_TYPE_NAME);
  const source = [
    preamble,
    ensureSemicolon(`$ ${INPUT_TYPE_NAME} = ${rawType.trim()}`),
    "()"
  ].filter(Boolean).join("\n");

  try {
    const annotated = annotate(source, { libraries: [stateLibrary(state)] });
    const hash = annotated.representatives[INPUT_TYPE_NAME];
    if (!hash) throw new Error(":input type expression did not produce a code hash");
    state.codes = codes.dump();
    return hash;
  } catch (error) {
    restoreCodes(state);
    throw remapError(error, preambleLineCount(preamble));
  }
}

function resolveInputTypeHash(state, rawType) {
  try {
    return resolveTypeHash(state, rawType);
  } catch (error) {
    if (isSimpleTypeReference(rawType)) throw error;
  }
  return resolveTypeExpressionHash(state, rawType);
}

function resolvePatternExpression(state, patternExpr) {
  restoreCodes(state);
  const preamble = aliasPreamble(state);
  const source = [
    preamble,
    patternExpr
  ].filter(Boolean).join("\n");
  try {
    const annotated = annotate(source, { libraries: [stateLibrary(state)] });
    const mainRel = annotated.rels.__main__;
    if (!mainRel || !mainRel.typePatternGraph) {
      throw new Error(`Invalid pattern expression '${patternExpr}'`);
    }
    if (mainRel.def.op !== "filter" && mainRel.def.op !== "code") {
      throw new Error(`Expected a pattern expression, got ${mainRel.def.op}`);
    }
    const rootPatternId = mainRel.typePatternGraph.find(mainRel.def.patterns[0]);
    const pattern = patternToPropertyList(exportPatternGraph(mainRel.typePatternGraph, rootPatternId));
    const codeHash = closedPatternToCodeHash(pattern);
    state.codes = codes.dump();
    return { pattern, codeHash, display: codeHash || patternExpr };
  } catch (error) {
    restoreCodes(state);
    throw remapError(error, preambleLineCount(preamble));
  }
}

function resolveInputPattern(state, rawExpr) {
  const token = (rawExpr || "").trim();
  if (!token || token === "*" || token === "(...)") {
    return { pattern: [["any", []]], codeHash: null, display: "(...)" };
  }

  // 1. Explicit filter / pattern expression
  if (token.startsWith("?")) {
    const res = resolvePatternExpression(state, token);
    return { ...res, display: token };
  }

  // 2. Pattern as type prefixed by dollar: $ name, $ {typeExpr}, $ <typeExpr>
  if (token.startsWith("$")) {
    const bare = token.slice(1).trim();
    if (bare in (state.typeAliases || {})) {
      const hash = state.typeAliases[bare];
      const pattern = codeHashToPattern(hash, (h) => state.codes?.[h] || codes.find(h));
      return { pattern, codeHash: hash, display: `$ ${bare}` };
    }
    try {
      const res = resolvePatternExpression(state, `? ${token}`);
      return { ...res, display: token };
    } catch {}
  }

  // 3. Known type alias or canonical code hash
  try {
    const hash = resolveTypeHash(state, token);
    const pattern = codeHashToPattern(hash, (h) => state.codes?.[h] || codes.find(h));
    return { pattern, codeHash: hash, display: hash };
  } catch (aliasErr) {
    if (isSimpleTypeReference(token)) {
      try {
        const res = resolvePatternExpression(state, `? ${token}`);
        return { ...res, display: token };
      } catch {}
      throw aliasErr;
    }
  }

  // 4. Composite expression ({...}, <...>): try type expression first
  try {
    const hash = resolveTypeExpressionHash(state, token);
    const pattern = codeHashToPattern(hash, (h) => state.codes?.[h] || codes.find(h));
    return { pattern, codeHash: hash, display: hash };
  } catch (typeErr) {
    // 5. Fall back to pattern expression: ? <expr>
    try {
      const res = resolvePatternExpression(state, `? ${token}`);
      return { ...res, display: token };
    } catch {
      throw typeErr;
    }
  }
}

function completeInputCommand(line, state, argStart, arg) {
  const match = arg.match(/^(\s*)(\S+)?(\s+)?(\S*)?$/);
  if (!match) return [[], line];
  const [, leading, firstToken = "", afterWhitespace = "", secondPartial = ""] = match;

  if (!firstToken || !afterWhitespace) {
    if (/@[A-Za-z0-9_?!+-]*$/.test(line)) return completeCanonicalCode(line, state);
    const [types] = completeTypeIdentifier(line, state);
    const prefix = line.slice(0, argStart + leading.length);
    const codecMatches = codecNames(state)
      .filter((name) => name.startsWith(firstToken))
      .map((name) => `${prefix}${name}`);
    return [[...new Set([...types, ...codecMatches])], line];
  }

  if (firstToken) {
    const prefix = line.slice(0, argStart + leading.length + firstToken.length + afterWhitespace.length);
    const names = (() => {
      try {
        return codecNames(state, resolveTypeHash(state, firstToken));
      } catch {
        return codecNames(state);
      }
    })();
    return [
      names
        .filter((name) => name.startsWith(secondPartial))
        .map((name) => `${prefix}${name}`),
      line
    ];
  }

  return [[], line];
}

function completeCommandArgument(line, state) {
  const body = line.slice(1);
  const firstSpace = body.search(/\s/);
  if (firstSpace === -1) return completeCommandName(line);

  const command = body.slice(0, firstSpace);
  const argStart = 1 + firstSpace + 1;
  const arg = line.slice(argStart);

  if (command === "codec" || command === "codecs") {
    return completeCodecCommand(line, argStart, arg, state);
  }

  if (command === "input") {
    return completeInputCommand(line, state, argStart, arg);
  }

  if (PATH_COMMANDS.has(command)) {
    const tokenStart = command === "load"
      ? loadPathCompletionStart(argStart, arg)
      : commandArgIndex(arg) === 0
        ? argStart + completionTokenStart(arg)
        : null;
    if (tokenStart == null) return [[], line];
    return completePath(line, tokenStart);
  }

  if (/@[A-Za-z0-9_?!+-]*$/.test(line)) {
    return completeCanonical(line, state);
  }

  if (/\$?[A-Za-z0-9_+-][A-Za-z0-9_?!+-]*$/.test(line)) {
    return completeIdentifier(line, state);
  }

  return [[], line];
}

function completeInput(line, state) {
  if (line.startsWith(":")) {
    return completeCommandArgument(line, state);
  }
  if (/@[A-Za-z0-9_?!+-]*$/.test(line)) {
    return completeCanonical(line, state);
  }
  if (/\$?[A-Za-z0-9_+-][A-Za-z0-9_?!+-]*$/.test(line)) {
    return completeIdentifier(line, state);
  }
  return [[], line];
}

function createCompleter(state) {
  return (line) => completeInput(line, state);
}

function isMainEntrypoint(entryArg = argv[1]) {
  if (!entryArg) return false;
  try {
    return fs.realpathSync(entryArg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function ensureSemicolon(source) {
  return source.trim().endsWith(";") ? source : `${source};`;
}

function isEofParseError(error) {
  return /got 'EOF'|Unexpected end of input/.test(error.message || "");
}

function parseLoadArgs(arg, usagePrefix = ":") {
  const trimmed = arg.trim();
  if (!trimmed) throw new Error(`${usagePrefix}load requires a file path`);
  if (trimmed === "--no-alias") {
    throw new Error(`${usagePrefix}load --no-alias requires a file path`);
  }
  if (trimmed.startsWith("--no-alias ")) {
    const path = trimmed.slice("--no-alias".length).trim();
    if (!path) throw new Error(`${usagePrefix}load --no-alias requires a file path`);
    return { path, loadAliases: false };
  }
  return { path: arg.trim(), loadAliases: true };
}

const CODEC_FILES = {
  int: "arithmetics.k",
  utf8: "core.k",
  json: "core.k",
  ieee: "ieee.k",
  unit: "core.k"
};

function normalizeFilePath(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveKFilePath(filePath) {
  try {
    if (fs.existsSync(filePath)) return filePath;
  } catch {}
  try {
    const fromRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), filePath);
    if (fs.existsSync(fromRepo)) return fromRepo;
  } catch {}
  const withEx = filePath.startsWith("Examples/") ? filePath : `Examples/${filePath}`;
  try {
    if (fs.existsSync(withEx)) return withEx;
  } catch {}
  try {
    const fromRepoEx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), withEx);
    if (fs.existsSync(fromRepoEx)) return fromRepoEx;
  } catch {}
  const strippedEx = filePath.startsWith("Examples/") ? filePath.slice("Examples/".length) : filePath;
  try {
    if (fs.existsSync(strippedEx)) return strippedEx;
  } catch {}
  try {
    const fromRepoStripped = path.resolve(path.dirname(fileURLToPath(import.meta.url)), strippedEx);
    if (fs.existsSync(fromRepoStripped)) return fromRepoStripped;
  } catch {}
  return filePath;
}

function loadSourceOrKlib(state, targetPath, options = {}) {
  const loadAliases = options.loadAliases ?? true;
  const normKey = normalizeFilePath(targetPath);
  if (!state.loadedFiles) state.loadedFiles = new Set();

  // If loading poly.k, auto-load arithmetics.k first if not already loaded
  if (normKey === "Examples/poly.k" || normKey.endsWith("/poly.k") || normKey === "poly.k") {
    const arithKey = "arithmetics.k";
    const alreadyHasArith = Array.from(state.loadedFiles).some(f => path.basename(f) === "arithmetics.k");
    if (!alreadyHasArith) {
      loadSourceOrKlib(state, arithKey, { loadAliases });
    }
  }

  const loadPath = resolveKFilePath(targetPath);
  if (loadPath.endsWith(".klib")) {
    const lib = loadLibrary(decodeLibrary(fs.readFileSync(loadPath)));
    mergeLibrary(state, lib, targetPath, { loadAliases });
  } else {
    restoreCodes(state);
    const source = fs.readFileSync(loadPath, "utf8");
    const preamble = aliasPreamble(state);
    const fullSource = [preamble, source].filter(Boolean).join("\n");
    const compileOptions = {
      source: targetPath,
      libraries: [stateLibrary(state)]
    };
    try {
      const lib = compileWithOptionalIdentity(fullSource, compileOptions);
      const { relAlias, meta } = libraryOriginsFromSource(source, fullSource, lib, compileOptions);
      mergeLibrary(state, { ...lib, relAlias, meta }, targetPath, { loadAliases });
    } catch (error) {
      throw remapError(error, preambleLineCount(preamble));
    }
  }
  state.loadedFiles.add(normKey);
  return targetPath;
}

function ensureCodecDependencies(state, codecTarget) {
  const norm = normalizeFilePath(codecTarget).toLowerCase();
  const base = path.basename(norm, path.extname(norm));
  const depFile = CODEC_FILES[base] || CODEC_FILES[norm];
  if (!depFile) return null;
  if (!state.loadedFiles) state.loadedFiles = new Set();
  const depNormKey = normalizeFilePath(depFile);
  const baseName = path.basename(depNormKey);
  const alreadyLoaded = state.loadedFiles.has(depNormKey) ||
    state.loadedFiles.has(`Examples/${depNormKey}`) ||
    Array.from(state.loadedFiles).some(f => path.basename(f) === baseName);
  if (!alreadyLoaded) {
    loadSourceOrKlib(state, depFile);
    return depFile;
  }
  return null;
}

function lineForContinuation(line) {
  return line.replace(/\\\s*$/, "");
}

function lineHasExplicitContinuation(line) {
  return /\\\s*$/.test(line);
}

function lineTerminatesSnippet(line) {
  return /;\s*$/.test(line);
}

function explicitSnippetTerminated(source) {
  const lines = source.split("\n");
  const lastLine = lines[lines.length - 1] || "";
  return lineTerminatesSnippet(lastLine);
}

function analyzeRawSnippet(source) {
  try {
    const parsed = parse(source);
    return { kind: "withMain", parsed };
  } catch (error) {
    if (!isEofParseError(error)) throw error;
  }

  return { kind: "incomplete", parsed: null };
}

function analyzeAcceptedSnippet(source, explicitTerminated = explicitSnippetTerminated(source)) {
  try {
    const parsed = parse(source);
    return { kind: "withMain", parsed };
  } catch (error) {
    if (!explicitTerminated) {
      if (isEofParseError(error)) return { kind: "incomplete", parsed: null };
      throw error;
    }
  }

  const parsed = parse(`${source}\n()`);
  return { kind: "definitionsOnly", parsed };
}

function compileSnippetArtifacts(source, state, sourceName = "<repl>") {
  restoreCodes(state);
  const preamble = aliasPreamble(state);
  const fullSource = [preamble, source].filter(Boolean).join("\n");
  const options = {
    source: sourceName,
    libraries: [stateLibrary(state)]
  };
  try {
    const lib = compileWithOptionalIdentity(fullSource, options);
    const { relAlias, meta } = libraryOriginsFromSource(source, fullSource, lib, options);
    const annotated = annotateWithOptionalIdentity(fullSource, options);
    return {
      annotated,
      lib: { ...lib, relAlias, meta },
      lineOffset: preambleLineCount(preamble)
    };
  } catch (error) {
    throw remapError(error, preambleLineCount(preamble));
  }
}

async function executeExpressionWithWasm(annotated, state, lineOffset = 0) {
  const mainRel = annotated.rels.__main__;
  if (!mainRel) return { result: undefined, wasmCompileMs: 0, executeMs: 0 };

  let inputValue = state.value ?? emptyValue();
  if (mainRel.typePatternGraph && mainRel.def.patterns) {
    const graph = mainRel.typePatternGraph;
    const nodeId = graph.find(mainRel.def.patterns[0]);
    const inputPattern = patternToPropertyList(exportPatternGraph(graph, nodeId));
    inputValue = constrainWithPattern(inputValue, inputPattern, mainRel.def);
  }

  const obj = {
    format: "k-object",
    codes: { ...state.codes, ...codes.dump() },
    rels: annotated.rels,
    relAlias: annotated.relAlias,
    compileStats: annotated.compileStats,
    main: "__main__"
  };

  const wasmCompileStart = performance.now();
  const wasmBytes = await compileWasmArtifactFromObject(obj, {
    inputEnvelopePattern: inputValue?.pattern
  });
  const runner = await instantiateWasmArtifact(wasmBytes);
  const wasmCompileMs = performance.now() - wasmCompileStart;

  const executeStart = performance.now();
  const result = runner.executeValue(inputValue);
  const executeMs = performance.now() - executeStart;

  return { result, wasmCompileMs, executeMs };
}

async function runExpression(input, state) {
  const expression = input.trim();
  if (!expression) throw new Error(":run requires an expression");

  restoreCodes(state);
  const preamble = aliasPreamble(state);
  const lineOffset = preambleLineCount(preamble);
  const source = [preamble, expression].filter(Boolean).join("\n");
  const compileStart = performance.now();
  let annotated;
  try {
    annotated = annotate(source, { libraries: [stateLibrary(state)] });
  } catch (error) {
    throw remapError(error, lineOffset);
  }
  const snippetCompileMs = performance.now() - compileStart;

  let execRes;
  try {
    execRes = await executeExpressionWithWasm(annotated, state, lineOffset);
  } catch (error) {
    throw remapError(error, lineOffset);
  }
  state.codes = codes.dump();
  restoreCodes(state);

  const compileMs = snippetCompileMs + execRes.wasmCompileMs;
  const executeMs = execRes.executeMs;
  state.lastTiming = {
    compileMs,
    executeMs,
    totalMs: compileMs + executeMs,
    snippetCompileMs,
    wasmCompileMs: execRes.wasmCompileMs
  };

  const committed = commitResult(state, execRes.result, expression);
  if (state.showTiming) {
    committed.push(`/* comp: ${formatDuration(compileMs)}, exec: ${formatDuration(executeMs)} */`);
  }
  return committed;
}

async function runSnippet(input, state, options = {}) {
  const snippet = input.trim();
  if (!snippet) return [];

  const explicitTerminated = options.explicitTerminated ?? explicitSnippetTerminated(input);
  const analysis = analyzeAcceptedSnippet(snippet, explicitTerminated);
  const compileStart = performance.now();
  const { annotated, lib, lineOffset } = compileSnippetArtifacts(snippet, state);
  const snippetCompileMs = performance.now() - compileStart;
  mergeLibrary(state, lib, "<repl>");

  if (analysis.kind === "definitionsOnly") {
    restoreCodes(state);
    state.lastTiming = {
      compileMs: snippetCompileMs,
      executeMs: 0,
      totalMs: snippetCompileMs,
      snippetCompileMs,
      wasmCompileMs: 0
    };
    if (state.showTiming) {
      return [`/* comp: ${formatDuration(snippetCompileMs)} */`];
    }
    return [];
  }

  let execRes;
  try {
    execRes = await executeExpressionWithWasm(annotated, state, lineOffset);
  } catch (error) {
    throw remapError(error, lineOffset);
  }
  state.codes = codes.dump();
  restoreCodes(state);

  const compileMs = snippetCompileMs + execRes.wasmCompileMs;
  const executeMs = execRes.executeMs;
  state.lastTiming = {
    compileMs,
    executeMs,
    totalMs: compileMs + executeMs,
    snippetCompileMs,
    wasmCompileMs: execRes.wasmCompileMs
  };

  const committed = commitResult(state, execRes.result, snippet);
  if (state.showTiming) {
    committed.push(`/* comp: ${formatDuration(compileMs)}, exec: ${formatDuration(executeMs)} */`);
  }
  return committed;
}

async function loadCodec(input, state) {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "list") {
    return [listCodecs(state)];
  }

  const [subcommand, ...rest] = trimmed.split(/\s+/);
  switch (subcommand) {
    case "load": {
      const filePath = rest.join(" ");
      if (!filePath) throw new Error(":codec load requires a file path or codec name");
      const autoLoaded = ensureCodecDependencies(state, filePath);
      const registered = await loadCodecModule(state, expandHome(filePath));
      return registered.map(({ name, codeHash }) =>
        `loaded codec ${name} for ${codeHash === UNIVERSAL_CODE ? "all types" : codeHash}${autoLoaded ? ` (auto-loaded ${autoLoaded})` : ""}`
      );
    }
    case "unload": {
      const codecName = rest.join(" ").trim();
      if (!codecName) throw new Error(":codec unload requires a codec name");
      const removed = unregisterCodec(state, codecName);
      if (removed === 0) throw new Error(`Codec '${codecName}' is not loaded`);
      return [`unloaded codec ${codecName}`];
    }
    case "define":
      throw new Error(":codec define has been removed; use :codec load <name|file> or the Custom Codec Studio UI");
    case "list":
      if (rest.length > 0) throw new Error(":codec list does not accept arguments");
      return [listCodecs(state)];
    default: {
      const autoLoaded = ensureCodecDependencies(state, trimmed);
      const registered = await loadCodecModule(state, expandHome(trimmed));
      return registered.map(({ name, codeHash }) =>
        `loaded codec ${name} for ${codeHash === UNIVERSAL_CODE ? "all types" : codeHash}${autoLoaded ? ` (auto-loaded ${autoLoaded})` : ""}`
      );
    }
  }
}

async function requestCodecInput(input, state) {
  const trimmed = input.trim() || "(...)";

  let pattern = null;
  let codeHash = null;
  let codecName = null;
  let targetDisplay = null;
  let rawExpr = trimmed;

  const isJustCodec = (() => {
    if (trimmed.startsWith("?") || trimmed.startsWith("$") || trimmed.startsWith("{") || trimmed.startsWith("<") || trimmed.startsWith("(")) {
      return false;
    }
    const allCodecs = codecNames(state);
    const builtin = matchBuiltinCodec(trimmed);
    const isCodecName = allCodecs.includes(trimmed) || builtin != null;
    const isTypeAlias = Boolean(state.typeAliases && state.typeAliases[trimmed]);
    return isCodecName && !isTypeAlias;
  })();

  if (isJustCodec) {
    codecName = trimmed;
    targetDisplay = trimmed;
    ensureCodecDependencies(state, codecName);
    if (!state.codecs?.[codecName] && matchBuiltinCodec(codecName)) {
      await loadCodecModule(state, codecName);
    }
    if (state.typeAliases?.[codecName]) {
      codeHash = state.typeAliases[codecName];
      pattern = codeHashToPattern(codeHash, codes.find);
      targetDisplay = codeHash;
    }
  } else {
    let splitPattern = null;
    let splitCodec = null;

    const split = trimmed.match(/^(.*\S)\s+([a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*)$/);
    if (split && split[1].trim() !== "?" && split[1].trim() !== "$") {
      splitPattern = split[1];
      splitCodec = split[2];
    }

    if (splitCodec) {
      try {
        const resolved = resolveInputPattern(state, splitPattern);
        pattern = resolved.pattern;
        codeHash = resolved.codeHash;
        codecName = splitCodec;
        targetDisplay = resolved.display;
        rawExpr = splitPattern;
      } catch (patternErr) {
        const resolved = resolveInputPattern(state, trimmed);
        pattern = resolved.pattern;
        codeHash = resolved.codeHash;
        targetDisplay = resolved.display;
        rawExpr = trimmed;
      }
    } else {
      const resolved = resolveInputPattern(state, trimmed);
      pattern = resolved.pattern;
      codeHash = resolved.codeHash;
      targetDisplay = resolved.display;
      rawExpr = trimmed;
    }
  }

  const explicitCodec = Boolean(codecName);
  if (!codecName && codeHash) {
    for (const [alias, hash] of Object.entries(state.typeAliases || {})) {
      if (hash === codeHash && (matchBuiltinCodec(alias) || codecNames(state).includes(alias))) {
        codecName = alias;
        break;
      }
    }
  }

  if (codecName) {
    ensureCodecDependencies(state, codecName);
    if (!state.codecs?.[codecName] && matchBuiltinCodec(codecName)) {
      await loadCodecModule(state, codecName);
    }
  } else {
    const hasExactCodec = Boolean(codeHash && state.codecs?.[codeHash]?.some((c) => typeof c.parse === "function"));
    const hasUniversal = Boolean(state.codecs?.[UNIVERSAL_CODE]?.some((c) => typeof c.parse === "function"));
    if (!hasExactCodec && !hasUniversal && matchBuiltinCodec("json")) {
      await loadCodecModule(state, "json");
    }
  }

  const codec = resolveCodec(state, codeHash, codecName, "parse");
  state.pendingInput = {
    pattern,
    codeHash,
    codecName: codec.name,
    promptName: codec.name,
    rawExpr
  };

  const usingPart = explicitCodec && codecName && codecName !== targetDisplay ? ` using ${codecName}` : "";
  return [`input ${targetDisplay}${usingPart}: enter value text`];
}

async function consumeCodecInput(input, state) {
  const pending = state.pendingInput;
  if (!pending) return null;
  state.pendingInput = null;

  restoreCodes(state);
  const codec = resolveCodec(state, pending.codeHash, pending.codecName, "parse");
  const pattern = pending.pattern || (pending.codeHash ? codeHashToPattern(pending.codeHash, codes.find) : null);
  const parsed = await codec.parse(input, {
    codeHash: pending.codeHash,
    pattern,
    state
  });
  const value = valueForPattern(parsed, pattern, input, codec.name);
  state.value = value;
  state.lastResult = value;
  return [printValue(value, state)];
}

async function evaluateInput(input, state) {
  state.lastTiming = null;
  state.lastResult = null;
  if (state.pendingInput) {
    return consumeCodecInput(input, state);
  }

  const line = input.trim();
  if (line === "" || line.startsWith("#") || line.startsWith("//") || line.startsWith("--")) return [];

  if (line.startsWith(":")) {
    return evaluateCommand(line, state);
  }

  return runSnippet(input, state);
}

function parseCommand(line) {
  const body = line.slice(1).trim();
  const [command, ...rest] = body.split(/\s+/);
  return { command, arg: rest.join(" ") };
}

async function evaluateCommand(line, state) {
  const { command, arg } = parseCommand(line);
  const usagePrefix = ":";

  switch (command) {
    case "quit":
    case "exit":
      exit(0);
    case "help":
      return [helpText()];
    case "timing":
      throw new Error(":timing has been removed; timing is now always enabled");
    case "time": {
      if (!arg) throw new Error(":time requires an expression");
      return evaluateInput(arg, state);
    }
    case "type": {
      if (!arg) throw new Error(":type requires a type name");
      if (arg.includes("=")) {
        throw new Error("Type definitions use syntax: $ name = typeExpr; Use :type <name> to show a type definition");
      }
      return evaluateCommand(`:C ${arg}`, state);
    }
    case "code":
      return evaluateCommand(`:C ${arg}`, state);
    case "rel":
    case "def":
      throw new Error("Relation definitions use syntax: name = relExpr;");
    case "run":
    case "eval":
      return runExpression(arg, state);
    case "codes":
      return [listAliases(state.typeAliases)];
    case "rels":
      return [listAliases(state.relAliases)];
    case "codec":
    case "codecs":
      return loadCodec(arg, state);
    case "input":
      return requestCodecInput(arg, state);
    case "reset": {
      const fresh = createState();
      Object.assign(state, fresh);
      return ["reset"];
    }
    case "klib": {
      if (!arg) throw new Error(`${usagePrefix}klib requires a file path`);
      fs.writeFileSync(arg, encodeLibrary(savedLibrary(state)));
      return [`saved ${arg}`];
    }
    case "ko": {
      if (!arg) throw new Error(`${usagePrefix}ko requires a file path and main expression`);
      const [path, ...mainParts] = arg.split(/\s+/);
      if (mainParts.length === 0) {
        throw new Error(":ko file expr requires a main expression");
      }
      const object = executableObject(state, mainParts.join(" "));
      fs.writeFileSync(path, encodeObject(object));
      const main = mainParts.join(" ").trim();
      return [`saved ${path} (${main})`];
    }
    case "load": {
      const { path: loadPath, loadAliases } = parseLoadArgs(arg, usagePrefix);
      loadSourceOrKlib(state, loadPath, { loadAliases });
      return [`loaded ${loadPath}`];
    }
    case "t": {
      if (!arg) throw new Error(`${usagePrefix}t requires a relation name`);
      const { hash, rel } = resolveRel(state, arg);
      if (!rel) throw new Error(`Unknown relation '${arg}'`);
      return [`${arg} : ${relTypeString(rel)}  (${hash})`];
    }
    case "d": {
      if (!arg) throw new Error(`${usagePrefix}d requires a relation name`);
      const { hash, rel } = resolveRel(state, arg);
      if (!rel) throw new Error(`Unknown relation '${arg}'`);
      return [`${arg} = ${prettyRelation(rel, displayAliases(state), state.relAliases)};  -- ${hash}`];
    }
    case "C": {
      if (!arg) throw new Error(`${usagePrefix}C requires a type name`);
      const hash = state.typeAliases[arg] || (arg.startsWith("@") ? arg : null);
      if (!hash || !(hash in state.codes)) throw new Error(`Unknown type '${arg}'`);
      return [`$ ${arg} = ${prettyCode(displayAliases(state), codes.find, codes.find(hash))};  -- ${hash}`];
    }
    default:
      throw new Error(`Unknown command ':${command}'. Try :help`);
  }
}

function helpText() {
  return [
    ":run expr            run an expression on the current value",
    ":time expr           run an expression and report compilation/execution time",
    ":t name              show relation type",
    ":d name              show relation definition",
    ":type name           show type definition",
    ":codes               list type aliases",
    ":rels                list relation aliases",
    ":codec load file     load a REPL codec module (or built-in: int, utf8, json, ieee, unit)",
    ":codec unload name   unload a registered codec",
    ":codec list          list loaded codecs (or simply :codecs)",
    ":input [<filter=(...)> [codec]]  read next line as codec input",
    ":load [--no-alias] file",
    "                     load .k source or .klib",
    ":klib file           export state as a library",
    ":ko file expr        export executable .ko using expr as main",
    ":reset               clear state",
    ":help                show this help",
    "",
    "Raw k input is compiled as a snippet on top of the current state.",
    "A line ending with ';' plus only spaces closes the snippet.",
    "Use '\\' to force continuation."
  ].join("\n");
}

function promptForState(state) {
  const promptName = state.pendingInput?.promptName;
  return promptName ? `${promptName}> ` : "> ";
}

function cliUsage() {
  console.log("Usage: k-repl");
  console.log("       k-repl -h");
  console.log("");
  console.log("Start the interactive k interpreter. Type :help inside the REPL for commands.");
  console.log("");
  console.log("Options:");
  console.log("  -h, --help   Show this help.");
}

function startRepl() {
  const state = createState();
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: "> ",
    completer: createCompleter(state)
  });
  const buffer = [];
  let pending = Promise.resolve();
  let closed = false;

  console.log("k interpreter (.klib-backed). Type :help for commands.");
  rl.prompt();
  async function handleLine(line) {
    if (state.pendingInput && buffer.length === 0) {
      rl.setPrompt("> ");
      try {
        for (const output of await consumeCodecInput(line, state)) {
          console.log(output);
        }
      } catch (error) {
        console.error(error.message || String(error));
      }
      if (!closed) rl.prompt();
      return;
    }

    if (lineHasExplicitContinuation(line)) {
      buffer.push(lineForContinuation(line));
      rl.setPrompt("  ");
      if (!closed) rl.prompt();
      return;
    }

    if (buffer.length === 0 && line.trim().startsWith(":")) {
      rl.setPrompt("> ");
      try {
        for (const output of await evaluateInput(line, state)) {
          console.log(output);
        }
      } catch (error) {
        console.error(error.message || String(error));
      }
      rl.setPrompt(promptForState(state));
      if (!closed) rl.prompt();
      return;
    }

    buffer.push(line);
    const input = buffer.join("\n");
    const explicitTerminated = lineTerminatesSnippet(line);
    if (!explicitTerminated) {
      try {
        const analysis = analyzeRawSnippet(input);
        if (analysis.kind !== "withMain") {
          rl.setPrompt("  ");
          if (!closed) rl.prompt();
          return;
        }
      } catch (error) {
        buffer.length = 0;
        rl.setPrompt("> ");
        console.error(error.message || String(error));
        if (!closed) rl.prompt();
        return;
      }
    }

    buffer.length = 0;
    rl.setPrompt("> ");
    try {
      for (const output of await runSnippet(input, state, { explicitTerminated })) {
        console.log(output);
      }
    } catch (error) {
      console.error(error.message || String(error));
    }
    if (!closed) rl.prompt();
  }

  rl.on("line", (line) => {
    pending = pending.then(() => handleLine(line));
  }).on("close", () => {
    closed = true;
    pending.finally(() => exit(0));
  });
}

if (isMainEntrypoint()) {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    cliUsage();
    exit(0);
  }
  if (args.length > 0) {
    cliUsage();
    exit(1);
  }
  startRepl();
}

export {
  aliasNames,
  analyzeAcceptedSnippet,
  analyzeRawSnippet,
  canonicalNames,
  completeInput,
  createCompleter,
  createState,
  evaluateInput,
  explicitSnippetTerminated,
  helpText,
  isMainEntrypoint,
  lineHasExplicitContinuation,
  lineTerminatesSnippet,
  listCodecs,
  loadCodecModule,
  registerCodec,
  unregisterCodec,
  resolveCodec,
  resolveInputTypeHash,
  resolveInputPattern,
  valueForPattern,
  codeHashToPattern,
  BUILTIN_CODECS,
  printValue,
  promptForState,
  propertyListToFilter,
  savedLibrary,
  loadSourceOrKlib,
  ensureCodecDependencies,
  valueToK,
  formatDuration
};
