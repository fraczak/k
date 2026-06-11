import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  aliasNames,
  analyzeAcceptedSnippet,
  analyzeRawSnippet,
  completeInput,
  createState,
  evaluateInput,
  explicitSnippetTerminated,
  helpText,
  isMainEntrypoint,
  lineHasExplicitContinuation,
  lineTerminatesSnippet,
  promptForState
} from "../repl.mjs";
import { decodeObject, objectToFunction } from "../object.mjs";
import { Value } from "../Value.mjs";

const state = createState();

let output = await evaluateInput(":type nat = <{} zero, nat succ>", state);
assert.match(output[0], /^\$ nat = @/);

output = await evaluateInput(":rel succ = |succ", state);
assert.match(output[0], /^succ = @/);

output = await evaluateInput(":codes", state);
assert.match(output[0], /^nat = @/m);

output = await evaluateInput(":rels", state);
assert.match(output[0], /^succ = @/m);

output = await evaluateInput(":run succ", state);
assert.equal(output[0], "{}|succ ?<{} succ, ...>");

output = await evaluateInput("/zero", state);
assert.equal(output[0], "... undefined");
assert.equal(state.value.toJSON(), "succ");

output = await evaluateInput("succ", state);
assert.match(output[0], /^\{\}\|succ\|succ \?</);

output = await evaluateInput(":t succ", state);
assert.match(output[0], /^succ : /);

output = await evaluateInput(":d succ", state);
assert.match(output[0], /^succ = /);

let completions = completeInput(":he", state)[0];
assert.deepEqual(completions, [":help"]);

const canonicalPartial = state.typeAliases.nat.slice(0, 8);
completions = completeInput(`:run ${canonicalPartial}`, state)[0];
assert(completions.some((line) => line.endsWith(state.typeAliases.nat)));

completions = completeInput(`(${canonicalPartial}`, state)[0];
assert(completions.includes(`(${state.typeAliases.nat}`));

completions = completeInput(":run su", state)[0];
assert(completions.includes(":run succ"));
completions = completeInput(":co", state)[0];
assert(completions.includes(":codec"));

completions = completeInput("$na", state)[0];
assert(completions.includes("$nat"));

assert.deepEqual(aliasNames(state), ["nat", "succ"]);
assert.equal(lineTerminatesSnippet(";"), true);
assert.equal(lineTerminatesSnippet("  ;   "), true);
assert.equal(lineTerminatesSnippet("  ;   -- comment"), false);
assert.equal(lineTerminatesSnippet("succ"), false);
assert.equal(explicitSnippetTerminated("$ bool = <{} true, {} false>;"), true);
assert.equal(lineHasExplicitContinuation("succ \\"), true);
assert.equal(analyzeRawSnippet("$ bool = <{} true, {} false>").kind, "incomplete");
assert.equal(analyzeAcceptedSnippet("$ bool = <{} true, {} false>;", true).kind, "definitionsOnly");
assert.equal(analyzeRawSnippet("a =").kind, "incomplete");
assert.equal(analyzeRawSnippet("{} | succ").kind, "withMain");

