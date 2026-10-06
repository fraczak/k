import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const node = process.execPath;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-karatsuba-"));
const libPath = path.join(tmpDir, "karatsuba-mult.klib");
const kSource = path.join(root, "Examples/karatsuba-mult.k");
const program = "{() x, () y} karatsuba";

const smallInput =
  "111111122222233333344444445555556666667777777888888999999000000" +
  "11111122222233333344444455555";

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
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr ?? "");
    const stdout = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString("utf8")
      : String(result.stdout ?? "");
    assert.fail(
      `${label} failed (status ${result.status})\n` +
      `STDERR:\n${stderr}\nSTDOUT:\n${stdout}`
    );
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

function runKaratsuba(inputText) {
  const wire = parseIntWire(inputText);
  const result = run(node, [
    "k.mjs",
    "--lib", libPath,
    "--export", "karatsuba:karatsuba",
    program
  ], { input: wire });
  assertOk(result, `native karatsuba(${inputText})`);
  return printIntWire(result.stdout, `native karatsuba`);
}

function expectedSquare(inputText) {
  const n = BigInt(inputText);
  return (n * n).toString();
}

try {
  assertOk(
    run(node, ["objects/compile.mjs", kSource, libPath], {
      encoding: "utf8"
    }),
    "compile Examples/karatsuba-mult.k"
  );

  const testInputs = [
    "0",
    "1",
    "-1",
    "7",
    "-7",
    "42",
    "-42",
    "123456789",
    "-123456789",
    "987654321987654321",
    "-987654321987654321",
    smallInput,
    `-${smallInput}`
  ];

  for (const input of testInputs) {
    assert.equal(
      runKaratsuba(input),
      expectedSquare(input),
      `karatsuba square(${input.slice(0, 20)}...) mismatch`
    );
  }

  // Test asymmetric pair multiplication with mixed signs via int list
  const pairWire = parseIntWire(
    "[12345678901234567890, -98765432109876543210]"
  );
  const pairProgram = "/cons { .car x, .cdr /cons .car y } karatsuba";
  const resPair = run(node, [
    "k.mjs",
    "--lib", libPath,
    "--export", "karatsuba:karatsuba",
    pairProgram
  ], { input: pairWire });
  assertOk(resPair, "pair multiplication");
  assert.equal(
    printIntWire(resPair.stdout, "pair multiplication"),
    (12345678901234567890n * -98765432109876543210n).toString(),
    "asymmetric pair multiplication should match BigInt oracle"
  );

  console.log("OK");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
