import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, print } from "../../codecs/int.mjs";
import { encodeToWire, decodeWire } from "../../codecs/runtime/prefix-codec.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function node(args, input) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, input, maxBuffer: 64 * 1024 * 1024
  });
  assert.ifError(result.error);
  return result;
}

export function succeeds(result, label) {
  assert.equal(result.status, 0,
    `${label} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

export function withCompiledLibrary(source, test) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k-library-test-"));
  const library = path.join(dir, "library.klib");
  try {
    succeeds(node(["objects/compile.mjs", source, library]), `compile ${source}`);
    test(library);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runLibrary(library, aliases, source, input = "0") {
  return node(["k.mjs", "--lib", library,
    ...aliases.flatMap((alias) => ["--export", alias]), source],
  encodeToWire(parse(input)));
}

export function integer(result, label) {
  return print(decodeWire(succeeds(result, label)).value);
}