const offsetState = createState();
await evaluateInput(":type ab = <{} 1, {} 2>", offsetState);
await evaluateInput(":type bool = <{} true, {} false>", offsetState);
await assert.rejects(
  () => evaluateInput("$ab", offsetState),
  /Type Error in 'filter' \(lines 1:1\.\.\.1:4\)/
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-repl-"));
const libPath = path.join(tmpDir, "session.klib");
const recursiveLibPath = path.join(tmpDir, "recursive.klib");
const koPath = path.join(tmpDir, "succ.ko");
const sourcePath = path.join(tmpDir, "session.k");
const codecPath = path.join(tmpDir, "bool-codec.mjs");
const symlinkPath = path.resolve(".test-k-repl-link");
output = await evaluateInput(`:klib ${libPath}`, state);
assert.equal(output[0], `saved ${libPath}`);

const recursiveState = createState();
await evaluateInput(":type $ nat = < {}_, nat 0, nat 1 >;", recursiveState);
await evaluateInput(":rel 0? = $ nat < / _ {}|0, / 0 0? >;", recursiveState);
const staleZeroHash = recursiveState.relAliases["0?"];
await evaluateInput(":rel 0? = $ nat < / _ {}|_, / 0 0? >;", recursiveState);
const zeroHash = recursiveState.relAliases["0?"];
assert.notEqual(zeroHash, staleZeroHash);
await evaluateInput("{}|_|0|0 $nat", recursiveState);
assert.deepEqual(
  Object.keys(recursiveState.rels).sort(),
  [staleZeroHash, zeroHash].sort()
);
output = await evaluateInput(`:klib ${recursiveLibPath}`, recursiveState);
assert.equal(output[0], `saved ${recursiveLibPath}`);
const recursiveLibrary = JSON.parse(fs.readFileSync(recursiveLibPath, "utf8"));
assert.deepEqual(Object.keys(recursiveLibrary.rels), [zeroHash]);

completions = completeInput(`:load ${tmpDir}/ses`, state)[0];
assert(completions.includes(`:load ${libPath}`));
completions = completeInput(`:load --no-alias ${tmpDir}/ses`, state)[0];
assert(completions.includes(`:load --no-alias ${libPath}`));

output = await evaluateInput(`:ko ${koPath} succ`, state);
assert.equal(output[0], `saved ${koPath} (succ)`);
const objectFn = objectToFunction(decodeObject(fs.readFileSync(koPath)));
const objectResult = objectFn(Value.product({}, [["closed-product", []]]));
assert.equal(objectResult.toJSON(), "succ");

fs.writeFileSync(sourcePath, "$ nat = <{} zero, nat succ>;\nsucc = $nat |succ $nat;\ntwice = succ succ;\n");
const loadedSource = createState();
output = await evaluateInput(`:load ${sourcePath}`, loadedSource);
assert.equal(output[0], `loaded ${sourcePath}`);
output = await evaluateInput(":codes", loadedSource);
assert.match(output[0], /^nat = @/m);
output = await evaluateInput(":rels", loadedSource);
assert.match(output[0], /^succ = @/m);
output = await evaluateInput(":d twice", loadedSource);
assert.match(output[0], /^twice = \$nat succ succ \$nat;  -- @/);
output = await evaluateInput(":C nat", loadedSource);
assert.match(output[0], /^\$ nat = < nat succ, @[^ ]+ zero >;  -- @/);

const codecState = createState();
output = await evaluateInput(":type bool = <{} true, {} false>", codecState);
assert.match(output[0], /^\$ bool = @/);
const boolHash = codecState.typeAliases.bool;
const valueModuleUrl = pathToFileURL(path.resolve("Value.mjs")).href;
fs.writeFileSync(codecPath, `
import { Value } from ${JSON.stringify(valueModuleUrl)};

export const name = "yn";
export const codes = [${JSON.stringify(boolHash)}];

export function parse(text) {
  const tag = text.trim();
  if (tag !== "true" && tag !== "false") throw new Error("expected true or false");
  return Value.variant(tag, Value.product({}));
}

export function print(value) {
  return value.tag;
}
`);
assert.match(helpText(), /:codec load file/);
output = await evaluateInput(":codec list", codecState);
assert.equal(output[0], "(none)");
completions = completeInput(":codec l", codecState)[0];
assert(completions.includes(":codec load"));
assert(completions.includes(":codec list"));
completions = completeInput(`:codec load ${tmpDir}/bool`, codecState)[0];
assert(completions.includes(`:codec load ${codecPath}`));
output = await evaluateInput(`:codec load ${codecPath}`, codecState);
assert.equal(output[0], `loaded codec yn for ${boolHash}`);
output = await evaluateInput(":codec list", codecState);
assert.match(output[0], new RegExp(`^yn ${boolHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
completions = completeInput(":input bo", codecState)[0];
assert(completions.includes(":input bool"));
completions = completeInput(":input bool y", codecState)[0];
assert(completions.includes(":input bool yn"));
output = await evaluateInput(":input bool yn", codecState);
assert.equal(output[0], `input ${boolHash} using yn: enter value text`);
output = await evaluateInput("true", codecState);
assert.match(output[0], /\{\}\|true \?</);
assert.match(output[0], /yn: true/);
output = await evaluateInput("{} | false", codecState);
assert.doesNotMatch(output[0], /yn: false/);

const utf8State = createState();
output = await evaluateInput(":load core.k", utf8State);
assert.equal(output[0], "loaded core.k");
output = await evaluateInput(":codec load ./codecs/utf8.mjs", utf8State);
assert.equal(output[0], `loaded codec utf8 for ${utf8State.typeAliases.string}`);
output = await evaluateInput(":input string utf8", utf8State);
assert.equal(output[0], `input ${utf8State.typeAliases.string} using utf8: enter value text`);
output = await evaluateInput("hello", utf8State);
assert.match(output[0], /utf8: hello/);

const jsonState = createState();
output = await evaluateInput(":type bool = <{} true, {} false>", jsonState);
assert.match(output[0], /^\$ bool = @/);
output = await evaluateInput(":codec load ./codecs/json.mjs", jsonState);
assert.equal(output[0], "loaded codec json for all types");
output = await evaluateInput(":codec list", jsonState);
assert.match(output[0], /^json all /);
completions = completeInput(":input bool j", jsonState)[0];
assert(completions.includes(":input bool json"));
output = await evaluateInput(":input bool", jsonState);
assert.equal(output[0], `input ${jsonState.typeAliases.bool}: enter value text`);
assert.equal(promptForState(jsonState), "json> ");
output = await evaluateInput("true", jsonState);
assert.match(output[0], /\{\}\|true \?</);
assert.match(output[0], /json: true/);
assert.equal(promptForState(jsonState), "> ");
output = await evaluateInput(":input <{}true,{}false>", jsonState);
assert.equal(output[0], `input ${jsonState.typeAliases.bool}: enter value text`);
assert.equal(promptForState(jsonState), "json> ");
output = await evaluateInput("false", jsonState);
assert.match(output[0], /\{\}\|false \?</);
assert.match(output[0], /json: false/);
assert.equal(promptForState(jsonState), "> ");
output = await evaluateInput(":input {bool left, bool right} json", jsonState);
assert.match(output[0], /^input @[^ ]+ using json: enter value text$/);
assert.equal(promptForState(jsonState), "json> ");
output = await evaluateInput('{"left":true,"right":false}', jsonState);
assert.match(output[0], /json: \{"left":true,"right":false\}/);
assert.equal(promptForState(jsonState), "> ");

const replPath = fileURLToPath(new URL("../repl.mjs", import.meta.url));
try {
  fs.rmSync(symlinkPath, { force: true });
} catch {}
fs.symlinkSync(replPath, symlinkPath);
fs.chmodSync(replPath, 0o755);
assert.equal(isMainEntrypoint(symlinkPath), true);

const reloaded = createState();
output = await evaluateInput(`:load ${libPath}`, reloaded);
assert.equal(output[0], `loaded ${libPath}`);

output = await evaluateInput(":codes", reloaded);
assert.match(output[0], /^nat = @/m);

output = await evaluateInput(":rels", reloaded);
assert.match(output[0], /^succ = @/m);

output = await evaluateInput("succ", reloaded);
assert.equal(output[0], "{}|succ ?<{} succ, ...>");

const noAliasReloaded = createState();
output = await evaluateInput(`:load --no-alias ${libPath}`, noAliasReloaded);
assert.equal(output[0], `loaded ${libPath}`);
output = await evaluateInput(":codes", noAliasReloaded);
assert.equal(output[0], "(none)");
output = await evaluateInput(":rels", noAliasReloaded);
assert.equal(output[0], "(none)");

const shorthand = createState();
output = await evaluateInput("$ nat = <{} zero, nat succ>\n; succ = |succ\n;", shorthand);
assert.deepEqual(output, []);
output = await evaluateInput(":codes", shorthand);
assert.match(output[0], /^nat = @/m);
output = await evaluateInput(":rels", shorthand);
assert.match(output[0], /^succ = @/m);
output = await evaluateInput("$ bool = <{} true, {} false>\n; not = $bool </true | false, {} | true >\n; {} | true not", shorthand);
assert.match(output[0], /^\{\}\|false \?</);
assert.match(output[0], / false/);
assert.match(output[0], / true/);
output = await evaluateInput("$ maybe = <{} none, {} some>;", shorthand);
assert.deepEqual(output, []);
output = await evaluateInput(":codes", shorthand);
assert.match(output[0], /^maybe = @/m);
output = await evaluateInput("{} | true not", shorthand);
assert.match(output[0], /^\{\}\|false \?</);

await assert.rejects(
  () => evaluateInput("/type", createState()),
  /Type Error|Unknown ref: 'type'|Parse error|Parse Error/
);

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(symlinkPath, { force: true });
console.log("OK");
