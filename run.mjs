import assert from "assert";

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
  GT: (args) => {
    const [last, ...rest] = args;
    const [ok, _] = rest.reduce(
      ([ok, last], x) => [ok && last > x, x],
      [true, last]
    );
    if (ok) return args;
  },
  EQ: (args) => {
    const [first, ...rest] = args;
    const ok = rest.reduce((ok, x) => ok && first === x, true);
    if (ok) return args;
  },
  PLUS: (args) => valid(args.reduce((res, x) => res + x, 0)),
  TIMES: (args) => valid(args.reduce((res, x) => res * x, 1)),
  DIV: ([x, y]) => {
    const div = Math.floor(x / y);
    const rem = modulo(x, y);
    if (x === div * y + rem) return { div, rem };
  },
  FDIV: ([x, y]) => x / y,
  CONCAT: (strs) => strs.join(""),
  true: () => true,
  false: () => false,
  null: () => null,
  toJSON: (x) => JSON.stringify(x),
  fromJSON: (x) => JSON.parse(x),
  CONS: (arg) => { try { return [arg[0], ...arg[1]]; } catch (e) { return undefined; } },
  SNOC: (x) => (x.length > 1 ? [x[0], x.slice(1)] : undefined),
  toDateMsec: (x) => new Date(x).getTime(),
  toDateStr: (x) => new Date(x).toISOString(),
};

const codes = {
  int: (x) => Number.isInteger(x),
  string: (x) => x instanceof String || "string" === typeof x,
  bool: (x) => x === true || x === false,
};

function verify(code, value) {
  if (code == null) {
    // representatives = run.defs.representatives
    // defCodes = JSON.stringify run.defs.codes
    // console.log {code,value, representatives, defCodes}
    return false;
  }
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
    default: {
      const c = run.defs.codes[run.defs.representatives[code]];
      if (c != null) return verify(c, value);
      return codes[code](value);
    }
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
      case "str":
      case "int":
        return exp[exp.op];
      case "ref":
        const defn = run.defs.rels[exp.ref];
        if (defn != null) {
          exp = defn[defn.length - 1];
          continue;
        }
        const builtin_func = builtin[exp.ref];
        if (builtin_func != null) {
          return builtin_func(value);
        }
        throw(`Unknown ref: '${exp.ref}'`);
      case "dot":
        // a hack to allow something like 'null . null' or '0 . 0' to work by returning unit
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          if (`${value}` === `${exp.dot}`) return {};
          return;
        }
        return value[exp.dot];
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
        assert(isOpen(result), "CARET (^): Only an 'open' vector can be closed.");
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

export default run;
export { run , closeVector };
