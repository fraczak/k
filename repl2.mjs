#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { argv, exit, stdin, stdout } from "node:process";

import { annotate, parse } from "./index.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";
import { Product } from "./Value.mjs";
import { patterns2filters, prettyCode, prettyRel } from "./pretty.mjs";
import {
  compileObject,
  compileLibrary,
  decodeLibrary,
  encodeObject,
  encodeLibrary,
  hydrateObject,
  loadLibrary
} from "./object.mjs";
import { propertyListToFilter, valueToK, valueWithEnvelopeToK } from "./codecs/runtime/show-value.mjs";

const NAME_RE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;
const TYPE_DEF_RE = /^\s*\$\s*([a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*)\s*=/;
const REL_DEF_RE = /^\s*([a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*)\s*=/;
const COMMAND_NAMES = [
  "help", "type", "code", "rel", "def", "run", "eval", "t", "d", "C",
  "codes", "rels", "val", "reset", "klib", "ko", "load",
  "quit", "exit"
];
const PATH_COMMANDS = new Set(["klib", "ko", "load"]);
const initialCodes = codes.dump();

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyValue() {
  return new Product({}, [["closed-product", []]]);
}

function createState() {
  codes.load(cloneJSON(initialCodes));
  return {
    codes: codes.dump(),
    rels: {},
    relAliases: {},
    typeAliases: {},
    meta: {},
    value: emptyValue(),
    lastMain: null
  };
}

function stateLibrary(state) {
  return {
    format: "k-object",
    version: 2,
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
    if (!state.meta[hash]) state.meta[hash] = { origins: [] };
    state.meta[hash].origins.push(...origins);
  }
}

function rememberOrigin(state, hash, name, kind, source = "<repl>") {
  if (!state.meta[hash]) state.meta[hash] = { origins: [] };
  const exists = state.meta[hash].origins.some((origin) =>
    origin.name === name && origin.kind === kind && origin.source === source
  );
  if (!exists) {
    state.meta[hash].origins.push({
      source,
      name,
      kind,
      compiledAt: new Date().toISOString()
    });
  }
}

function recoverAliasesFromMeta(state, lib) {
  for (const [hash, entry] of Object.entries(lib.meta || {})) {
    for (const origin of entry?.origins || []) {
      if (!origin?.name || !NAME_RE.test(origin.name)) continue;
      if (origin.kind === "code" || (!origin.kind && hash in state.codes && !(hash in state.rels))) {
        state.typeAliases[origin.name] = hash;
      } else if (origin.kind === "rel" || hash in state.rels) {
        state.relAliases[origin.name] = hash;
      }
    }
  }
}

function mergeLibrary(state, lib, source = "<load>") {
  state.codes = { ...state.codes, ...(lib.codes || {}) };
  state.rels = { ...state.rels, ...(lib.rels || {}) };
  state.relAliases = { ...state.relAliases, ...(lib.relAlias || {}) };
  mergeMeta(state, lib.meta);

  for (const [name, hash] of Object.entries(lib.relAlias || {})) {
    if (name !== "__main__" && NAME_RE.test(name) && hash in state.rels) {
      state.relAliases[name] = hash;
      rememberOrigin(state, hash, name, "rel", source);
    }
  }
  recoverAliasesFromMeta(state, lib);
  restoreCodes(state);
}

function savedLibrary(state) {
  const meta = cloneJSON(state.meta);
  for (const [name, hash] of Object.entries(state.typeAliases)) {
    if (!meta[hash]) meta[hash] = { origins: [] };
    meta[hash].origins.push({ source: "<repl>", name, kind: "code" });
  }
  for (const [name, hash] of Object.entries(state.relAliases)) {
    if (!meta[hash]) meta[hash] = { origins: [] };
    meta[hash].origins.push({ source: "<repl>", name, kind: "rel" });
  }
  return {
    format: "k-object",
    version: 2,
    codes: state.codes,
    rels: state.rels,
    relAlias: state.relAliases,
    compileStats: { sccs: [], sccCount: 0 },
    meta,
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

function printValue(value = null) {
  return valueWithEnvelopeToK(value);
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

function libraryOriginsFromSource(source, fullSource, lib, options) {
  const { typeNames, relNames } = userDefinedNames(source);
  const annotated = annotateWithOptionalIdentity(fullSource, options);
  const meta = {};
  const now = new Date().toISOString();

  for (const name of typeNames) {
    const hash = annotated.representatives?.[name];
    if (!hash) continue;
    if (!meta[hash]) meta[hash] = { origins: [] };
    meta[hash].origins.push({ source: options.source || null, name, kind: "code", compiledAt: now });
  }

  const relAlias = Object.fromEntries(
    relNames
      .map((name) => [name, lib.relAlias?.[name]])
      .filter(([, hash]) => hash != null)
  );

  for (const [name, hash] of Object.entries(relAlias)) {
    if (!meta[hash]) meta[hash] = { origins: [] };
    meta[hash].origins.push({ source: options.source || null, name, kind: "rel", compiledAt: now });
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

function aliasNames(state) {
  return [...new Set([
    ...Object.keys(state.typeAliases),
    ...Object.keys(state.relAliases)
  ])].sort();
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

function completeCommandArgument(line, state) {
  const body = line.slice(1);
  const firstSpace = body.search(/\s/);
  if (firstSpace === -1) return completeCommandName(line);

  const command = body.slice(0, firstSpace);
  const argStart = 1 + firstSpace + 1;
  const arg = line.slice(argStart);

  if (PATH_COMMANDS.has(command) && commandArgIndex(arg) === 0) {
    const tokenStart = argStart + completionTokenStart(arg);
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

async function defineType(input, state) {
  const typeMatch = input.match(TYPE_DEF_RE);
  if (!typeMatch) {
    throw new Error("Type definitions use: :type name = <...>");
  }

  const name = typeMatch[1];
  restoreCodes(state);
  const preamble = aliasPreamble(state, name);
  const source = [preamble, ensureSemicolon(input), "()"].filter(Boolean).join("\n");
  let annotated;
  try {
    annotated = annotate(source, { libraries: [stateLibrary(state)] });
  } catch (error) {
    throw remapError(error, preambleLineCount(preamble));
  }
  const hash = annotated.representatives[name];
  if (!hash) throw new Error(`Type definition did not produce an alias for '${name}'`);
  state.codes = codes.dump();
  state.typeAliases[name] = hash;
  rememberOrigin(state, hash, name, "code");
  return [`$ ${name} = ${hash}`];
}

async function defineRelation(input, state) {
  const relMatch = input.match(REL_DEF_RE);
  if (!relMatch) {
    throw new Error("Relation definitions use: :rel name = expression");
  }

  const name = relMatch[1];
  restoreCodes(state);
  const preamble = aliasPreamble(state, name);
  const source = [preamble, ensureSemicolon(input), name].filter(Boolean).join("\n");
  let lib;
  try {
    lib = hydrateObject(compileLibrary(source, { source: "<repl>", libraries: [stateLibrary(state)] }));
  } catch (error) {
    throw remapError(error, preambleLineCount(preamble));
  }
  const hash = lib.relAlias?.[name];
  if (!hash || !lib.rels?.[hash]) throw new Error(`Relation definition did not produce an alias for '${name}'`);
  state.codes = codes.dump();
  state.rels[hash] = lib.rels[hash];
  state.relAliases[name] = hash;
  state.lastMain = name;
  mergeMeta(state, lib.meta);
  rememberOrigin(state, hash, name, "rel");
  return [`${name} = ${hash}`];
}

async function runExpression(input, state) {
  const expression = input.trim();
  if (!expression) throw new Error(":run requires an expression");

  restoreCodes(state);
  const preamble = aliasPreamble(state);
  const source = [preamble, expression].filter(Boolean).join("\n");
  let annotated;
  try {
    annotated = annotate(source, { libraries: [stateLibrary(state)] });
  } catch (error) {
    throw remapError(error, preambleLineCount(preamble));
  }
  const mainRel = annotated.rels.__main__;
  run.defs = annotated;
  try {
    state.value = run(codes.find, mainRel.def, state.value, mainRel.typePatternGraph);
  } catch (error) {
    throw remapError(error, preambleLineCount(preamble));
  }
  state.lastMain = expression;
  restoreCodes(state);
  return [printValue(state.value)];
}

async function runSnippet(input, state, options = {}) {
  const snippet = input.trim();
  if (!snippet) return [];

  const explicitTerminated = options.explicitTerminated ?? explicitSnippetTerminated(input);
  const analysis = analyzeAcceptedSnippet(snippet, explicitTerminated);
  const { annotated, lib, lineOffset } = compileSnippetArtifacts(snippet, state);
  mergeLibrary(state, lib, "<repl>");

  if (analysis.kind === "definitionsOnly") {
    restoreCodes(state);
    return [];
  }

  const mainRel = annotated.rels.__main__;
  run.defs = annotated;
  try {
    state.value = run(codes.find, mainRel.def, state.value, mainRel.typePatternGraph);
  } catch (error) {
    throw remapError(error, lineOffset);
  }
  state.lastMain = snippet;
  restoreCodes(state);
  return [printValue(state.value)];
}

async function evaluateInput(input, state) {
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
    case "type": {
      if (!arg) throw new Error(":type requires a name or definition");
      if (arg.includes("=")) {
        const definition = arg.trim().startsWith("$") ? arg : `$ ${arg}`;
        return defineType(definition, state);
      }
      return evaluateCommand(`:C ${arg}`, state);
    }
    case "code":
      return evaluateCommand(`:C ${arg}`, state);
    case "rel":
    case "def":
      if (!arg) throw new Error(`:${command} requires a relation definition`);
      return defineRelation(arg, state);
    case "run":
    case "eval":
      return runExpression(arg, state);
    case "codes":
      return [listAliases(state.typeAliases)];
    case "rels":
      return [listAliases(state.relAliases)];
    case "val":
      return [
        printValue(state.value),
        JSON.stringify(state.value, null, 2)
      ];
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
      if (!arg) throw new Error(`${usagePrefix}load requires a file path`);
      if (arg.endsWith(".klib")) {
        const lib = loadLibrary(decodeLibrary(fs.readFileSync(arg)));
        mergeLibrary(state, lib, arg);
      } else {
        restoreCodes(state);
        const source = fs.readFileSync(arg, "utf8");
        const preamble = aliasPreamble(state);
        const fullSource = [preamble, source].filter(Boolean).join("\n");
        const options = {
          source: arg,
          libraries: [stateLibrary(state)]
        };
        try {
          const lib = compileWithOptionalIdentity(fullSource, options);
          const { relAlias, meta } = libraryOriginsFromSource(source, fullSource, lib, options);
          mergeLibrary(state, { ...lib, relAlias, meta }, arg);
        } catch (error) {
          throw remapError(error, preambleLineCount(preamble));
        }
      }
      return [`loaded ${arg}`];
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
      return [`${arg} = ${prettyRel(rel.def)};  -- ${hash}`];
    }
    case "C": {
      if (!arg) throw new Error(`${usagePrefix}C requires a type name`);
      const hash = state.typeAliases[arg] || (arg.startsWith("@") ? arg : null);
      if (!hash || !(hash in state.codes)) throw new Error(`Unknown type '${arg}'`);
      return [`$ ${arg} = ${prettyCode({}, codes.find, codes.find(hash))};  -- ${hash}`];
    }
    default:
      throw new Error(`Unknown command ':${command}'. Try :help`);
  }
}

function helpText() {
  return [
    ":type name = <...>   define a type",
    ":rel name = expr     define a relation",
    ":run expr            run an expression on the current value",
    ":t name              show relation type",
    ":d name              show relation definition",
    ":type name           show type definition",
    ":codes               list type aliases",
    ":rels                list relation aliases",
    ":load file           load .k source or .klib",
    ":klib file           export state as a library",
    ":ko file expr        export executable .ko using expr as main",
    ":val                 print current value",
    ":reset               clear state",
    ":help                show this help",
    "",
    "Raw k input is compiled as a snippet on top of the current state.",
    "A line ending with ';' plus only spaces closes the snippet.",
    "Use '\\' to force continuation."
  ].join("\n");
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
  printValue,
  propertyListToFilter,
  valueToK
};
