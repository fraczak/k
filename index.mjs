import { parse } from "./parser.mjs";
import run from "./run.mjs";
import t from "./codes.mjs";

function finalize(codes) {
  const representatives = t.minimize(codes).representatives;
  return {
    codes: t.normalizeAll(codes, representatives),
    representatives,
  };
}

function compile(script) {
  const { defs, exp } = parse(script);
  const { codes, representatives } = finalize(defs.codes);
  run.defs = {
    codes,
    representatives,
    rels: defs.rels,
  };
  return run.bind(null, exp);
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data) {
  return compile(script)(data);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";

export default { compile, run: runScriptOnData, parse };
export { compile, runScriptOnData as run, parse };
