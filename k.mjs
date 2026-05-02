#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import k from "./index.mjs";
import { decodeWire, encodeToWire } from "./codecs/runtime/prefix-codec.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

const prog = argv[1];

let kScript, outputPattern, inputStream;

({ kScript, outputPattern, inputStream } = ((args) => {
  try {
    let kScriptStr = (function (arg) {
      if (arg == null) {
        throw new Error("Missing script argument");
      }
      if (arg === "-k") {
        return fs.readFileSync(args.shift(), "utf8");
      } else {
        return arg;
      }
    })(args.shift());
    const annotated = k.annotate(kScriptStr);
    const mainRel = annotated.rels.__main__;
    const outputPatternId = mainRel.typePatternGraph.find(mainRel.def.patterns[1]);
    const outputPattern = patternToPropertyList(
      exportPatternGraph(mainRel.typePatternGraph, outputPatternId)
    );
    let kScript = k.compile(kScriptStr);
    inputStream = (function (arg) {
      if (arg == null) {
        return stdin;
      }
      return fs.createReadStream(arg);
    })(args.shift());
    return { kScript, outputPattern, inputStream };
  } catch (error) {
    console.error(error);
    console.error(`Usage: ${prog} ( k-expr | -k k-file ) [ input-file ]`);
    console.error(`       E.g.,  echo '["zebara","ela"]' | ./codecs/k-parse.mjs --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v' | ${prog} '{.1 0}'`);
    return exit(-1);
  }
})(argv.slice(2)));

const buffer = [];
inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
inputStream.on("end", () => {
  try {
    const inputBuffer = Buffer.concat(buffer);
    const { pattern: inputPattern, value } = decodeWire(inputBuffer);
    const result = kScript(value);
    if (result === undefined) {
      throw new Error("k expression evaluated to undefined; cannot encode undefined output value");
    }
    stdout.write(encodeToWire(result, outputPattern));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
