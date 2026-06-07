import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-arithmetics-"));
const libPath = path.join(tmpDir, "arithmetics.klib");
const program = "{inc x, () y} o";

const smallInput = "11111112222223333334444444555555666666777777788888899999900000011111122222233333344444455555";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    input: options.input,
    encoding: options.encoding ?? null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error && result.status == null) throw result.error;
  return result;
}

function assertOk(result, label) {
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr ?? "");
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : String(result.stdout ?? "");
    assert.fail(`${label} failed with status ${result.status}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);
  }
}

function parseIntWire(text) {
  const result = run(node, ["codecs/int.mjs", "--parse"], {
    input: `${text}\n`
  });
  assertOk(result, `parse int ${text}`);
  return result.stdout;
}

function printIntWire(wire, label) {
  const result = run(node, ["codecs/int.mjs", "--print"], {
    input: wire,
    encoding: "utf8"
  });
  assertOk(result, `${label} print`);
  return result.stdout.trim();
}

function runnerArgs(operation) {
  return [
    "--lib", libPath,
    "--export", `${operation}:o`,
    "--export", "inc",
    program
  ];
}

function runNative(operation, inputText) {
  const wire = parseIntWire(inputText);
  const result = run(node, ["k.mjs", ...runnerArgs(operation)], {
    input: wire
  });
  assertOk(result, `native ${operation}(${inputText})`);
  return printIntWire(result.stdout, `native ${operation}`);
}

function expected(operation, inputText) {
  const n = BigInt(inputText);
  if (operation === "plus") return (n + n + 1n).toString();
  if (operation === "minus") return "1";
  if (operation === "times") return (n * (n + 1n)).toString();
  throw new Error(`Unknown operation: ${operation}`);
}

try {
  assertOk(
    run(node, ["objects/compile.mjs", "Examples/arithmetics.k", libPath], { encoding: "utf8" }),
    "compile Examples/arithmetics.k"
  );

  for (const operation of ["plus", "minus", "times"]) {
    assert.equal(
      runNative(operation, smallInput),
      expected(operation, smallInput),
      `native ${operation} should match BigInt oracle`
    );
  }

  console.log("OK");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
