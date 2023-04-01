import { parse } from "./parser.mjs";

import run from "./run.mjs";

import t from "./codes.mjs";

const finalize = function (codes) {
  var representatives;
  representatives = t.minimize(codes).representatives;
  codes = t.normalizeAll(codes, representatives);
  return { codes, representatives };
};

const compile = function (script) {
  return (function ({ defs, exp }) {
    var codes, representatives;
    // console.log defs
    ({ codes, representatives } = finalize(defs.codes));
    // console.log {codes, representatives}
    run.defs = {
      codes,
      representatives,
      rels: defs.rels,
    };
    return function (data) {
      return run(exp, data);
    };
  })(parse(script));
};

compile.doc = "Transforms k-script (string) into a function";

const runScriptOnData = function (script, data) {
  return compile(script)(data);
};

runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";

export default { compile, run: runScriptOnData, parse };

export { compile, runScriptOnData as run, parse };
