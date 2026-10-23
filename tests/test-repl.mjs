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

let output = await evaluateInput("zero = {} | zero;", state);
output = await evaluateInput(":rel zero", state);
assert.match(output[0], /^zero = /);

output = await evaluateInput("succ = | succ;", state);
output = await evaluateInput(":rel succ", state);
assert.match(output[0], /^succ = /);

output = await evaluateInput(":rels", state);
assert.match(output[0], /^zero = @/m);
assert.match(output[0], /^succ = @/m);

output = await evaluateInput("succ", state);
assert.equal(output[0], "{}|succ ?<{} succ, ...>");

output = await evaluateInput("/zero", state);
assert.equal(output[0], "... undefined");
assert.equal(state.value.toJSON(), "succ");

output = await evaluateInput("succ", state);
assert.match(output[0], /^\{\}\|succ\|succ \?</);

output = await evaluateInput(":rel succ", state);
assert.match(output[0], /^succ = /);

let completions = completeInput(":he", state)[0];
assert.deepEqual(completions, [":help"]);

const canonicalPartial = state.relAliases.zero.slice(0, 8);
completions = completeInput(`:rel ${canonicalPartial}`, state)[0];
assert(completions.some((line) => line.endsWith(state.relAliases.zero)));

completions = completeInput(`(${canonicalPartial}`, state)[0];
assert(completions.includes(`(${state.relAliases.zero}`));

completions = completeInput(":rel su", state)[0];
assert(completions.includes(":rel succ"));
completions = completeInput(":re", state)[0];
assert(completions.includes(":rels"));
assert(completions.includes(":rel"));

await assert.rejects(
  () => evaluateInput(":run succ", state),
  /Unknown command ':run'/
);
await assert.rejects(
  () => evaluateInput(":time ()", state),
  /Unknown command ':time'/
);
await assert.rejects(
  () => evaluateInput(":t succ", state),
  /Unknown command ':t'/
);

completions = completeInput(":co", state)[0];
assert(completions.includes(":codec"));

completions = completeInput("ze", state)[0];
assert(completions.includes("zero"));

assert.deepEqual(aliasNames(state), ["succ", "zero"]);
assert.equal(lineTerminatesSnippet(";"), true);
assert.equal(lineTerminatesSnippet("  ;   "), true);
assert.equal(lineTerminatesSnippet("  ;   -- comment"), false);
assert.equal(lineTerminatesSnippet("succ"), false);
assert.equal(explicitSnippetTerminated("bool = <{} true, {} false>;"), true);
assert.equal(lineHasExplicitContinuation("succ \\"), true);
assert.equal(analyzeRawSnippet("bool = <{} true, {} false>").kind, "incomplete");
assert.equal(analyzeAcceptedSnippet("bool = <{} true, {} false>;", true).kind, "definitionsOnly");
assert.equal(analyzeRawSnippet("a =").kind, "incomplete");
assert.equal(analyzeRawSnippet("{} | succ").kind, "withMain");

