#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, stdout } from "node:process";
import { decode, decodeDebug, NODE_KIND } from "./codecs/runtime/codec.mjs";

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)))));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  let debug = false;
  let fileArg = null;

  for (const arg of args) {
    if (arg === "--debug") {
      debug = true;
    } else if (fileArg == null) {
      fileArg = arg;
    } else {
      throw new Error("Usage: k-decode [--debug] [file]");
    }
  }

  const input = fileArg ? fs.createReadStream(fileArg) : stdin;
  const buffer = await readAll(input);

  if (debug) {
    const { pattern, valueDag } = decodeDebug(buffer);
    const kindName = (kind) => {
      switch (kind) {
        case NODE_KIND.ANY: return "(...)";
        case NODE_KIND.OPEN_PRODUCT: return "{...}";
        case NODE_KIND.OPEN_UNION: return "<...>";
        case NODE_KIND.CLOSED_PRODUCT: return "{}";
        case NODE_KIND.CLOSED_UNION: return "<>";
        default: return `unknown(${kind})`;
      }
    };

    const debugJson = {
      pattern: {
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
      },
      value_dag: valueDag
    };
    stdout.write(`${JSON.stringify(debugJson)}\n`);
    return;
  }

  const { value } = decode(buffer);
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
