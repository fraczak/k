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
  return run(exp);
}

compile.doc = "Transforms k-script (string) into a an async function";


export default { compile, parse };

export { compile, parse };
