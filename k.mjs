#!/usr/bin/env node

import fs from "node:fs";
import k from "./index.mjs";

const splice = [].splice;

const prog = process.argv[1];

let kScript, jsonStream, oneJson;

({ kScript, jsonStream, oneJson } = (function (oneJson, args) {
  let e;
  try {
    kScript = (function (arg) {
      if (arg == null) {
        throw new Error();
      }
      if (arg === "-k") {
        return fs.readFileSync(args.shift()).toString("utf8");
      } else {
        return arg;
      }
    })(args.shift());
    kScript = k.compile(kScript);
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
  (function (buffer) {
    jsonStream.on("data", function (data) {
      return buffer.push(data);
    });
    return jsonStream.on("end", function () {
      var e;
      try {
        return console.log(
          JSON.stringify(kScript(JSON.parse(buffer.join(""))))
        );
      } catch (error) {
        e = error;
        return console.error(e);
      }
    });
  })([]);
} else {
  (function (buffer, line) {
    return jsonStream.on("data", function (data) {
      var e, first, i, json, last, len, ref, rest, results, todo;
      [first, ...rest] = data.toString("utf8").split("\n");
      buffer.push(first);
      if (rest.length > 0) {
        todo = buffer.join("");
        (ref = rest), ([...rest] = ref), ([last] = splice.call(rest, -1));
        buffer = [last];
        todo = [todo, ...rest];
        results = [];
        for (i = 0, len = todo.length; i < len; i++) {
          json = todo[i];
          if (!json.match(/^[ \n\t]*(?:#.*)?$/)) {
            try {
              console.log(JSON.stringify(kScript(JSON.parse(json))));
            } catch (error) {
              e = error;
              console.error(`Problem [line ${line}]: '${json}'`);
              console.error(e);
            }
          }
          results.push((line = line + 1));
        }
        return results;
      }
    });
  })([], 0);
}
