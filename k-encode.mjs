#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import { parse as parseScript } from "./parser.mjs";
import { parseValue } from "./valueIO.mjs";
import codes from "./codes.mjs";
import { encode } from "./codecs/runtime/codec.mjs";
import { packEnvelope } from "./codecs/runtime/envelope.mjs";

function usage(prog) {
  console.error(`Usage: ${prog} --input-type <type-script|type-file> [value-file]`);
  console.error(`  Example inline:`);
  console.error(`    echo '["zebara","ela"]' | ${prog} --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v'`);
  console.error(`  Example file:`);
  console.error(`    cat input.json | ${prog} --input-type input-type.k`);
}

function maybeReadFile(s) {
  if (!s) return s;
  if (fs.existsSync(s) && fs.statSync(s).isFile()) {
    return fs.readFileSync(s, "utf8");
  }
  return s;
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)))));
    stream.on("error", reject);
  });
}

function collectReachableTypes(rootTypeName, typeMap) {
  const reachable = {};
  const queue = [rootTypeName];
  while (queue.length > 0) {
    const current = queue.shift();
    if (reachable[current]) continue;
    const code = typeMap[current];
    if (!code) {
      throw new Error(`Missing type definition for ${current}`);
    }
    reachable[current] = code;
    const links = code[code.code] || {};
    for (const label of Object.keys(links)) {
      const ref = links[label];
      if (typeof ref === "string" && ref.startsWith("@") && !reachable[ref]) {
        queue.push(ref);
      }
    }
  }
  return reachable;
}

async function main() {
  const prog = argv[1];
  const args = argv.slice(2);

  let inputTypeArg = null;
  let valueFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input-type") {
      inputTypeArg = args[++i];
    } else {
      valueFile = args[i];
    }
  }

  if (!inputTypeArg) {
    usage(prog);
    return exit(1);
  }

  const typeScript = maybeReadFile(inputTypeArg);
  const { defs, exp } = parseScript(typeScript);
  if (exp.op !== "code") {
    throw new Error("Input type script must end with a type name expression (e.g., '$v')");
  }

  const { codes: finalizedCodes, representatives } = codes.finalize(defs.codes);
  const typeName = representatives[exp.code] || exp.code;
  const typeInfo = finalizedCodes[typeName];
  if (!typeInfo) {
    throw new Error(`Could not resolve concrete type for '${exp.code}'`);
  }

  const inputBuffer = valueFile
    ? fs.readFileSync(valueFile)
    : await readAll(stdin);
  const inputText = inputBuffer.toString("utf8");

  const value = parseValue(inputText, typeName, typeInfo);
  const resolveType = (name) => {
    const t = finalizedCodes[name];
    if (!t) throw new Error(`Unknown type during encoding: ${name}`);
    return t;
  };

  const payload = encode(value, typeName, typeInfo, resolveType);
  const reachableTypes = collectReachableTypes(typeName, finalizedCodes);
  const envelope = packEnvelope({ typeName, types: reachableTypes, payload });
  stdout.write(envelope);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
