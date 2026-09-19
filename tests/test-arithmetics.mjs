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

  // Regression tests for inc/dec normalization and div
  const resDec = run(node, [
    "k.mjs",
    "--lib", libPath,
    "--export", "dec:dec",
    "--export", "zero_int?:zero_int?",
    "dec dec zero_int?"
  ], { input: parseIntWire("2") });
  assertOk(resDec, "2 int dec dec zero_int? should succeed");

  const divTestCases = [
    { x: "4", yAlias: "1", yVal: 1n },
    { x: "10", yAlias: "2", yVal: 2n },
    { x: "12", yAlias: "3", yVal: 3n },
    { x: "11", yAlias: "3", yVal: 3n },
    { x: "100", yAlias: "7", yVal: 7n },
    { x: "-100", yAlias: "7", yVal: 7n },
    { x: "1000", yAlias: "10", yVal: 10n }
  ];

  for (const { x, yAlias, yVal } of divTestCases) {
    const xBig = BigInt(x);
    const expectedDiv = (xBig / yVal).toString();
    const xAbs = xBig < 0n ? -xBig : xBig;
    const yAbs = yVal < 0n ? -yVal : yVal;
    const expectedRem = (xAbs % yAbs).toString();

    const wire = parseIntWire(x);

    const resDiv = run(node, [
      "k.mjs",
      "--lib", libPath,
      "--export", "div:div",
      "--export", "int:int",
      "--export", `${yAlias}:divisor`,
      "{() x, divisor int y} div .div"
    ], { input: wire });
    assertOk(resDiv, `native div(${x}, ${yAlias}) quotient`);
    const divOut = printIntWire(resDiv.stdout, `div quotient`);
    assert.equal(divOut, expectedDiv, `div(${x}, ${yAlias}) quotient should match BigInt oracle`);

    const resRem = run(node, [
      "k.mjs",
      "--lib", libPath,
      "--export", "div:div",
      "--export", "int:int",
      "--export", `${yAlias}:divisor`,
      "{() x, divisor int y} div .rem int"
    ], { input: wire });
    assertOk(resRem, `native div(${x}, ${yAlias}) remainder`);
    const remOut = printIntWire(resRem.stdout, `div remainder`);
    assert.equal(remOut, expectedRem, `div(${x}, ${yAlias}) remainder should match BigInt oracle`);
  }

  console.log("OK");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
