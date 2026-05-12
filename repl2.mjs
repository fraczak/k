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
  "codes", "rels", "val", "reset", "save", "klib", "ko", "export", "load",
  "quit", "exit"
];
const PATH_COMMANDS = new Set(["save", "klib", "ko", "export", "load"]);
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

function compileWithOptionalIdentity(source, options) {
  try {
    return hydrateObject(compileLibrary(source, options));
  } catch (error) {
    if (!/got 'EOF'|Expecting/.test(error.message)) throw error;
    return hydrateObject(compileLibrary(`${source}\n()`, options));
  }
}

function annotateWithOptionalIdentity(source, options) {
  try {
    return annotate(source, options);
  } catch (error) {
    if (!/got 'EOF'|Expecting/.test(error.message)) throw error;
    return annotate(`${source}\n()`, options);
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
    throw new Error(":ko requires a main expression unless one has already been evaluated or defined");
  }

  restoreCodes(state);
  try {
    return compileObject([aliasPreamble(state), main].filter(Boolean).join("\n"), {
      source: "<repl>",
      libraries: [stateLibrary(state)]
    });
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

  return [[], line];
}

function completeInput(line, state) {
  if (line.startsWith(":")) {
    return completeCommandArgument(line, state);
  }
  if (/@[A-Za-z0-9_?!+-]*$/.test(line)) {
    return completeCanonical(line, state);
  }
  return [[], line];
}

function createCompleter(state) {
  return (line) => completeInput(line, state);
}

function ensureSemicolon(source) {
  return source.trim().endsWith(";") ? source : `${source};`;
}

async function defineType(input, state) {
  const typeMatch = input.match(TYPE_DEF_RE);
  if (!typeMatch) {
    throw new Error("Type definitions use: :type name = <...>");
  }

  const name = typeMatch[1];
  restoreCodes(state);
  const source = [aliasPreamble(state, name), ensureSemicolon(input), "()"].filter(Boolean).join("\n");
  const annotated = annotate(source, { libraries: [stateLibrary(state)] });
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
  const source = [aliasPreamble(state, name), ensureSemicolon(input), name].filter(Boolean).join("\n");
  const lib = hydrateObject(compileLibrary(source, { source: "<repl>", libraries: [stateLibrary(state)] }));
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
  const source = [aliasPreamble(state), expression].filter(Boolean).join("\n");
  const annotated = annotate(source, { libraries: [stateLibrary(state)] });
  const mainRel = annotated.rels.__main__;
  run.defs = annotated;
  state.value = run(codes.find, mainRel.def, state.value, mainRel.typePatternGraph);
  state.lastMain = expression;
  restoreCodes(state);
  return [printValue(state.value)];
}

async function evaluateInput(input, state) {
  const line = input.trim();
  if (line === "" || line.startsWith("#") || line.startsWith("//") || line.startsWith("--")) return [];

  if (line.startsWith(":")) {
    return evaluateCommand(line, state);
  }

  if (input.match(TYPE_DEF_RE)) return defineType(input, state);
  if (input.match(REL_DEF_RE)) return defineRelation(input, state);
  return runExpression(input, state);
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
    case "save": {
      if (!arg) throw new Error(`${usagePrefix}save requires a file path`);
      fs.writeFileSync(arg, encodeLibrary(savedLibrary(state)));
      return [`saved ${arg}`];
    }
    case "klib": {
      if (!arg) throw new Error(`${usagePrefix}klib requires a file path`);
      fs.writeFileSync(arg, encodeLibrary(savedLibrary(state)));
      return [`saved ${arg}`];
    }
    case "ko": {
      if (!arg) throw new Error(`${usagePrefix}ko requires a file path`);
      const [path, ...mainParts] = arg.split(/\s+/);
      const object = executableObject(state, mainParts.join(" "));
      fs.writeFileSync(path, encodeObject(object));
      const main = (mainParts.join(" ") || state.lastMain).trim();
      return [`saved ${path} (${main})`];
    }
    case "export": {
      if (!arg) throw new Error(`${usagePrefix}export requires a file path`);
      const [path, ...mainParts] = arg.split(/\s+/);
      if (path.endsWith(".klib")) {
        fs.writeFileSync(path, encodeLibrary(savedLibrary(state)));
        return [`saved ${path}`];
      }
      if (!path.endsWith(".ko")) {
        throw new Error(":export writes .klib or .ko files; use :klib or :ko for explicit export");
      }
      const object = executableObject(state, mainParts.join(" "));
      fs.writeFileSync(path, encodeObject(object));
      const main = (mainParts.join(" ") || state.lastMain).trim();
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
        const fullSource = [aliasPreamble(state), source].filter(Boolean).join("\n");
        const options = {
          source: arg,
          libraries: [stateLibrary(state)]
        };
        const lib = compileWithOptionalIdentity(fullSource, options);
        const { relAlias, meta } = libraryOriginsFromSource(source, fullSource, lib, options);
        mergeLibrary(state, { ...lib, relAlias, meta }, arg);
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
    ":klib file           export state as .klib",
    ":ko file [expr]      export executable .ko",
    ":export file [expr]  export by extension: .klib or .ko",
    ":val                 print current value",
    ":reset               clear state",
    ":help                show this help",
    "",
    "Raw k definitions and expressions are still accepted as shorthand."
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
    if (line.trim().endsWith("\\")) {
      buffer.push(line.replace(/\\\s*$/, ""));
      rl.setPrompt("  ");
      if (!closed) rl.prompt();
      return;
    }

    const input = [...buffer, line].join("\n");
    buffer.length = 0;
    rl.setPrompt("> ");

    try {
      for (const output of await evaluateInput(input, state)) {
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

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  startRepl();
}

export {
  canonicalNames,
  completeInput,
  createCompleter,
  createState,
  evaluateInput,
  helpText,
  printValue,
  propertyListToFilter,
  valueToK
};
