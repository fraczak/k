import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  aliasNames,
  analyzeAcceptedSnippet,
  analyzeRawSnippet,
  completeInput,
  createState,
  evaluateInput,
  explicitSnippetTerminated,
  isMainEntrypoint,
  lineHasExplicitContinuation,
  lineTerminatesSnippet
} from "./repl.mjs";
import { decodeObject, objectToFunction } from "./object.mjs";
import { Product } from "./Value.mjs";

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
const koPath = path.join(tmpDir, "succ.ko");
const sourcePath = path.join(tmpDir, "session.k");
const symlinkPath = path.resolve(".test-k-repl-link");
output = await evaluateInput(`:klib ${libPath}`, state);
assert.equal(output[0], `saved ${libPath}`);

completions = completeInput(`:load ${tmpDir}/ses`, state)[0];
assert(completions.includes(`:load ${libPath}`));
completions = completeInput(`:load --no-alias ${tmpDir}/ses`, state)[0];
assert(completions.includes(`:load --no-alias ${libPath}`));

output = await evaluateInput(`:ko ${koPath} succ`, state);
assert.equal(output[0], `saved ${koPath} (succ)`);
const objectFn = objectToFunction(decodeObject(fs.readFileSync(koPath)));
const objectResult = objectFn(new Product({}, [["closed-product", []]]));
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

const replPath = fileURLToPath(new URL("./repl.mjs", import.meta.url));
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
