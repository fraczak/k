import assert from "assert";
import { find } from "./codes.mjs";
import { Bits } from "./bits.mjs"

const modulo = (a, b) => ((+a % (b = +b)) + b) % b;
const valid = (x) => (isNaN(x) ? undefined : x);

function isOpen(x) {
  return (Array.isArray(x) && x.open);
}

function isClosed(x) {
  return (Array.isArray(x) && !x.open);
}

Array.prototype.toJSON = function () {
  if (this.open) {
    // throw new Error(`Cannot serialize open vector: ${JSON.stringify([...this])}.`);
    return {"OPEN VECTOR": [...this]};
  }
  return this;
};

function closeVector(val) {
  if (isOpen(val)) {
    return [...val];
  }
  console.error("Can close only an open vector.");
  return val;
}

const builtin = {
  "_log!": (arg) => {
    console.error(`_log!: ${JSON.stringify(arg)}`);
    return arg;
  },
  CONS: ({car, cdr}) => { try { return [car, ...cdr]; } catch (e) { return undefined; } },
  SNOC: (x) => (x.length > 0 ? {car: x[0], cdr: x.slice(1)} : undefined)
};

const codes = {
  "@bits": (x) => x instanceof Bits
};

function verify(code, value) {
  "use strict";
  if (code == null) return false;
  code = find(code);
  switch (code.code) {
    case "vector":
      if (!Array.isArray(value)) return false;
      return value.every((x) => verify(code.vector, x));
    case "product":
      if ("object" !== typeof value) return false;
      else {
        const fields = Object.keys(value);
        if (fields.length !== Object.keys(code.product).length) return false;
        return fields.every((label) =>
          verify(code.product[label], value[label])
        );
      }
    case "union":
      if ("object" !== typeof value) return false;
      else {
        const fields = Object.keys(value);
        if (fields.length !== 1) return false;
        return verify(code.union[fields[0]], value[fields[0]]);
      }
    default: 
      return codes[code.code](value);
  }
}

function run(exp, value) {
  "use strict";
  if (value === undefined) return;
  while (true) {
    if (isOpen(value)) {
      if (exp.op === "caret2") return [...value];
      const result = [];
      result.open = true
      for (const v of value) {
        const r = run(exp, v);
        if (r !== undefined) result.push(r);
      }
      return result;
    }
    switch (exp.op) {
      case "code":
        if (verify(exp.code, value)) {
          return value;
        }
        return;
      case "identity":
        return value;
      case "bits":
        return exp[exp.op];
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
        return value[exp.dot];

      case "div":
        if (value instanceof Bits && exp.div instanceof Bits) {
          return value.eatPrefix(exp.div);
        }
        return;

      case "times":
        if (value instanceof Bits && exp.times instanceof Bits) {
          return value.prepend(exp.times);
        } else {
          console.log("TIMES: ", value, exp.times);
        }
        return;

      case "pipe": {
        assert(isClosed(value), `PIPE (|): Only a regular vector value can be "open".`);
        const result = [...value];
        result.open = true;
        return result;
      }
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
      case "vector": {
        let result = [];
        let open = false;
        for (let i = 0, len = exp.vector.length; i < len; i++) {
          const r = run(exp.vector[i], value);
          if (r === undefined) return;
          if (open) {
            if (isOpen(r)) {
              const newResult = [];
              newResult.open = true;
              for (const x of result) {
                for (const y of r) {
                  newResult.push([...x, y]);
                }
              }
              result = newResult;
            } else {
              for (const x of result) x.push(r);
            }
          } else {
            if (isOpen(r)) {
              open = true;
              const newResult = [];
              newResult.open = true;
              for (const x of r) {
                newResult.push([...result, x]);
              } 
              result = newResult;
            } else {
              result.push(r);
            }
          }
        }
        return result;
      }
      case "product": {
        let result = {};
        let open = false;
        for (let i = 0, len = exp.product.length; i < len; i++) {
          const { label, exp: e } = exp.product[i];
          const r = run(e, value);
          if (r === undefined) return;
          if (open) {
            if (isOpen(r)) {
              let newResult = [];
              newResult.open = true;
              for (const v of r) {
                for (const x of result) {
                  newResult.push({...x, [label]: v});
                }
              }
              result = newResult;
            } else {
              let newResult = [];
              newResult.open = true;
              for (const x of result) {
                newResult.push({...x, [label]: r});
              }
              result = newResult;
            } 
          } else {
            if (isOpen(r)) {
              open = true;
              let newResult = [];
              newResult.open = true;
              for (const v of r.values()) {
                newResult.push({...result, [label]: v});
              }
              result = newResult;
            } else {
              result[label] = r;
            }
          }      
        }
        return result
      }
      case "caret": {
        const result = run(exp.caret, value);
        // assert(isOpen(result), "CARET (^): Only an 'open' vector can be closed.");
        if (! isOpen(result))
          throw new Error(`Type Error (line: ${exp.end?.line}:${exp.end?.column}): CARET (^): Only 'unboxed' values can be 'boxed'.`)
        return [...result];
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
export { run , closeVector };
