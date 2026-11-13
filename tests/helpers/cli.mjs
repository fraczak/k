import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, print } from "../../codecs/int.mjs";
import { encodeToWire, decodeWire } from "../../codecs/runtime/prefix-codec.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

const LIBRARY_USE_SPECS = new Map([
  ["core.k", []],
  ["lib/integer.k", []],
  ["lib/generic.k", [
    "bit[] bits[] list[X] byte[] ascii[] bmp_hi_common[] bmp_hi_private_use[] plane0[] plane_02_10[] unicode[] string[]"
  ]],
  ["lib/ieee.k", ["bit[] bits[]"]],
  ["lib/djson.k", [
    "bit[] bits[] list[] byte[] ascii[] bmp_hi_common[] bmp_hi_private_use[] plane0[] plane_02_10[] unicode[] string[]",
    "bool[] false? true? order[] lt? eq? gt? opt[] reverse trim_bits inc_bits btrie[] btrie_empty btrie_get btrie_set btrie_del btrie_entries_raw btrie_max_key btrie_bfs_values string_to_bits bits_to_string",
    "sign[] float64[] pos_zero neg_zero finite_float64? ratio_to_float64"
  ]],
  ["Examples/poly.k", ["int[] nat int pos? neg? zero? gt? inc dec"]],
  ["Examples/ieee-arithmetics.k", [
    "bit[] sign[] exp11[] frac52[] float64[] all_ones_exponent? exp0 finite_float64? frac0 inf_float64? nan_float64? neg_inf neg_zero negate_float64 pos_inf pos_zero qnan zero_exponent? zero_float64?"
  ]]
]);

export function useSpecsFor(sourcePath) {
  const normalized = String(sourcePath).replace(/\\/g, "/");
  for (const [key, specs] of LIBRARY_USE_SPECS) {
    if (normalized === key || normalized.endsWith(`/${key}`)) {
      return specs;
    }
  }
  return [];
}

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
      for (const u of useSpecsFor(sources[i])) {
        args.push("--use", u);
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
