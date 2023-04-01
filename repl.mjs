#!/usr/bin/env node

import k from "./index.mjs";
import run from "./run.mjs";
import { prettyCode, prettyRel } from "./pretty.mjs";

import fs from "node:fs";

const splice = [].splice;

console.log("Very! experimental repl shell for 'k-language'...");

const help = function () {
  console.log(" --h          print help");
  console.log(" --a          print codes and relations");
  console.log(" --c          print codes");
  console.log(" --r          print rels");
  return console.log(" --l file.k   load 'file.k'");
};

help();

const re = /^[ \n\t]*(?:--l[ ]+)(.+[^ ])[ ]*?$/;

(function (val, buffer) {
  return process.stdin.on("data", function (data) {
    var e, file, first, i, kScript, last, len, line, ref, rest, results, todo;
    [first, ...rest] = data.toString("utf8").split("\n");
    buffer.push(first);
    if (rest.length > 0) {
      todo = buffer.join("");
      (ref = rest), ([...rest] = ref), ([last] = splice.call(rest, -1));
      buffer = [last];
      todo = [todo, ...rest];
      results = [];
      for (i = 0, len = todo.length; i < len; i++) {
        line = todo[i];
        if (val === void 0) {
          val = {};
        }
        if (line.match(/^[ \n\t]*(?:--h)?$/)) {
          results.push(help());
        } else if (line.match(re)) {
          file = line.match(re)[1];
          console.log(`-- loading file: ${file} ...`);
          kScript = fs.readFileSync(file).toString();
          val = k.compile(kScript)(val);
          results.push(console.log(`=> ${JSON.stringify(val)}`));
        } else if (line.match(/^[ \n\t]*(?:--a)?$/)) {
          results.push(console.log(JSON.stringify(run.defs, " ", 2)));
        } else if (line.match(/^[ \n\t]*(?:--r)?$/)) {
          results.push(
            console.log(
              (function (defs, result) {
                if (defs == null) {
                  return result;
                }
                return (function (prettyRel) {
                  var ref1, relExps, relName;
                  ref1 = defs.rels;
                  for (relName in ref1) {
                    relExps = ref1[relName];
                    result[relName] = relExps.map(prettyRel);
                  }
                  return result;
                })(
                  prettyRel.bind(
                    null,
                    prettyCode.bind(null, defs.codes, defs.representatives)
                  )
                );
              })(run.defs, {})
            )
          );
        } else if (line.match(/^[ \n\t]*(?:--c)?$/)) {
          results.push(
            console.log(
              (function (defs, result) {
                var codeExp, codeName, ref1;
                if (defs == null) {
                  return result;
                }
                ref1 = defs.codes;
                for (codeName in ref1) {
                  codeExp = ref1[codeName];
                  result[codeName] = prettyCode(
                    defs.codes,
                    defs.representatives,
                    codeExp
                  );
                }
                return result;
              })(run.defs, {})
            )
          );
        } else if (!line.match(/^[ \n\t]*(?:#.*)?$/)) {
          try {
            val = k.run(`${line} ()`, val);
            results.push(console.log(`=> ${JSON.stringify(val)}`));
          } catch (error) {
            e = error;
            console.error("ERROR:");
            results.push(console.error(e));
          }
        } else {
          results.push(void 0);
        }
      }
      return results;
    }
  });
})({}, []);
