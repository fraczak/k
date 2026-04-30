#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import k from "../index.mjs";
import { parseValue } from "../valueIO.mjs";
import { exportPatternGraph } from "./runtime/codec.mjs";
import { patternToPropertyList } from "./runtime/pattern-json.mjs";
import { encodeToEnvelope, encodeToWire } from "./runtime/prefix-codec.mjs";

function usage(prog) {
  console.error(`Usage: ${prog} [--json] [--input-type <type-script|type-file> | --input-pattern <pattern-script|pattern-file>] [value-file]`);
  console.error("  Parse a textual k value and emit the self-hosted binary pattern+value stream.");
  console.error("  Use --json to emit the legacy JSON prefix-codec envelope.");
  console.error("  If no pattern or type is provided, derive a closed pattern from the value.");
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

function propertyListFromScript(script) {
  const annotated = k.annotate(script);
  const mainRel = annotated.rels.__main__;
  if (!mainRel || !mainRel.typePatternGraph) {
    throw new Error("Could not resolve __main__ relation");
  }
  if (mainRel.def.op !== "filter" && mainRel.def.op !== "code") {
    throw new Error("Input script must end with a filter or a type name");
  }
  const rootPatternId = mainRel.typePatternGraph.find(mainRel.def.patterns[0]);
  const pattern = exportPatternGraph(mainRel.typePatternGraph, rootPatternId);
  return patternToPropertyList(pattern);
}

async function main() {
  const prog = argv[1];
  const args = argv.slice(2);

  let inputTypeArg = null;
  let inputPatternArg = null;
  let valueFile = null;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      jsonOutput = true;
    } else if (args[i] === "--input-type") {
      inputTypeArg = args[++i];
    } else if (args[i] === "--input-pattern") {
      inputPatternArg = args[++i];
    } else if (valueFile == null) {
      valueFile = args[i];
    } else {
      usage(prog);
      return exit(1);
    }
  }

  if (inputTypeArg != null && inputPatternArg != null) {
    usage(prog);
    return exit(1);
  }

  const inputBuffer = valueFile ? fs.readFileSync(valueFile) : await readAll(stdin);
  const inputText = inputBuffer.toString("utf8");
  const value = parseValue(inputText, null, null);

  const propertyList = (() => {
    if (inputTypeArg != null) return propertyListFromScript(maybeReadFile(inputTypeArg));
    if (inputPatternArg != null) return propertyListFromScript(maybeReadFile(inputPatternArg));
    return null;
  })();

  if (jsonOutput) {
    const envelope = encodeToEnvelope(value, propertyList);
    stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }

  stdout.write(encodeToWire(value, propertyList));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
