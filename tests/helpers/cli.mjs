import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, print } from "../../codecs/int.mjs";
import { encodeToWire, decodeWire } from "../../codecs/runtime/prefix-codec.mjs";
import { parseHeaderUses } from "../../canonical-pattern.mjs";

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
  const sources = Array.isArray(source) ? source : [source];
  let library = null;
  try {
    for (let i = 0; i < sources.length; i++) {
      const nextLibrary = path.join(dir, `library-${i}.klib`);
      const args = ["objects/compile.mjs"];
      if (library) args.push("--lib", library);
      const filePath = path.isAbsolute(sources[i]) ? sources[i] : path.join(root, sources[i]);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        for (const u of parseHeaderUses(raw)) {
          args.push("--use", u.use);
        }
      }
      args.push(sources[i], nextLibrary);
      succeeds(node(args), `compile ${sources[i]}`);
      library = nextLibrary;
    }
    test(library);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runLibrary(library, aliases, source, input = "0") {
  return node(["k.mjs", "--lib", library,
    ...aliases.flatMap((alias) => ["--use", alias]), source],
  encodeToWire(parse(input)));
}

export function integer(result, label) {
  return print(decodeWire(succeeds(result, label)).value);
}
