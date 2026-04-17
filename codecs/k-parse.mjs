#!/usr/bin/env node

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import { parse as parseScript } from "../parser.mjs";
import { parseValue } from "../valueIO.mjs";
import codes from "../codes.mjs";
import k from "../index.mjs";
import { encode, encodeWithPattern, exportPatternGraph } from "./runtime/codec.mjs";

function usage(prog) {
  console.error(`Usage: ${prog} [--input-type <type-script|type-file> | --input-pattern <pattern-script|pattern-file>] [value-file]`);
  console.error(`  Example inline:`);
  console.error(`    echo '["zebara","ela"]' | ${prog} --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v'`);
  console.error(`  Example pattern:`);
  console.error(`    echo '["zebara","ela"]' | ${prog} --input-pattern '?{<{} zebara, {} ela> 0, <{} zebara, {} ela> 1}'`);
  console.error(`  Default pattern:`);
  console.error(`    echo 'true' | ${prog}`);
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

async function main() {
  const prog = argv[1];
  const args = argv.slice(2);

  let inputTypeArg = null;
  let inputPatternArg = null;
  let valueFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input-type") {
      inputTypeArg = args[++i];
    } else if (args[i] === "--input-pattern") {
      inputPatternArg = args[++i];
    } else {
      valueFile = args[i];
    }
  }

  if (inputTypeArg != null && inputPatternArg != null) {
    usage(prog);
    return exit(1);
  }

  const inputBuffer = valueFile
    ? fs.readFileSync(valueFile)
    : await readAll(stdin);
  const inputText = inputBuffer.toString("utf8");

  if (inputTypeArg != null) {
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

    const value = parseValue(inputText, typeName, typeInfo);
    const resolveType = (name) => {
      const t = finalizedCodes[name];
      if (!t) throw new Error(`Unknown type during encoding: ${name}`);
      return t;
    };

    stdout.write(encode(value, typeName, typeInfo, resolveType));
    return;
  }

  const pattern = (() => {
    if (inputPatternArg == null) {
      return { dictionary: [], nodes: [{ kind: 0, edges: [] }] };
    }
    const patternScript = maybeReadFile(inputPatternArg);
    const annotated = k.annotate(patternScript);
    const mainRel = annotated.rels.__main__;
    if (mainRel.def.op !== "filter") {
      throw new Error("Input pattern script must end with a filter expression (e.g., '?< {} nil, {X car, Y cdr} cons > = Y')");
    }
    const rootPatternId = mainRel.typePatternGraph.find(mainRel.def.patterns[0]);
    return exportPatternGraph(mainRel.typePatternGraph, rootPatternId);
  })();

  const value = parseValue(inputText, null, null);
  stdout.write(encodeWithPattern(value, pattern));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
