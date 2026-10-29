import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const packageDir = path.resolve(process.argv[2] || ".");
const expected = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json")));
assert.equal(manifest.name, expected.name);
assert.equal(manifest.version, expected.version);
for (const file of ["parser.mjs", "valueParser.mjs", "core.k", "LICENSE",
  "backends/wasm/runtime.wat", "backends/llvm/runtime/krt.c"]) {
  assert.ok(fs.existsSync(path.join(packageDir, file)), file);
}
assert.ok(!fs.existsSync(path.join(packageDir, "browser/vfs-data.mjs")),
  "Generated VFS data must not be packed");
for (const file of ["AGENTS.md", "CLAUDE.md"]) {
  assert.ok(!fs.existsSync(path.join(packageDir, file)), file);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "k-package-smoke-"));
function run(name, args = [], input) {
  const bin = manifest.bin[name];
  assert.ok(bin, name);
  const result = spawnSync(process.execPath, [path.join(packageDir, bin), ...args], {
    cwd: scratch, input, maxBuffer: 8 * 1024 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  return result.stdout;
}

try {
  for (const name of Object.keys(manifest.bin)) {
    assert.ok(run(name, ["--help"]).length > 0, `${name} help`);
  }

  const { default: k } = await import(pathToFileURL(path.join(packageDir, "index.mjs")));
  assert.equal(k.compile("{} |ok")(k.fromObject({})).tag, "ok");

  const unit = run("k-unit", ["--parse"]);
  const hello = run("k", ["{} |ok"], unit);
  assert.equal(run("k-print", [], hello).toString().trim(), '"ok"');

  const integer = run("k-int", ["--parse"], "42\n");
  const incremented = run("k", ["--lib", path.join(packageDir, "Examples/arithmetics.k"),
    "--export", "inc", "inc"], integer);
  assert.equal(run("k-int", ["--print"], incremented).toString().trim(), "43");

  const object = path.join(scratch, "ok.ko");
  run("k-compile", ["?{} {} |ok", object]);
  assert.match(run("k-validate-object", [object]).toString(), /OK object/);
  assert.equal(run("k-print", [], run("k", [object], unit)).toString().trim(), '"ok"');

  const wasm = path.join(scratch, "ok.wasm");
  run("k-wasm-compile", ["?{} {} |ok", wasm]);
  assert.equal(run("k-print", [], run("k-wasm-run", [wasm], unit)).toString().trim(), '"ok"');

  console.log(`Package ${manifest.name}@${manifest.version}: API, ${Object.keys(manifest.bin).length} CLIs, codecs, objects and Wasm passed on ${process.version}`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
