#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import { argv, stdin, exit } from "node:process";
import k from "./index.mjs";
import { parse } from "./valueParser.mjs";

const prog = argv[1];

let kScript, jsonStream, oneJson;

({ kScript, jsonStream, oneJson } = ((oneJson, args) => {
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
    jsonStream = (function (arg) {
      if (arg === "-1") {
        oneJson = true;
        arg = args.shift();
      }
      if (arg == null) {
        return stdin;
      }
      return fs.createReadStream(arg);
    })(args.shift());
    return { kScript, jsonStream, oneJson };
  } catch (error) {
    console.error(error);
    console.error(`Usage: ${prog} ( k-expr | -k k-file ) [ -1 ] [ json-file ]`);
    console.error(`       E.g.,  echo '{"a": {}}' | ${prog} '{() x,() y}'`);
    return exit(-1);
  }
})(false, argv.slice(2)));

if (oneJson) {
  const buffer = [];
  jsonStream.on("data", (data) => buffer.push(data));
  jsonStream.on("end", () => {
    try {
      let b = buffer.join("");
      // console.log(b);
      let r = parse(b);
      // console.log(r);
      let result = kScript(r);
      console.log(JSON.stringify(result, null, 2));
      // console.log(kScript(r.value).toString());
    } catch (error) {
      console.error(error);
    }
  });
} else {
  let buffer = [];
  let line = 0;
  jsonStream.setEncoding('utf8');
  jsonStream.on("data", (data) => {
    const [first, ...rest] = data.split("\n");
    buffer.push(first);
    if (rest.length > 0) {
      const todo = buffer.join("");
      const last = rest.pop();
      buffer = [last];
      for (const exp of [todo, ...rest]) {
        if (!exp.match(/^[ \n\t]*(?:#.*)?$/)) {
          try {
            // console.log(exp);
            let r = parse(exp);
            // console.log(r);
            let result = kScript(r);
            console.log(JSON.stringify(result));
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
