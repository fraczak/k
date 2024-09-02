#!/usr/bin/env node

import k from "./index.mjs";
import {run, closeVector } from "./run.mjs";
import { prettyCode, prettyRel, patterns2filters } from "./pretty.mjs";
import { find } from "./codes.mjs";

import fs from "node:fs";

const splice = [].splice;

console.log("Very! experimental repl shell for 'k-language'...");

const help = function () {
  console.log(" --h          print help");
  console.log(" --a          print codes and relations");
  console.log(" --c          print codes");
  console.log(" --r          print rels");
  console.log(" --p          pretty-print last value");
  console.log(" --pp         print last value via node.js 'console.log'");
  console.log(" --s reg      store the last value in register 'reg'");
  console.log(" --g reg      get the value from register 'reg'");
  console.log(" --regs       print registers names");
  console.log(" --l file.k   load 'file.k'");
  console.log(" --x rel      Print the pattern for relation 'rel'");
};

help();

const re__l = /^[ \n\t]*(?:--l[ ]+)(.+)[ ]*?$/;
const re__s = /^[ \n\t]*(?:--s[ ]+)(.+)[ ]*?$/;
const re__g = /^[ \n\t]*(?:--g[ ]+)(.+)[ ]*?$/;
const re__x = /^[ \n\t]*(?:--x[ ]+)(.+)[ ]*?$/;

const registers = {};

(function (val, buffer) {
  return process.stdin.on("data", function (data) {
    var e, file, first, i, kScript, last, len, line, ref, rest, todo;
    [first, ...rest] = data.toString("utf8").split("\n");
    buffer.push(first);
    if (rest.length > 0) {
      todo = buffer.join("");
      (ref = rest), ([...rest] = ref), ([last] = splice.call(rest, -1));
      buffer = [last];
      todo = [todo, ...rest];
      for (i = 0, len = todo.length; i < len; i++) {
        line = todo[i];
        if (val === void 0) {
          val = {};
        }
        if (line.match(/^[ \n\t]*(?:--h)?$/)) {
          // --h
          help();
        } else if (line.match(/^[ \n\t]*\^$/)) {
          val = closeVector(val); 
          console.log(`=> ${JSON.stringify(val)}`);
        } else if (line.match(re__l)) {
          // --l 
          file = line.match(re__l)[1];
          console.log(` -- loading file: ${file} ...`);
          kScript = fs.readFileSync(file).toString();
          console.log(` ----------------------------- compiling file: ${file} ...`);
          // console.log(kScript);
          val = k.compile("+++" + kScript + "\n()")(val);
          console.log(`=> ${JSON.stringify(val)}`);
        } else if (line.match(/^[ \n\t]*(?:--a)?$/)) {
          // --a
          val = run.defs;
          console.log(val);
          // --r
        } else if (line.match(/^[ \n\t]*(?:--r)?$/)) {
          console.log(
            (function (defs, result) {
              if (defs == null) {
                return result;
              }
              return (function (prettyRel) {
                var ref1, relName;
                ref1 = defs.rels;
                for (relName in ref1) {
                  result[relName] = prettyRel(ref1[relName].def);
                }
                return result;
              })(
                prettyRel.bind(
                  null,
                  prettyCode.bind(null, defs.representatives)
                )
              );
            })(run.defs, {}));
            // --c
        } else if (line.match(/^[ \n\t]*(?:--c)?$/)) {
          console.log(
            (function (defs, result) {
              for (const codeName of Object.keys(defs.representatives || {})) {
                const codeExp = find(defs.representatives[codeName] || codeName);
                result[codeName] = prettyCode(
                  defs.representatives,
                  codeExp
                );
              }
              return result;
            })(run.defs || {}, {})
          );
          // --pp
        } else if (line.match(/^[ \n\t]*(?:--pp)?$/)) {
          console.log(val);
         // --p
        } else if (line.match(/^[ \n\t]*(?:--p)?$/)) {
          console.log(JSON.stringify(val, null, 2));
          // --regs
        } else if (line.match(/^[ \n\t]*(?:--regs)?$/)) {
          console.log(` -- registers: ${Object.keys(registers).join(", ")}`);
          // --s
        } else if (line.match(re__s)) {
          let reg = line.match(re__s)[1];
          registers[reg] = val;
          console.log(` -- current value stored in register: '${reg}'`);
          // --g
        } else if (line.match(re__g)) {
          console.log(" -- getting value from register...");
          let reg = line.match(re__g)[1];
          val = registers[reg];
          console.log(val);
            // --x
        } else if (line.match(re__x)) {
          const relName = line.match(re__x)[1];
          const rel = run.defs.rels[relName];
          const {filters, variables} = patterns2filters(rel.typePatternGraph, ...rel.def.patterns);
          // console.log(filters);
          console.log(" variables:", JSON.stringify(variables));
          // console.log(JSON.stringify({filters, variables}, null, 2));
          for (const filter of filters) {
            console.log(prettyRel(prettyCode.bind(null, run.defs.representatives), {op: "filter", filter}));
          }
          // ------ k code
        } else if (!line.match(/^[ \n\t]*(?:#.*)?$/)) {
          try {
            val = k.run(`+++ ${line} ()`, val);
            console.log(`=> ${JSON.stringify(val)}`);
          } catch (error) {
            e = error;
            console.error("ERROR:");
            console.error(e);
          }
        }
      }
    }
  });
})({}, []);
