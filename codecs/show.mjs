#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout, stderr } from "node:process";
import { Product, Variant } from "../Value.mjs";
import { decodeWire } from "./runtime/prefix-codec.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// --- pattern property list to filter (k syntax) ---

const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;
function pLabel(label) {
  return nameRE.test(label) ? ` ${label}` : ` ${JSON.stringify(label)}`;
}

function propertyListToFilter(propertyList) {
  // count how many times each node is targeted
  const refCount = new Array(propertyList.length).fill(0);
  for (const [, edges] of propertyList) {
    for (const [, target] of edges) refCount[target]++;
  }
  refCount[0]++;

  // assign variable names to multiply-referenced nodes
  const varNames = new Map();
  let varCounter = 0;
  for (let i = 0; i < propertyList.length; i++) {
    if (refCount[i] > 1) varNames.set(i, `X${varCounter++}`);
  }

  const defined = new Set();

  function fmt(nodeId) {
    // if already defined, just return the variable name
    if (varNames.has(nodeId) && defined.has(nodeId)) return varNames.get(nodeId);

    const [kind, edges] = propertyList[nodeId];
    const hasVar = varNames.has(nodeId);
    if (hasVar) defined.add(nodeId);

    const suffix = hasVar ? `=${varNames.get(nodeId)}` : "";

    if (kind === "any") return hasVar ? varNames.get(nodeId) : "(...)";

    const isOpen = kind.startsWith("open-");
    const isProduct = kind.endsWith("product");
    const open = isProduct ? "{" : "<";
    const close = isProduct ? "}" : ">";

    if (edges.length === 0 && !isOpen) return `${open}${close}${suffix}`;

    const fields = edges.map(([label, target]) => `${fmt(target)}${pLabel(label)}`);
    if (isOpen) fields.push("...");
    return `${open}${fields.join(", ")}${close}${suffix}`;
  }

  return fmt(0);
}

// --- value to native k syntax ---

function valueToK(v) {
  if (v instanceof Variant) return `${valueToK(v.value)}|${pLabel(v.tag).trimStart()}`;
  if (v instanceof Product) {
    const keys = Object.keys(v.product);
    if (keys.length === 0) return "{}";
    const fields = keys.map((k) => `${valueToK(v.product[k])}${pLabel(k)}`);
    return `{${fields.join(", ")}}`;
  }
  return String(v);
}

async function main() {
  const args = argv.slice(2);
  let fileArg = null;
  for (const arg of args) {
    if (fileArg == null) fileArg = arg;
    else { console.error("Usage: show.mjs [wire-file]"); process.exit(1); }
  }

  const buffer = fileArg ? fs.readFileSync(fileArg) : await readAll(stdin);

  // forward unchanged to stdout
  stdout.write(buffer);

  // decode and print: value filter
  const { pattern, value } = decodeWire(buffer);

  const valueStr = valueToK(value);
  const filterStr = propertyListToFilter(pattern);
  stderr.write(`${valueStr} ?${filterStr}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