const offsetState = createState();
await evaluateInput("zero = {} | zero;\nsucc = | succ;", offsetState);
await assert.rejects(
  () => evaluateInput("{} .x", offsetState),
  /Type Error in 'comp' \(lines 1:1\.\.\.1:6\)/
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
await evaluateInput("0? = ?< {} _, X 0, X 1 > = X < / _ {} | 0, / 0 0? >;", recursiveState);
const staleZeroHash = recursiveState.relAliases["0?"];
await evaluateInput("0? = ?< {} _, X 0, X 1 > = X < / _ {} | _, / 0 0? >;", recursiveState);
const zeroHash = recursiveState.relAliases["0?"];
assert.notEqual(zeroHash, staleZeroHash);
await evaluateInput("{}|_|0|0 0?", recursiveState);
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

fs.writeFileSync(sourcePath, "succ = |succ;\ntwice = succ succ;\n");
const loadedSource = createState();
output = await evaluateInput(`:load ${sourcePath}`, loadedSource);
assert.equal(output[0], `loaded ${sourcePath}`);
output = await evaluateInput(":rels", loadedSource);
assert.match(output[0], /^succ = @/m);
output = await evaluateInput(":rel twice", loadedSource);
assert.match(output[0], /^twice = .*succ succ.*;  -- @/);

const codecState = createState();
const valueModuleUrl = pathToFileURL(path.resolve("Value.mjs")).href;
fs.writeFileSync(codecPath, `
import { Value } from ${JSON.stringify(valueModuleUrl)};

export const name = "yn";

export function parse(text) {
  const tag = text.trim();
  if (tag !== "true" && tag !== "false") throw new Error("expected true or false");
  return Value.variant(tag, Value.product({}));
}

export function print(value) {
  if (!value || (value.tag !== "true" && value.tag !== "false")) {
    throw new Error("expected true or false");
  }
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
assert.equal(output[0], `loaded codec bool-codec.mjs`);
output = await evaluateInput(":codec list", codecState);
assert.match(output[0], /^bool-codec\.mjs/);
completions = completeInput(":input", codecState)[0];
assert(completions.includes(":input"));
completions = completeInput(":input ", codecState)[0];
assert(completions.includes(":input bool-codec.mjs"));
completions = completeInput(":input b", codecState)[0];
assert(completions.includes(":input bool-codec.mjs"));
output = await evaluateInput(":input bool-codec.mjs", codecState);
assert.equal(promptForState(codecState), "bool-codec.mjs> ");
output = await evaluateInput("true", codecState);
assert.match(output[0], /\{\}\|true \?</);
assert.match(output[0], /bool-codec\.mjs: true/);
output = await evaluateInput("{} | false", codecState);
assert.match(output[0], /bool-codec\.mjs: false/);
output = await evaluateInput("{}", codecState);
assert.doesNotMatch(output[0], /bool-codec\.mjs:/);

const utf8State = createState();
output = await evaluateInput(":load core.k", utf8State);
assert.equal(output[0], "loaded core.k");
output = await evaluateInput(":codec load ./codecs/utf8.mjs", utf8State);
assert.equal(output[0], `loaded codec utf8.mjs`);
output = await evaluateInput(":input utf8.mjs hello", utf8State);
assert.match(output[0], /utf8\.mjs: hello/);

const jsonState = createState();
output = await evaluateInput(":codec load ./codecs/json.mjs", jsonState);
assert.match(output[0], /^loaded codec json\.mjs/);
output = await evaluateInput(":codec list", jsonState);
assert.match(output[0], /^json\.mjs/);
completions = completeInput(":input j", jsonState)[0];
assert(completions.includes(":input json.mjs"));
output = await evaluateInput(":input json.mjs", jsonState);
assert.equal(promptForState(jsonState), "json.mjs> ");
output = await evaluateInput("true", jsonState);
assert.match(output[0], /\{\}\|true \?</);
assert.match(output[0], /json\.mjs: true/);
assert.equal(promptForState(jsonState), "> ");
output = await evaluateInput(":input json.mjs false", jsonState);
assert.match(output[0], /\{\}\|false \?</);
assert.match(output[0], /json\.mjs: false/);
assert.equal(promptForState(jsonState), "> ");
output = await evaluateInput(':input json.mjs {"left":true,"right":false}', jsonState);
assert.match(output[0], /json\.mjs: \{"left":true,"right":false\}/);
assert.equal(promptForState(jsonState), "> ");

// Test djson.mjs in repl
const djsonState = createState();
output = await evaluateInput(":codec load ./codecs/djson.mjs", djsonState);
assert.match(output[0], /^loaded codec djson\.mjs/);
completions = completeInput(":input dj", djsonState)[0];
assert(completions.includes(":input djson.mjs"));
output = await evaluateInput(
  ':input djson.mjs {"msg":"hello","values":[1,2]}',
  djsonState
);
assert.match(output[0], /djson\.mjs: \{"msg":"hello","values":\[1,2\]\}/);

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

output = await evaluateInput(":rels", reloaded);
assert.match(output[0], /^succ = @/m);
assert.match(output[0], /^zero = @/m);

output = await evaluateInput("succ", reloaded);
assert.equal(output[0], "{}|succ ?<{} succ, ...>");

const noAliasReloaded = createState();
output = await evaluateInput(`:load --no-alias ${libPath}`, noAliasReloaded);
assert.equal(output[0], `loaded ${libPath}`);
output = await evaluateInput(":rels", noAliasReloaded);
assert.equal(output[0], "(none)");

const shorthand = createState();
output = await evaluateInput("zero = {} | zero\n; succ = |succ\n;", shorthand);
assert.match(output[0], /\/\* comp: .* \*\//);
output = await evaluateInput(":rels", shorthand);
assert.match(output[0], /^zero = @/m);
assert.match(output[0], /^succ = @/m);
output = await evaluateInput("not = </true | false, /false | true >\n; {} | true not", shorthand);
assert.match(output[0], /^\{\}\|false \?</);
assert.match(output[0], / false/);
assert.match(output[0], / true/);
output = await evaluateInput("maybe = < /none {} | none, /some | some >;", shorthand);
assert.match(output[0], /\/\* comp: .* \*\//);
output = await evaluateInput(":rels", shorthand);
assert.match(output[0], /^maybe = @/m);
output = await evaluateInput("{} | true not", shorthand);
assert.match(output[0], /^\{\}\|false \?</);

await assert.rejects(
  () => evaluateInput("/type", createState()),
  /Type Error|Unknown ref: 'type'|Parse error|Parse Error/
);

// Verify WebAssembly in-process backend supports TCO / stack safety on deep recursion
const tcoState = createState();
await evaluateInput("countdown = ?< {} zero, X succ > = X < / zero {} | zero, / succ countdown >;", tcoState);

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

// Verify codecs loading, listing, and unloading
const codecTestState = createState();
output = await evaluateInput(":codecs", codecTestState);
assert.equal(output[0], "(none)");

output = await evaluateInput(":codec load ./codecs/int.mjs", codecTestState);
assert.match(output[0], /^loaded codec int\.mjs/);

output = await evaluateInput(":codecs", codecTestState);
assert.match(output[0], /^int\.mjs/);

completions = completeInput(":codec un", codecTestState)[0];
assert(completions.includes(":codec unload"));
completions = completeInput(":codec unload ", codecTestState)[0];
assert(completions.includes(":codec unload int.mjs"));
completions = completeInput(":codec load ./codecs/i", codecTestState)[0];
assert(completions.includes(":codec load ./codecs/int.mjs"));

output = await evaluateInput(":codec unload int.mjs", codecTestState);
assert.equal(output[0], "unloaded codec int.mjs");
output = await evaluateInput(":codecs", codecTestState);
assert.equal(output[0], "(none)");

output = await evaluateInput("bool = < /true {} | true, /false {} | false >;", codecTestState);
registerCodec(codecTestState, {
  name: "yn.mjs",
  parse: (text) => Value.variant(text.trim() === "yes" ? "true" : "false", Value.product({})),
  print: (v) => {
    if (v.tag !== "true" && v.tag !== "false") throw new Error("not a bool");
    return v.tag === "true" ? "YES" : "NO";
  }
}, "yn.mjs");

output = await evaluateInput(":input yn.mjs", codecTestState);
assert.equal(promptForState(codecTestState), "yn.mjs> ");
output = await evaluateInput("yes", codecTestState);
assert.match(output[0], /yn\.mjs: YES/);
output = await evaluateInput(":input yn.mjs no", codecTestState);
assert.match(output[0], /yn\.mjs: NO/);

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

// Explicit loading of dependencies and codec testing (no auto-loading)
const intState = createState();
await evaluateInput(":load Examples/arithmetics.k", intState);
output = await evaluateInput(":codec load ./codecs/int.mjs", intState);
assert.match(output[0], /^loaded codec int\.mjs/);
output = await evaluateInput(":input int.mjs", intState);
output = await evaluateInput("123", intState);
assert.match(output[0], /int\.mjs: 123/);
output = await evaluateInput(":input int.mjs", intState);
output = await evaluateInput("[0,1,2]", intState);
assert.match(output[0], /int\.mjs: \[0,1,2\]/);

const utf8AutoState = createState();
await evaluateInput(":load core.k", utf8AutoState);
output = await evaluateInput(":codec load ./codecs/utf8.mjs", utf8AutoState);
assert.match(output[0], /^loaded codec utf8\.mjs/);
output = await evaluateInput(":input utf8.mjs", utf8AutoState);
output = await evaluateInput("test utf8", utf8AutoState);
assert.match(output[0], /utf8\.mjs: test utf8/);

const ieeeAutoState = createState();
await evaluateInput(":load Examples/ieee.k", ieeeAutoState);
output = await evaluateInput(":codec load ./codecs/ieee.mjs", ieeeAutoState);
assert.match(output[0], /^loaded codec ieee\.mjs/);
assert.ok(ieeeAutoState.codecs["ieee.mjs"], "ieee codec should be registered");
output = await evaluateInput(":input ieee.mjs 1.5", ieeeAutoState);
assert.match(output[0], /ieee\.mjs: 1\.5/);

const jsonInputState = createState();
await evaluateInput(":load core.k", jsonInputState);
await evaluateInput(":load Examples/ieee.k", jsonInputState);
await evaluateInput(":codec load ./codecs/json.mjs", jsonInputState);
output = await evaluateInput(':input json.mjs {"a":"Woj","n":123}', jsonInputState);
assert.match(output[0], /json\.mjs: \{"a":"Woj","n":123\}/);

// Verify standalone codec input, one-line and interactive modes, and multi-codec printing
const multiCodecState = createState();
await evaluateInput(":codec load ./codecs/json.mjs", multiCodecState);
await evaluateInput(":codec load ./codecs/utf8.mjs", multiCodecState);
await evaluateInput(":codec load ./codecs/int.mjs", multiCodecState);

// 1. One-line JSON input: :input json.mjs {"hello":"world"}
output = await evaluateInput(':input json.mjs {"hello":"world"}', multiCodecState);
assert.match(output[0], /json\.mjs: \{"hello":"world"\}/);

// 2. Interactive JSON input: :input json.mjs then {"anything": [1, 2, 3]}
output = await evaluateInput(":input json.mjs", multiCodecState);
assert.equal(promptForState(multiCodecState), "json.mjs> ");
output = await evaluateInput('{"anything": [1, 2, 3]}', multiCodecState);
assert.match(output[0], /json\.mjs: \{"anything":\[1,2,3\]\}/);
assert.equal(promptForState(multiCodecState), "> ");

// 3. Integer scalar and list input
output = await evaluateInput(":input int.mjs 42", multiCodecState);
assert.match(output[0], /int\.mjs: 42/);

output = await evaluateInput(":input int.mjs [0,1,2]", multiCodecState);
assert.match(output[0], /int\.mjs: \[0,1,2\]/);

// 4. Bare :input displays usage and loaded codecs
const bareInputState = createState();
output = await evaluateInput(":input", bareInputState);
assert.match(output[0], /^Usage: :input <codec\.mjs> \[text\]/);
assert.match(output[1], /Loaded codecs:/);

// 5. Codec with leading dollar sign is accepted
output = await evaluateInput(":input $ int.mjs 42", multiCodecState);
assert.match(output[0], /int\.mjs: 42/);
output = await evaluateInput(":input $int.mjs 100", multiCodecState);
assert.match(output[0], /int\.mjs: 100/);

// 6. Unknown codec throws descriptive error
await assert.rejects(
  () => evaluateInput(":input nonexistent 123", multiCodecState),
  /Codec 'nonexistent' is not loaded/
);

const unitState = createState();
output = await evaluateInput(":codec load ./codecs/unit.mjs", unitState);
assert.match(output[0], /^loaded codec unit\.mjs/);
output = await evaluateInput(":input unit.mjs", unitState);
assert.equal(promptForState(unitState), "unit.mjs> ");
output = await evaluateInput("{}", unitState);
assert.match(output[0], /unit\.mjs: \{\}/);

const polyAutoState = createState();
output = await evaluateInput(":load Examples/poly.k", polyAutoState);
assert.equal(output[0], "loaded Examples/poly.k");
assert.ok(polyAutoState.relAliases.reverse, "poly relations should be loaded");
assert.ok(polyAutoState.relAliases.int, "arithmetics int should be auto-loaded");

// Verify timing reporting is always on and reflects active engine
const timingState = createState();
assert.equal(timingState.showTiming, true);
assert.equal(timingState.engine, "wasm");

output = await evaluateInput("()", timingState);
assert.equal(output[0], "{} ?{}");
assert.match(output[1], /\/\* comp: .*, exec: .* \(wasm\) \*\//);
assert.ok(timingState.lastTiming);
assert.equal(timingState.lastTiming.engine, "wasm");
assert.ok(typeof timingState.lastTiming.compileMs === "number");
assert.ok(typeof timingState.lastTiming.executeMs === "number");

// Verify :engine command and switching between wasm and js engines
output = await evaluateInput(":engine", timingState);
assert.equal(output[0], "Current engine: wasm");

output = await evaluateInput(":engine js", timingState);
assert.equal(output[0], "engine set to js");
assert.equal(timingState.engine, "js");

output = await evaluateInput("()", timingState);
assert.equal(output[0], "{} ?{}");
assert.match(output[1], /\/\* comp: .*, exec: .* \(js\) \*\//);
assert.equal(timingState.lastTiming.engine, "js");

// Verify shortcuts :wasm and :js
output = await evaluateInput(":wasm", timingState);
assert.equal(output[0], "engine set to wasm");
assert.equal(timingState.engine, "wasm");

output = await evaluateInput(":pkir", timingState);
assert.equal(output[0], "engine set to pkir");
assert.equal(timingState.engine, "pkir");

output = await evaluateInput(":js", timingState);
assert.equal(output[0], "engine set to js");
assert.equal(timingState.engine, "js");

// Verify :reset preserves the active engine
output = await evaluateInput(":reset", timingState);
assert.equal(output[0], "reset");
assert.equal(timingState.engine, "js");

// Verify invalid engine error
await assert.rejects(
  () => evaluateInput(":engine invalid", timingState),
  /Invalid engine 'invalid'\. Valid engines: wasm, pkir, js/
);

// Verify autocompletion for :engine
completions = completeInput(":engine ", timingState)[0];
assert(completions.includes(":engine wasm"));
assert(completions.includes(":engine pkir"));
assert(completions.includes(":engine js"));

// Verify evaluating expressions in JS engine
const jsState = createState({ engine: "js" });
assert.equal(jsState.engine, "js");

output = await evaluateInput("succ = | succ;\n{} | zero succ succ", jsState);
assert.match(output[0], /^\{\}\|zero\|succ\|succ/);
assert.match(output[1], /\(js\)/);

output = await evaluateInput("not = </true | false, /false | true >;\n{} | true not", jsState);
assert.match(output[0], /^\{\}\|false/);
assert.match(output[1], /\(js\)/);

output = await evaluateInput(":load Examples/arithmetics.k", jsState);
assert.equal(output[0], "loaded Examples/arithmetics.k");
output = await evaluateInput("{ 10 int x, 5 int y } plus", jsState);
assert.match(output[0], /^\{\}\|_\|1\|1\|1\|1\|\+/);
assert.match(output[1], /\(js\)/);

// Verify evaluating expressions in PKIR-powered Wasm engine
const pkirState = createState({ engine: "pkir" });
assert.equal(pkirState.engine, "pkir");

output = await evaluateInput(
  "succ = | succ;\n{} | zero succ succ",
  pkirState
);
assert.match(output[0], /^\{\}\|zero\|succ\|succ/);
assert.match(output[1], /\(pkir\)/);

output = await evaluateInput(
  "not = </true | false, /false | true >;\n{} | true not",
  pkirState
);
assert.match(output[0], /^\{\}\|false/);
assert.match(output[1], /\(pkir\)/);

output = await evaluateInput(":load Examples/arithmetics.k", pkirState);
assert.equal(output[0], "loaded Examples/arithmetics.k");
output = await evaluateInput("{ 10 int x, 5 int y } plus", pkirState);
assert.match(output[0], /^\{\}\|_\|1\|1\|1\|1\|\+/);
assert.match(output[1], /\(pkir\)/);

// Verify open product projection in wasm engine
const wasmListState = createState({ engine: "wasm" });
await evaluateInput(":load Examples/arithmetics.k", wasmListState);
await evaluateInput(":codec load codecs/int.mjs", wasmListState);
await evaluateInput("len = {()list,0 int len} len_; len_ = ?X <{.list/nil if, .len then} .then, {.list/cons.cdr list, .len inc len} ?X len_ >;", wasmListState);
await evaluateInput(":input int.mjs [3,3,3]", wasmListState);
output = await evaluateInput("len", wasmListState);
assert.match(output[0], /int\.mjs:\s*3/);
assert.match(output[1], /\(wasm\)/);

// Verify :limit command and bounded printing
const limitState = createState({ engine: "wasm" });
output = await evaluateInput(":limit", limitState);
assert.equal(output[0], "Current output limit: none");

output = await evaluateInput(":limit 40", limitState);
assert.equal(output[0], "output limit set to 40");

output = await evaluateInput(":limit", limitState);
assert.equal(output[0], "Current output limit: 40");

output = await evaluateInput(":load Examples/arithmetics.k", limitState);
output = await evaluateInput("{ 10 int x, 5 int y } plus", limitState);
assert(output[0].includes("..."));
assert(output[0].length <= 80);

output = await evaluateInput(":limit none", limitState);
assert.equal(output[0], "output limit disabled");
output = await evaluateInput(":limit", limitState);
assert.equal(output[0], "Current output limit: none");

// Verify Examples/djson.k (json?, get, nth, set, del)
const djsonKState = createState({ engine: "wasm" });
output = await evaluateInput(":load Examples/djson.k", djsonKState);
assert.equal(output[0], "loaded Examples/djson.k");
await evaluateInput(":codec load codecs/djson.mjs", djsonKState);
await evaluateInput(
  ':input djson.mjs ["age", {"name":"Alice","age":30}]',
  djsonKState
);
output = await evaluateInput(
  "{{0 index, () json} nth /string key, " +
    "{1 index, () json} nth json} get",
  djsonKState
);
assert.match(output[0], /djson\.mjs: 30/);

await evaluateInput(
  ':input djson.mjs ["age", {"name":"Alice","age":30}]',
  djsonKState
);
output = await evaluateInput(
  "{{0 index, () json} nth /string key, " +
    "{1 index, () json} nth json} del",
  djsonKState
);
assert.match(output[0], /djson\.mjs: \{"name":"Alice"\}/);

// Verify named pattern persistence, listing, display, and tab completion
const patState = createState({ engine: "wasm" });

output = await evaluateInput(":patterns", patState);
assert.equal(output[0], "(none)");
output = await evaluateInput(":pats", patState);
assert.equal(output[0], "(none)");

output = await evaluateInput("bit[] = < {} 0, {} 1 >;", patState);
assert.match(output[0], /\/\* comp:/);

output = await evaluateInput(":patterns", patState);
assert.equal(
  output[0],
  "bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[]"
);
output = await evaluateInput(":pats", patState);
assert.equal(
  output[0],
  "bit[] = @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[]"
);

output = await evaluateInput(":pattern bit", patState);
assert.equal(
  output[0],
  "bit[] = <{}=X0 0, X0 1>;  -- " +
    "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg"
);
output = await evaluateInput(":pattern bit[]", patState);
assert.equal(
  output[0],
  "bit[] = <{}=X0 0, X0 1>;  -- " +
    "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg"
);
output = await evaluateInput(":pat bit", patState);
assert.equal(
  output[0],
  "bit[] = <{}=X0 0, X0 1>;  -- " +
    "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg"
);
output = await evaluateInput(
  ":pattern @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg",
  patState
);
assert.equal(
  output[0],
  "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg[] = <{}=X0 0, X0 1>;"
);

output = await evaluateInput(
  "byte[] = { " +
    "bit[] b0, bit[] b1, bit[] b2, bit[] b3, " +
    "bit[] b4, bit[] b5, bit[] b6, bit[] b7 " +
  "};",
  patState
);
output = await evaluateInput(":pattern byte", patState);
assert.equal(
  output[0],
  "byte[] = {<{}=X1 0, X1 1>=X0 b0, X0 b1, X0 b2, X0 b3, " +
    "X0 b4, X0 b5, X0 b6, X0 b7};  -- " +
    "@4ukq2gpiEBFa7WXxcfRm8pfdr2kgYLTTnwsmLHeMd9i5"
);

await assert.rejects(
  () => evaluateInput(":pattern unknown", patState),
  /Unknown pattern 'unknown'/
);
await assert.rejects(
  () => evaluateInput(":pattern", patState),
  /:pattern requires a pattern name/
);

completions = completeInput(":pat", patState)[0];
assert(completions.includes(":pattern"));
assert(completions.includes(":patterns"));
assert(completions.includes(":pat"));
assert(completions.includes(":pats"));

completions = completeInput(":pattern b", patState)[0];
assert(completions.includes(":pattern bit"));
completions = completeInput(":pat b", patState)[0];
assert(completions.includes(":pat bit"));
completions = completeInput(":pattern @Mjusy", patState)[0];
assert(
  completions.includes(
    ":pattern @MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg"
  )
);

output = await evaluateInput("{} | 0 ? bit[]", patState);
assert.match(output[0], /\{\}\|0/);

output = await evaluateInput(
  "pair[A, B] = { A first, B second };",
  patState
);
output = await evaluateInput(":pattern pair", patState);
assert.equal(
  output[0],
  "pair[X0, X1] = {X0 first, X1 second};  -- " +
    "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm"
);

output = await evaluateInput(":load Examples/list.k", patState);
assert.equal(output[0], "loaded Examples/list.k");
output = await evaluateInput(":patterns", patState);
assert(output[0].includes("bit[] = @Mjusy"));
assert(output[0].includes("list[X] = @JagVex"));
assert(output[0].includes("pair[A,B] = @KqTB"));

output = await evaluateInput(":pattern list", patState);
assert.equal(
  output[0],
  "list[X1] = <{X1 car, X0 cdr} cons, {} nil>=X0;  -- " +
    "@JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe"
);

output = await evaluateInput("{} | nil ? list[bit[]]", patState);
assert.match(output[0], /\{\}\|nil/);

const testKlibPath = path.join(tmpDir, "patterns-test.klib");
output = await evaluateInput(`:klib ${testKlibPath}`, patState);
assert.equal(output[0], `saved ${testKlibPath}`);

const freshState = createState({ engine: "wasm" });
output = await evaluateInput(`:load ${testKlibPath}`, freshState);
assert.equal(output[0], `loaded ${testKlibPath}`);
output = await evaluateInput(":patterns", freshState);
assert(output[0].includes("bit[] = @Mjusy"));
assert(output[0].includes("pair[A,B] = @KqTB"));
assert(output[0].includes("list[X] = @JagVex"));

output = await evaluateInput(":pattern bit", freshState);
assert.equal(
  output[0],
  "bit[] = <{}=X0 0, X0 1>;  -- " +
    "@MjusyRWZnVj8TR4BhFCCcMRrQbdKp9gPtC29LT9nZvjg"
);
output = await evaluateInput(":pattern pair", freshState);
assert.equal(
  output[0],
  "pair[X0, X1] = {X0 first, X1 second};  -- " +
    "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm"
);
output = await evaluateInput(":pattern list", freshState);
assert.equal(
  output[0],
  "list[X1] = <{X1 car, X0 cdr} cons, {} nil>=X0;  -- " +
    "@JagVexzgseRr4rVZRmVpsMbr2AKXDjzZnz6Qnf8a9SNe"
);
output = await evaluateInput(
  "same_pair[T] = { T first, T second };",
  freshState
);
output = await evaluateInput(":pattern same_pair", freshState);
assert.equal(
  output[0],
  "same_pair[X0] = {X0 first, X1 second};  -- " +
    "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm"
);
output = await evaluateInput("{} | nil ? list[bit[]]", freshState);
assert.match(output[0], /\{\}\|nil/);

output = await evaluateInput("a[] = x;", freshState);
output = await evaluateInput(":pattern a", freshState);
assert.equal(
  output[0],
  "a[] = X0;  -- " +
    "@QfyLpmn56wuppuGvrrUJz8LKtgaXfbMtad7RnzBcFk2S"
);
output = await evaluateInput(
  "closed_same_pair[] = { T first, T second };",
  freshState
);
output = await evaluateInput(":pattern closed_same_pair", freshState);
assert.equal(
  output[0],
  "closed_same_pair[] = {X0 first, X1 second};  -- " +
    "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm"
);

output = await evaluateInput(
  "a[]= {X x, Y y};b[X] = {X x, Y y};" +
    "c[X,Y] = {X x, Y y};d[Y,X] = {X x, Y y};",
  freshState
);
output = await evaluateInput(":pat a", freshState);
assert.equal(
  output[0],
  "a[] = {X0 x, X1 y};  -- " +
    "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x"
);
output = await evaluateInput(":pat b", freshState);
assert.equal(
  output[0],
  "b[X0] = {X0 x, X1 y};  -- " +
    "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x"
);
output = await evaluateInput(":pat c", freshState);
assert.equal(
  output[0],
  "c[X0, X1] = {X0 x, X1 y};  -- " +
    "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x"
);
output = await evaluateInput(":pat d", freshState);
assert.equal(
  output[0],
  "d[X1, X0] = {X0 x, X1 y};  -- " +
    "@NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x"
);
output = await evaluateInput(":pats", freshState);
assert(
  output[0].includes(
    "a[] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[(...),(...)]"
  )
);
assert(
  output[0].includes(
    "b[X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,(...)]"
  )
);
assert(
  output[0].includes(
    "c[X,Y] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,Y]"
  )
);
assert(
  output[0].includes(
    "d[Y,X] = @NPSHm9HbPgXmGHVGMJGJFq7rq4LiFiavPX27mUwyE26x[X,Y]"
  )
);
assert(
  output[0].includes(
    "same_pair[T] = @KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[T,T]"
  )
);
assert(
  output[0].includes(
    "closed_same_pair[] = " +
      "@KqTBNkznjWWwync2Mm94XjCez63neJBJtgYcJJEE5kEm[T,T]"
  )
);

await assert.rejects(
  () =>
    evaluateInput(
      "list[X,Y] = <{}nil,{X car, Y cdr} cons> = Y;",
      freshState
    ),
  /conflicts with knot 'Y'/
);

await evaluateInput("p[X]= {X x, Y y, Y z};", freshState);
output = await evaluateInput(":pats", freshState);
assert(
  output[0].includes(
    "p[X] = @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X,Y,Y]"
  )
);

output = await evaluateInput(":pat p", freshState);
assert.equal(
  output[0],
  "p[X0] = {X0 x, X1 y, X2 z};  -- " +
    "@PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR"
);

output = await evaluateInput(
  ":pat @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR",
  freshState
);
assert.equal(
  output[0],
  "@PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X0, X1, X2] = " +
    "{X0 x, X1 y, X2 z};"
);

output = await evaluateInput(
  "{{} x, {} y, {} z} ? " +
    "@PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[{}, {}, {}]",
  freshState
);
assert.match(output[0], /\{\{\} x, \{\} y, \{\} z\}/);

output = await evaluateInput(
  "{{} x, {} y, {} z} ? p[{}]",
  freshState
);
assert.match(output[0], /\{\{\} x, \{\} y, \{\} z\}/);

const testKlibPath2 = path.join(tmpDir, "patterns-test2.klib");
await evaluateInput(`:klib ${testKlibPath2}`, freshState);
const freshState2 = createState({ engine: "wasm" });
await evaluateInput(`:load ${testKlibPath2}`, freshState2);
const pHash = freshState2.patternAliases.p;
assert.equal(pHash, "@PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR");
const pOrigins = freshState2.meta[pHash]?.origins?.filter(
  (o) => o.name === "p"
);
assert.equal(pOrigins?.length, 1);
assert.deepEqual(pOrigins[0].params, ["X"]);
assert.deepEqual(pOrigins[0].aliasArgs, ["X", "Y", "Y"]);
output = await evaluateInput(":pats", freshState2);
assert(
  output[0].includes(
    "p[X] = @PScsPA3xYv4kSXUqHafwVQr5Cxkmspf3bj46KAcmyxmR[X,Y,Y]"
  )
);

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(symlinkPath, { force: true });
console.log("OK");
