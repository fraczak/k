#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import k from "./index.mjs";
import codes from "./codes.mjs";
import { decode } from "./codecs/runtime/codec.mjs";
import { encode } from "./codecs/runtime/codec.mjs";
import { unpackEnvelope } from "./codecs/runtime/envelope.mjs";
import { packEnvelope } from "./codecs/runtime/envelope.mjs";
import { typeDefsFromValue } from "./codecs/runtime/typeFromValue.mjs";

const prog = argv[1];

let kScript, inputStream;

({ kScript, inputStream } = ((args) => {
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
    let kScript = k.compile(kScriptStr);
    inputStream = (function (arg) {
      if (arg == null) {
        return stdin;
      }
      return fs.createReadStream(arg);
    })(args.shift());
    return { kScript, inputStream };
  } catch (error) {
    console.error(error);
    console.error(`Usage: ${prog} ( k-expr | -k k-file ) [ binary-file ]`);
    console.error(`       E.g.,  echo '["zebara","ela"]' | k-encode --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v' | ${prog} '{.1 0}'`);
    return exit(-1);
  }
})(argv.slice(2)));

const buffer = [];
inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
inputStream.on("end", () => {
  try {
    const envelopeBuffer = Buffer.concat(buffer);
    const { types, payload } = unpackEnvelope(envelopeBuffer);
    const resolveType = (typeName) => {
      const code = types[typeName];
      if (!code) {
        throw new Error(`Unknown type in envelope: ${typeName}`);
      }
      return code;
    };
    const { value } = decode(payload, resolveType);
    const result = kScript(value);
    if (result === undefined) {
      throw new Error("k expression evaluated to undefined; cannot encode undefined output value");
    }

    const { defs: outDefs, root: outRoot } = typeDefsFromValue(result);
    const { codes: outCodes, representatives: outReps } = codes.finalize(outDefs);
    const outTypeName = outReps[outRoot] || outRoot;
    const outTypeInfo = outCodes[outTypeName];
    if (!outTypeInfo) {
      throw new Error("Failed to resolve output canonical type");
    }

    const resolveOutputType = (typeName) => {
      const code = outCodes[typeName];
      if (!code) {
        throw new Error(`Unknown output type: ${typeName}`);
      }
      return code;
    };
    const encoded = encode(result, outTypeName, outTypeInfo, resolveOutputType);

    const queue = [outTypeName];
    const outReachable = {};
    while (queue.length > 0) {
      const current = queue.shift();
      if (outReachable[current]) continue;
      const code = outCodes[current];
      if (!code) throw new Error(`Missing output type definition for ${current}`);
      outReachable[current] = code;
      const links = code[code.code] || {};
      for (const label of Object.keys(links)) {
        const ref = links[label];
        if (typeof ref === "string" && ref.startsWith("@") && !outReachable[ref]) {
          queue.push(ref);
        }
      }
    }

    const outEnvelope = packEnvelope({
      typeName: outTypeName,
      types: outReachable,
      payload: encoded
    });
    stdout.write(outEnvelope);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
