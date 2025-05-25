#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import k from "./index.mjs";
import { parse } from "./valueParser.mjs";

const prog = process.argv[1];

let kScript, jsonStream, oneJson;

({ kScript, jsonStream, oneJson } = ((oneJson, args) => {
  let e;
  try {
    let kScriptStr = (function (arg) {
      if (arg == null) {
        throw new Error();
      }
      if (arg === "-k") {
        return fs.readFileSync(args.shift()).toString("utf8");
      } else {
        return arg;
      }
    })(args.shift());
    let kScript = k.compile(kScriptStr);
    jsonStream = (function (arg) {
      if (arg === "-1") {
        oneJson = true;
        arg = args.shift();
      }
      if (arg == null) {
        return process.stdin;
      }
      return fs.createReadStream(arg);
    })(args.shift());
    return { kScript, jsonStream, oneJson };
  } catch (error) {
    e = error;
    console.error(e);
    console.error(`Usage: ${prog} ( k-expr | -k k-file ) [ -1 ] [ json-file ]`);
    console.error(`       E.g.,  echo '{\"a\": 12}' | ${prog} '[(),()]'`);
    return process.exit(-1);
  }
})(false, process.argv.slice(2)));

if (oneJson) {
  const buffer = [];
  jsonStream.on("data", (data) => buffer.push(data));
  jsonStream.on("end", () => {
    try {
      let b = buffer.join("");
      // console.log(b);
      let r = parse(b);
      // console.log(r);
      console.log(kScript(r.value).toString());
    } catch (error) {
      console.error(error);
    }
  });
} else {
  let buffer = [];
  let line = 0;
  jsonStream.on("data", (data) => {
    const [first, ...rest] = data.toString("utf8").split("\n");
    buffer.push(first);
    if (rest.length > 0) {
      const todo = buffer.join("");
      const last = rest.pop();
      buffer = [last];;
      for (const exp of [todo, ...rest]) {
        if (!exp.match(/^[ \n\t]*(?:#.*)?$/)) {
          try {
            let b = exp;
            // console.log(b);
            let r = parse(b);
            // console.log(r);
            console.log(kScript(r.value).toString());
          } catch (error) {
            console.error(`Problem [line ${line}]: '${exp}'`);
            console.error(error);
          }
        }
        line++;
      }
    }
  });
}
