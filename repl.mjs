#!/usr/bin/env node
import readline from "node:readline";
import fs from "node:fs";

import k from "./index.mjs";
import {run, closeVector } from "./run.mjs";
import { prettyCode, prettyRel, patterns2filters } from "./pretty.mjs";
import { find } from "./codes.mjs";


const splice = [].splice;

console.log("Very! experimental repl shell for 'k-language'...");

const help = function () {
  // console.log("  --debug      loads codes and relations as value");
  console.log("  --c            print aliased codes");
  console.log("  --C code       print 'code' definition");
  console.log("  --r            print relations");
  console.log("  --R rel        print 'rel' definition with type patterns");
  console.log("  --p (--pp)     pretty-print last value");
  console.log("  --s (--g) reg  store (get) the current value in (from) register 'reg'");
  console.log("  --regs         print register names");
  console.log("  --l file.k     load 'file.k'");
};

help();

const re__l = /^[ \n\t]*(?:--l[ ]+)(.+)[ ]*?$/;
const re__s = /^[ \n\t]*(?:--s[ ]+)(.+)[ ]*?$/;
const re__g = /^[ \n\t]*(?:--g[ ]+)(.+)[ ]*?$/;
const re__R = /^[ \n\t]*(?:--R[ ]+)(.+)[ ]*?$/;
const re__C = /^[ \n\t]*(?:--C[ ]+)(.+)[ ]*?$/;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

rl.prompt();

rl.on('line', (line) => {
  evaluate(line);
  rl.prompt();
}).on('close', () => {
  console.log('REPL closed');
  process.exit(0);
});

let old_val = {};
let val = {};
const printVal = function (v = val) {
  if (v === undefined)
    console.log("...",v);
  else
    console.log(`--> ${JSON.stringify(v)}`);
  rl.setPrompt('> ');
}
const registers = {};
const buffer = [];
function evaluate(line) {
  if (line.trim().endsWith('\\')) {
    buffer.push(line.slice(0, -1));
    rl.setPrompt('  ');
    return;
  }
  line = [...buffer, line].join('\n');
  buffer.length = 0;
  try {
    if (val === undefined) 
      val = old_val;
    else
      old_val = val;
    if (line.match(/^[ \n\t]*(?:--h)?$/)) {
      // --h
      help();
    } else if (line.match(/^[ \n\t]*\^$/)) {
      val = closeVector(val); 
      printVal();
      
    } else if (line.match(re__l)) {
      // --l 
      const file = line.match(re__l)[1];
      console.log(`  ... loading file: ${file} ...`);
      const kScript = fs.readFileSync(file).toString();
      console.log(`  Done!`);
      // console.log(kScript);
      val = k.compile("+++\n" + kScript + "\n()")(val);
      printVal();
    } else if (line.match(/^[ \n\t]*--debug$/)) {
      // --debug
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
            for (const relName in defs.rels) {
              if (relName != "__main__")
                result[relName] = prettyRel(defs.rels[relName].def);
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
      // --C
    } else if (line.match(re__C)) {
      let codeName = line.match(re__C)[1];
      if (codeName.startsWith("?"))
        codeName = codeName.slice(1);
      if (codeName.startsWith("$"))
        codeName = codeName.slice(1);
      const canonicalName = run.defs.representatives[codeName] || codeName;
      const codeExp = find( canonicalName );
      console.log(` $ ${canonicalName} = ${prettyCode(run.defs.representatives, codeExp)}; -- ${codeExp.def}`);
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
        // --R rel
    } else if (line.match(re__R)) {
      const relName = line.match(re__R)[1];
      const rel = run.defs?.rels[relName];
      if (!rel) {
        console.log(` -- relation '${relName}' not found`);
        return;
      }
      const filters = patterns2filters(rel.typePatternGraph, ...rel.def.patterns);
      // console.log(filters);
      // console.log(" variables:", JSON.stringify(variables));
      // console.log(JSON.stringify({filters, variables}, null, 2));
      // for (const filter of filters) {
      const pcodef= prettyCode.bind(null, run.defs.representatives);
      const filtersStr = filters.map( x => prettyRel(pcodef, {op: "filter", filter: x}));
      console.log(`  ${relName} : ${filtersStr[0]}  -->  ${filtersStr[1]}`);
      console.log(`  ${relName} = ${prettyRel(pcodef,rel.def)};`);
      // }
      // ------ k code
    } else if (!line.match(/^[ \n\t]*(?:#.*)?$/)) {
      try {
        val = k.run(`+++\n${line}\n()`, val);
        printVal();
      } catch (error) {
        e = error;
        console.error("ERROR:");
        console.error(e);
      }
    }
  } catch (e) {
    console.error(e.message);
  }
}