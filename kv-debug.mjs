#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout } from "node:process";
import { decodeDebug, NODE_KIND } from "./codecs/runtime/codec.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)))));
    stream.on("error", reject);
  });
}

function kindName(kind) {
  switch (kind) {
    case NODE_KIND.ANY: return "(...)";
    case NODE_KIND.OPEN_PRODUCT: return "{...}";
    case NODE_KIND.OPEN_UNION: return "<...>";
    case NODE_KIND.CLOSED_PRODUCT: return "{}";
    case NODE_KIND.CLOSED_UNION: return "<>";
    default: return `unknown(${kind})`;
  }
}

function patternToDebugJson(pattern) {
  return {
    root: 0,
    dictionary: pattern.dictionary,
    nodes: pattern.nodes.map((node, id) => ({
      id,
      kind: kindName(node.kind),
      edges: node.edges.map((edge) => ({
        symbol_id: edge.symbolId,
        target: edge.target
      }))
    }))
  };
}

async function main() {
  const fileArg = argv[2];
  const input = fileArg ? fs.createReadStream(fileArg) : stdin;
  const buffer = await readAll(input);
  const { pattern, valueDag } = decodeDebug(buffer);

  stdout.write(`${JSON.stringify({
    pattern: patternToDebugJson(pattern),
    value_dag: valueDag
  })}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
