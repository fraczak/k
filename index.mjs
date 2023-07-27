import { parse } from "./parser.mjs";
import { patterns } from "./patterns.mjs";
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
  // const rels = {...defs.rels, "__main__": [exp]};
  // const pats = patterns(codes, representatives, rels);
  run.defs = {
    codes,
    representatives,
    rels: defs.rels,
    // ...pats
  };
  return run.bind(null, exp);
}

compile.doc = "Transforms k-script (string) into a function";

function runScriptOnData(script, data) {
  return compile(script)(data);
}
runScriptOnData.doc = "Run 'script' (string) on 'data': (script,data) -> data";


function annotate(script) {
  const { defs, exp } = parse(script);
  const { codes, representatives } = finalize(defs.codes);

  const rels = {...defs.rels, "__main__": [exp]};

  const pats = patterns(codes, representatives, rels);

  return {rels,codes,representatives, ...pats}
}
annotate.doc = "Annotate all the script expressions with patterns";

export default { compile, run: runScriptOnData, parse, annotate };
export { compile, runScriptOnData as run, parse, annotate };
