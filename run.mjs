import assert from "assert";
import { Product, Variant, edgeSubpattern, composePattern, withPattern } from "./Value.mjs"

const builtin = {
  "_log!": (arg) => {
    console.error(`_log!: ${arg}`);

    return arg;
  }
};

const codes = { };

function verify(findCode, code, value) {
  "use strict";
  if (code == null) return false;
  code = findCode(code);
  switch (code.code) {
    case "product":
      if (! (value instanceof Product)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== Object.keys(code.product).length) return false;
        return fields.every((label) =>
          verify(findCode, code.product[label], value.product[label])
        );
      }
    case "union":
      if (! (value instanceof Product)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== 1) return false;
        return verify(findCode, code.union[fields[0]], value.product[fields[0]]);
      }
    default: 
      return codes[code.code](value);
  }
}

function run(findCode, exp, value) {
  // console.log("RUN", JSON.stringify({exp, value}, null, 2));
  "use strict";
  if (value === undefined) return;
  while (true) {    
    switch (exp.op) {
      case "code":
        if (verify(findCode, exp.code, value)) {
          return value;
        }
        return;
      case "identity":
        return value;
      case "ref": {
        const defn = run.defs.rels[exp.ref];
        if (defn != undefined) {
          exp = defn.def;
          continue;
        }
        const builtin_func = builtin[exp.ref];
        if (builtin_func != null) {
          return builtin_func(value);
        }
        throw(`Unknown ref: '${exp.ref}'`);
      }
      case "dot":
        return withPattern(value.product[exp.dot], edgeSubpattern(value.pattern, exp.dot));
      case "div":
        if (value.tag === exp.div) return withPattern(value.value, edgeSubpattern(value.pattern, exp.div));
        return
      case "comp":
        for (let i = 0, len = exp.comp.length - 1; i < len; i++) {
          const result = run(findCode, exp.comp[i], value);
          if (result === undefined) return;
          value = result;
        }
        exp = exp.comp[exp.comp.length - 1];
        continue;
      case "union":
        if (exp.union.length === 0) return;
        for (let i = 0, len = exp.union.length -1; i < len; i++) {
          const result = run(findCode, exp.union[i], value);
          if (result !== undefined) {
            return result;
          }
        }
        exp = exp.union[exp.union.length - 1];
        continue;
    
      case "product": {
        let result = {};
        const patternEntries = [];
        let len = exp.product.length;
        for (let i = 0; i < len; i++) {
          const { label, exp: e } = exp.product[i];
          const r = run(findCode, e, value);
          if (r === undefined) return;
          result[label] = r;
          patternEntries.push([label, r.pattern]);
        }
        return new Product(result, composePattern("closed-product", patternEntries));
      }
      case "vid":
        return new Variant(exp.vid, value, composePattern("closed-union", [[exp.vid, value.pattern]]));
      case "filter": {
        return value;
      }
      default:
        assert(false,`Unknown operation: '${exp.op}'`);
    
    }
  };
}

run.builtin = builtin;

export default run;
export { run  };
