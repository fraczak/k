#!/usr/bin/env node

import assert from "node:assert/strict";
import { annotate } from "./index.mjs";

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, max) {
  return Math.floor(rng() * max);
}

function permute(rng, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function renameScript(script, mapping) {
  let out = script;
  const temps = {};
  let i = 0;
  for (const from of Object.keys(mapping)) {
    temps[from] = `__TMP_${i++}__`;
  }
  for (const [from, tmp] of Object.entries(temps)) {
    const re = new RegExp(`\\b${from}\\b`, "g");
    out = out.replace(re, tmp);
  }
  for (const [from, to] of Object.entries(mapping)) {
    const re = new RegExp(`\\b${temps[from]}\\b`, "g");
    out = out.replace(re, to);
  }
  return out;
}

function getRelHash(script, name) {
  const { relAlias } = annotate(script);
  assert.ok(relAlias[name], `missing relAlias for ${name}`);
  return relAlias[name];
}

function generateScript(rng, count) {
  const names = Array.from({ length: count }, (_, i) => `f${i}`);
  const defs = names.map((name) => {
    const roll = randInt(rng, 2);
    const refs = names;
    if (roll === 0) {
      return `${name} = ();`;
    }
    const ref1 = refs[randInt(rng, refs.length)];
    const ref2 = refs[randInt(rng, refs.length)];
    return `${name} = ${ref1} ${ref2};`;
  });
  const main = names[0];
  return `${defs.join("\n")}\n${main}\n`;
}

function buildRenameMap(names, rng) {
  const perm = permute(rng, names);
  const map = {};
  names.forEach((name, i) => {
    map[name] = perm[i];
  });
  return map;
}

const rng = mulberry32(0xdeadbeef);
const iterations = 30;

for (let i = 0; i < iterations; i++) {
  const count = 3 + randInt(rng, 4);
  const script = generateScript(rng, count);
  const names = Array.from({ length: count }, (_, j) => `f${j}`);

  const baseHash = getRelHash(script, "f0");

  const renameMap = buildRenameMap(names, rng);
  const renamedScript = renameScript(script, renameMap);
  const renamedMain = renameMap.f0;
  const renamedHash = getRelHash(renamedScript, renamedMain);
  assert.equal(baseHash, renamedHash, "renaming should not change hash");

  const lines = script.trim().split("\n");
  const defs = lines.slice(0, -1);
  const main = lines[lines.length - 1];
  const reordered = `${permute(rng, defs).join("\n")}\n${main}\n`;
  const reorderedHash = getRelHash(reordered, "f0");
  if (baseHash !== reorderedHash) {
    console.error("Reorder mismatch:");
    console.error("ORIGINAL:\n" + script);
    console.error("REORDERED:\n" + reordered);
  }
  assert.equal(baseHash, reorderedHash, "reordering defs should not change hash");
}

console.log("test-hash-fuzz: ok");
