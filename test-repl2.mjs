import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completeInput, createState, evaluateInput } from "./repl2.mjs";
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-repl2-"));
const libPath = path.join(tmpDir, "session.klib");
const koPath = path.join(tmpDir, "succ.ko");
const sourcePath = path.join(tmpDir, "session.k");
output = await evaluateInput(`:save ${libPath}`, state);
assert.equal(output[0], `saved ${libPath}`);

completions = completeInput(`:load ${tmpDir}/ses`, state)[0];
assert(completions.includes(`:load ${libPath}`));

output = await evaluateInput(`:ko ${koPath} succ`, state);
assert.equal(output[0], `saved ${koPath} (succ)`);
const objectFn = objectToFunction(decodeObject(fs.readFileSync(koPath)));
const objectResult = objectFn(new Product({}, [["closed-product", []]]));
assert.equal(objectResult.toJSON(), "succ");

fs.writeFileSync(sourcePath, "$ nat = <{} zero, nat succ>;\nsucc = |succ;\n");
const loadedSource = createState();
output = await evaluateInput(`:load ${sourcePath}`, loadedSource);
assert.equal(output[0], `loaded ${sourcePath}`);
output = await evaluateInput(":codes", loadedSource);
assert.match(output[0], /^nat = @/m);
output = await evaluateInput(":rels", loadedSource);
assert.match(output[0], /^succ = @/m);

const reloaded = createState();
output = await evaluateInput(`:load ${libPath}`, reloaded);
assert.equal(output[0], `loaded ${libPath}`);

output = await evaluateInput(":codes", reloaded);
assert.match(output[0], /^nat = @/m);

output = await evaluateInput(":rels", reloaded);
assert.match(output[0], /^succ = @/m);

output = await evaluateInput("succ", reloaded);
assert.equal(output[0], "{}|succ ?<{} succ, ...>");

const shorthand = createState();
output = await evaluateInput("$ nat = <{} zero, nat succ>;", shorthand);
assert.match(output[0], /^\$ nat = @/);
output = await evaluateInput("succ = |succ;", shorthand);
assert.match(output[0], /^succ = @/);
output = await evaluateInput("succ", shorthand);
assert.equal(output[0], "{}|succ ?<{} succ, ...>");

await assert.rejects(
  () => evaluateInput("/type", createState()),
  /Type Error|Unknown ref: 'type'|Parse error|Parse Error/
);

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("OK");
