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
  promptForState,
  registerCodec
} from "../repl.mjs";
import { decodeObject, objectToFunction } from "../object.mjs";
import { Value } from "../Value.mjs";

const state = createState();

let output = await evaluateInput("$ nat = < {} zero, nat succ >;", state);
output = await evaluateInput(":type nat", state);
assert.match(output[0], /^\$ nat = /);

output = await evaluateInput("succ = | succ;", state);
output = await evaluateInput(":d succ", state);
assert.match(output[0], /^succ = /);

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
await evaluateInput("$ ab = < {} 1, {} 2 >;", offsetState);
await evaluateInput("$ bool = < {} true, {} false >;", offsetState);
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
await evaluateInput("$ nat = < {} _, nat 0, nat 1 >;", recursiveState);
await evaluateInput("0? = $ nat < / _ {} | 0, / 0 0? >;", recursiveState);
const staleZeroHash = recursiveState.relAliases["0?"];
await evaluateInput("0? = $ nat < / _ {} | _, / 0 0? >;", recursiveState);
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
output = await evaluateInput("$ bool = < {} true, {} false >;", codecState);
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
output = await evaluateInput("$ bool = < {} true, {} false >;", jsonState);
output = await evaluateInput(":codec load ./codecs/json.mjs", jsonState);
assert.match(output[0], /^loaded codec json for all types/);
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
assert.match(output[0], /\/\* comp: .* \*\//);
output = await evaluateInput(":codes", shorthand);
assert.match(output[0], /^nat = @/m);
output = await evaluateInput(":rels", shorthand);
assert.match(output[0], /^succ = @/m);
output = await evaluateInput("$ bool = <{} true, {} false>\n; not = $bool </true | false, {} | true >\n; {} | true not", shorthand);
assert.match(output[0], /^\{\}\|false \?</);
assert.match(output[0], / false/);
assert.match(output[0], / true/);
output = await evaluateInput("$ maybe = <{} none, {} some>;", shorthand);
assert.match(output[0], /\/\* comp: .* \*\//);
output = await evaluateInput(":codes", shorthand);
assert.match(output[0], /^maybe = @/m);
output = await evaluateInput("{} | true not", shorthand);
assert.match(output[0], /^\{\}\|false \?</);

await assert.rejects(
  () => evaluateInput("/type", createState()),
  /Type Error|Unknown ref: 'type'|Parse error|Parse Error/
);

// Verify WebAssembly in-process backend supports TCO / stack safety on deep recursion
const tcoState = createState();
await evaluateInput("$ nat = < {} zero, nat succ >;", tcoState);
await evaluateInput("countdown = $ nat < / zero {} | zero, / succ countdown >;", tcoState);

let deepNat = Value.variant("zero", Value.product({}, [["closed-product", []]]), [["open-union", [["zero", 1]]], ["closed-product", []]]);
for (let i = 0; i < 5000; i++) {
  deepNat = Value.variant("succ", deepNat, [["open-union", [["succ", 1]]], ...deepNat.pattern]);
}
tcoState.value = deepNat;

output = await evaluateInput("countdown", tcoState);
assert.match(output[0], /^\{\}\|zero/);
assert.equal(tcoState.value.toJSON(), "zero");

// Verify loading library and evaluating constant/recursive relation from library
const arithState = createState();
output = await evaluateInput(":load Examples/arithmetics.k", arithState);
assert.equal(output[0], "loaded Examples/arithmetics.k");
output = await evaluateInput("10", arithState);
assert.match(output[0], /^\{\}\|_\|0\|1\|0\|1/);
output = await evaluateInput("{10 int x, 5 int y} plus", arithState);
assert.match(output[0], /^\{\}\|_\|1\|1\|1\|1\|\+/);

// Verify built-in codecs, :codecs, and :codec unload
const codecTestState = createState();
output = await evaluateInput(":codecs", codecTestState);
assert.equal(output[0], "(none)");

output = await evaluateInput(":codec load int", codecTestState);
assert.match(output[0], /^loaded codec int for @/);

output = await evaluateInput(":codecs", codecTestState);
assert.match(output[0], /^int @/);

completions = completeInput(":codec un", codecTestState)[0];
assert(completions.includes(":codec unload"));
completions = completeInput(":codec unload ", codecTestState)[0];
assert(completions.includes(":codec unload int"));
completions = completeInput(":codec load i", codecTestState)[0];
assert(completions.includes(":codec load int"));

output = await evaluateInput(":codec unload int", codecTestState);
assert.equal(output[0], "unloaded codec int");
output = await evaluateInput(":codecs", codecTestState);
assert.equal(output[0], "(none)");

output = await evaluateInput("$ bool = < {} true, {} false >;", codecTestState);
registerCodec(codecTestState, {
  name: "yn",
  codes: [codecTestState.typeAliases.bool],
  universal: false,
  parse: (text) => Value.variant(text.trim() === "yes" ? "true" : "false", Value.product({})),
  print: (v) => v.tag === "true" ? "YES" : "NO"
}, "<test>");

output = await evaluateInput(":input bool yn", codecTestState);
output = await evaluateInput("yes", codecTestState);
assert.match(output[0], /yn: YES/);

// Projection on product with variant field (avoids filter variable collisions)
const projState = createState();
output = await evaluateInput("{{}|a x, {} y}", projState);
assert.match(output[0], /^\{\{\}\|a x, \{\} y\}/);
output = await evaluateInput(".x", projState);
assert.match(output[0], /^\{\}\|a/);

const projState2 = createState();
output = await evaluateInput("{{}|a a, {} y}", projState2);
assert.match(output[0], /^\{\{\}\|a a, \{\} y\}/);
output = await evaluateInput(".a", projState2);
assert.match(output[0], /^\{\}\|a/);

// Auto-loading dependencies and bidirectional type aliasing tests
const autoLoadState = createState();
output = await evaluateInput(":codec load int", autoLoadState);
assert.match(output[0], /auto-loaded (?:Examples\/)?arithmetics\.k/);
assert.ok(autoLoadState.typeAliases.int, "int type alias should be registered");
output = await evaluateInput(":input int", autoLoadState);
output = await evaluateInput("123", autoLoadState);
assert.match(output[0], /int: 123/);

const utf8AutoState = createState();
output = await evaluateInput(":codec load utf8", utf8AutoState);
assert.match(output[0], /auto-loaded core\.k/);
assert.ok(utf8AutoState.typeAliases.utf8, "utf8 type alias should be registered");
assert.ok(utf8AutoState.typeAliases.string, "string type alias should be registered");
assert.equal(utf8AutoState.typeAliases.utf8, utf8AutoState.typeAliases.string);
output = await evaluateInput(":input utf8", utf8AutoState);
output = await evaluateInput("test utf8", utf8AutoState);
assert.match(output[0], /utf8: test utf8/);

const ieeeAutoState = createState();
output = await evaluateInput(":codec load ieee", ieeeAutoState);
assert.match(output[0], /auto-loaded (?:Examples\/)?ieee\.k/);
assert.ok(ieeeAutoState.typeAliases.ieee, "ieee type alias should be registered");
assert.ok(ieeeAutoState.typeAliases.float64, "float64 type alias should be registered");
assert.equal(ieeeAutoState.typeAliases.ieee, ieeeAutoState.typeAliases.float64);

const jsonInputState = createState();
await evaluateInput(":load core.k", jsonInputState);
await evaluateInput(":load ieee.k", jsonInputState);
await evaluateInput(":codec load json", jsonInputState);
output = await evaluateInput(":input {string a, float64 n}", jsonInputState);
assert.match(output[0], /enter value text/);
output = await evaluateInput('{"a":"Woj","n":123}', jsonInputState);
assert.match(output[0], /json: \{"a":"Woj","n":123\}/);

// Verify pattern expressions and standalone codec input
const patternInputState = createState();
await evaluateInput(":codec load json", patternInputState);

// 1. Explicit pattern expression: ? {string a, float64 n} json
output = await evaluateInput(":input ? {string a, float64 n} json", patternInputState);
assert.match(output[0], /input \? \{string a, float64 n\} using json: enter value text/);
output = await evaluateInput('{"a":"Woj","n":123}', patternInputState);
assert.match(output[0], /json: \{"a":"Woj","n":123\}/);

// 2. Wildcard pattern expression: ? (...) json
output = await evaluateInput(":input ? (...) json", patternInputState);
assert.match(output[0], /enter value text/);
output = await evaluateInput('{"anything": [1, 2, 3]}', patternInputState);
assert.match(output[0], /json: \{"anything":\[1,2,3\]\}/);

// 3. Standalone codec input: :input json (no predefined type or pattern required)
output = await evaluateInput(":input json", patternInputState);
assert.match(output[0], /input json: enter value text/);
output = await evaluateInput('{"hello":"world"}', patternInputState);
assert.match(output[0], /json: \{"hello":"world"\}/);

// 4. Pattern mismatch detection
output = await evaluateInput(":input ? {string a, float64 n} json", patternInputState);
await assert.rejects(
  () => evaluateInput('{"wrong_key": 999}', patternInputState),
  /Closed product pattern does not match value fields/
);

// 5. Bare :input defaults to :input (...) with auto-loaded json codec
const bareInputState = createState();
assert.equal(promptForState(bareInputState), "> ");
output = await evaluateInput(":input", bareInputState);
assert.deepEqual(output, ["input (...): enter value text"]);
assert.equal(promptForState(bareInputState), "json> ");
output = await evaluateInput('{"test": 123}', bareInputState);
assert.match(output[0], /json: \{"test":123\}/);
assert.equal(promptForState(bareInputState), "> ");

// 6. Pattern as type prefixed by dollar
const dollarPatternState = createState();
await evaluateInput(":load arithmetics.k", dollarPatternState);
output = await evaluateInput(":input $ int", dollarPatternState);
assert.deepEqual(output, ["input $ int: enter value text"]);
assert.equal(promptForState(dollarPatternState), "int> ");
output = await evaluateInput("42", dollarPatternState);
assert.match(output[0], /int: 42/);

await evaluateInput("$ bool = <{} true, {} false>;", dollarPatternState);
output = await evaluateInput(":input $ bool json", dollarPatternState);
assert.deepEqual(output, ["input $ bool using json: enter value text"]);
assert.equal(promptForState(dollarPatternState), "json> ");
output = await evaluateInput("true", dollarPatternState);
assert.match(output[0], /json: true/);

const unitState = createState();
output = await evaluateInput(":codec load unit", unitState);
assert.match(output[0], /loaded codec unit/);
output = await evaluateInput(":input unit", unitState);
assert.match(output[0], /enter value text/);
output = await evaluateInput("{}", unitState);
assert.match(output[0], /unit: \{\}/);

const polyAutoState = createState();
output = await evaluateInput(":load Examples/poly.k", polyAutoState);
assert.equal(output[0], "loaded Examples/poly.k");
assert.ok(polyAutoState.relAliases.reverse, "poly relations should be loaded");
assert.ok(polyAutoState.typeAliases.int, "arithmetics int should be auto-loaded");

// Verify timing reporting is always on and :time command
const timingState = createState();
assert.equal(timingState.showTiming, true);

output = await evaluateInput("()", timingState);
assert.equal(output[0], "{} ?{}");
assert.match(output[1], /\/\* comp: .*, exec: .* \*\//);

output = await evaluateInput(":time ()", timingState);
assert.equal(output[0], "{} ?{}");
assert.match(output[1], /\/\* comp: .*, exec: .* \*\//);
assert.ok(timingState.lastTiming);
assert.ok(typeof timingState.lastTiming.compileMs === "number");
assert.ok(typeof timingState.lastTiming.executeMs === "number");

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(symlinkPath, { force: true });
console.log("OK");
