#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import k from "./index.mjs";
import run from "./run.mjs";
import codes from "./codes.mjs";
import { decodeEnvelope, encodeToEnvelope } from "./codecs/runtime/prefix-codec.mjs";
import { exportPatternGraph } from "./codecs/runtime/codec.mjs";
import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

const prog = argv[1];

let kScript, outputPattern, inputStream;

function singletonPattern(value) {
  return encodeToEnvelope(value, null).pattern;
}

function cloneSubpattern(pattern, root = 0) {
  const visited = new Map();
  const nodes = [];

  function visit(nodeId) {
    if (visited.has(nodeId)) return visited.get(nodeId);
    const newId = nodes.length;
    visited.set(nodeId, newId);
    const [kind, edges] = pattern[nodeId];
    nodes.push([kind, []]);
    nodes[newId][1] = edges.map(([label, target]) => [label, visit(target)]);
    return newId;
  }

  visit(root);
  return nodes;
}

function edgeSubpattern(pattern, label) {
  if (!pattern || pattern.length === 0) return null;
  const [, edges] = pattern[0];
  const edge = edges.find(([edgeLabel]) => edgeLabel === label);
  if (!edge) return null;
  return cloneSubpattern(pattern, edge[1]);
}

function composePattern(kind, entries) {
  const result = [[kind, []]];

  for (const [label, childPattern] of entries) {
    const offset = result.length;
    result[0][1].push([label, offset]);
    for (const [childKind, childEdges] of childPattern) {
      result.push([
        childKind,
        childEdges.map(([edgeLabel, target]) => [edgeLabel, target + offset])
      ]);
    }
  }

  return result;
}

function mergePatterns(declared, observed) {
  if (!declared || declared.length === 0) return observed;
  if (!observed || observed.length === 0) return declared;
  const nodes = [];
  const cloneMemo = new Map();
  const mergeMemo = new Map();

  function cloneInto(sourceTag, pattern, nodeId) {
    const key = `${sourceTag}:${nodeId}`;
    if (cloneMemo.has(key)) return cloneMemo.get(key);
    const newId = nodes.length;
    cloneMemo.set(key, newId);
    const [kind, edges] = pattern[nodeId];
    nodes.push([kind, []]);
    nodes[newId][1] = edges.map(([label, target]) => [label, cloneInto(sourceTag, pattern, target)]);
    return newId;
  }

  function visit(declaredId, observedId) {
    if (declaredId == null) return cloneInto("o", observed, observedId);
    if (observedId == null) return cloneInto("d", declared, declaredId);

    const key = `${declaredId}|${observedId}`;
    if (mergeMemo.has(key)) return mergeMemo.get(key);

    const [declaredKind, declaredEdges] = declared[declaredId];
    const [observedKind, observedEdges] = observed[observedId];

    if (declaredKind === "any") return cloneInto("o", observed, observedId);
    if (observedKind === "any") return cloneInto("d", declared, declaredId);
    if (declaredKind !== observedKind) return cloneInto("d", declared, declaredId);

    const newId = nodes.length;
    mergeMemo.set(key, newId);
    nodes.push([declaredKind, []]);

    nodes[newId][1] = declaredEdges.map(([label, declaredTarget]) => {
      const observedEdge = observedEdges.find(([edgeLabel]) => edgeLabel === label);
      return [label, visit(declaredTarget, observedEdge ? observedEdge[1] : null)];
    });

    return newId;
  }

  visit(0, 0);
  return nodes;
}

function observedPattern(exp, value, pattern) {
  if (value === undefined) return null;

  switch (exp.op) {
    case "code":
    case "identity":
    case "filter":
      return pattern;

    case "ref": {
      const defn = run.defs.rels[exp.ref];
      if (defn != null) {
        return observedPattern(defn.def, value, pattern);
      }
      return pattern;
    }

    case "dot": {
      return edgeSubpattern(pattern, exp.dot) || singletonPattern(value.product[exp.dot]);
    }

    case "div": {
      return edgeSubpattern(pattern, exp.div) || singletonPattern(value.value);
    }

    case "comp": {
      let currentValue = value;
      let currentPattern = pattern;
      for (const subexp of exp.comp) {
        currentPattern = observedPattern(subexp, currentValue, currentPattern);
        currentValue = run(codes.find, subexp, currentValue);
        if (currentValue === undefined) return null;
      }
      return currentPattern;
    }

    case "union": {
      for (const subexp of exp.union) {
        const result = run(codes.find, subexp, value);
        if (result !== undefined) {
          return observedPattern(subexp, value, pattern);
        }
      }
      return null;
    }

    case "product": {
      const entries = exp.product.map(({ label, exp: subexp }) => {
        const subvalue = run(codes.find, subexp, value);
        if (subvalue === undefined) {
          throw new Error(`Product field '${label}' evaluated to undefined`);
        }
        const subpattern = observedPattern(subexp, value, pattern) || singletonPattern(subvalue);
        return [label, subpattern];
      });
      return composePattern("closed-product", entries);
    }

    case "vid": {
      return composePattern("closed-union", [[exp.vid, pattern || singletonPattern(value)]]);
    }

    default:
      return singletonPattern(value);
  }
}

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
    console.error(`Usage: ${prog} ( k-expr | -k k-file ) [ envelope-file ]`);
    console.error(`       E.g.,  echo '["zebara","ela"]' | ./codecs/k-parse.mjs --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v' | ${prog} '{.1 0}'`);
    return exit(-1);
  }
})(argv.slice(2)));

const buffer = [];
inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
inputStream.on("end", () => {
  try {
    const inputBuffer = Buffer.concat(buffer);
    const envelope = JSON.parse(inputBuffer.toString("utf8"));
    const { pattern: inputPattern, value } = decodeEnvelope(envelope);
    const result = kScript(value);
    if (result === undefined) {
      throw new Error("k expression evaluated to undefined; cannot encode undefined output value");
    }
    const observed = observedPattern(run.defs.rels.__main__.def, value, inputPattern);
    const finalPattern = mergePatterns(outputPattern, observed);
    const encoded = encodeToEnvelope(result, finalPattern);
    stdout.write(`${JSON.stringify(encoded)}\n`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
