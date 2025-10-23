import assert from "assert";
import { find } from "./codes.mjs";
import { Product, Variant } from "./Value.mjs"



const builtin = {
  "_log!": (arg) => {
    console.error(`_log!: ${arg}`);

    return arg;
  }
};

const codes = { };

function verify(code, value) {
  "use strict";
  if (code == null) return false;
  code = find(code);
  switch (code.code) {
    case "product":
      if (! (value instanceof Product)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== Object.keys(code.product).length) return false;
        return fields.every((label) =>
          verify(code.product[label], value.product[label])
        );
      }
    case "union":
      if (! (value instanceof Product)) return false;
      else {
        const fields = Object.keys(value.product);
        if (fields.length !== 1) return false;
        return verify(code.union[fields[0]], value.product[fields[0]]);
      }
    default: 
      return codes[code.code](value);
  }
}

function run(exp, value) {
  "use strict";
  if (value === undefined) return;
  while (true) {    
    switch (exp.op) {
      case "code":
        if (verify(exp.code, value)) {
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
        if (value instanceof Product) return value.product[exp.dot];
        if ((value instanceof Variant) && (value.tag === exp.dot)) return value.value;
        return

      case "comp":
        for (let i = 0, len = exp.comp.length - 1; i < len; i++) {
          const result = run(exp.comp[i], value);
          if (result === undefined) return;
          value = result;
        }
        exp = exp.comp[exp.comp.length - 1];
        continue;
      case "union":
        if (exp.union.length === 0) return;
        for (let i = 0, len = exp.union.length -1; i < len; i++) {
          const result = run(exp.union[i], value);
          if (result !== undefined) {
            return result;
          }
        }
        exp = exp.union[exp.union.length - 1];
        continue;
    
      case "product": {
        let result = {};
        let open = false;
        let len = exp.product.length;
        for (let i = 0; i < len; i++) {
          const { label, exp: e } = exp.product[i];
          const r = run(e, value);
          if (r === undefined) return;
          result[label] = r;
        }
        if (len == 1) {
          return new Variant(exp.product[0].label, result[exp.product[0].label]);
        }
        return new Product(result);
      }
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
