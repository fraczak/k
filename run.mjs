const modulo = (a, b) => ((+a % (b = +b)) + b) % b;
const valid = (x) => (isNaN(x) ? undefined : x);

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
  CONS: ([x, y]) => [x, ...y],
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
  switch (exp.op) {
    case "code":
      if (verify(exp.code, value)) {
        return value;
      }
      break;
    case "identity":
      return value;
    case "str":
    case "int":
      return exp[exp.op];
    case "ref":
      const defn = run.defs.rels[exp.ref];
      if (defn != null) {
        return run(defn[defn.length - 1], value);
      }
      return builtin[exp.ref](value);
    case "dot":
      return value[exp.dot];
    case "comp":
      return exp.comp.reduce((value, exp) => {
        if (value !== undefined) return run(exp, value);
      }, value);
    case "union":
      for (let i = 0, len = exp.union.length; i < len; i++) {
        const result = run(exp.union[i], value);
        if (result !== undefined) {
          return result;
        }
      }
      return;
    case "vector": {
      const result = [];
      for (let i = 0, len = exp.vector.length; i < len; i++) {
        const r = run(exp.vector[i], value);
        if (r === undefined) return;
        result.push(r);
      }
      return result;
    }
    case "product": {
      const result = {};
      for (let i = 0, len = exp.product.length; i < len; i++) {
        const { label, exp: e } = exp.product[i];
        const r = run(e, value);
        if (r === undefined) return;
        result[label] = r;
      }
      return result;
    }
    default:
      return console.error(exp.op);
  }
}

export default run;
export { run };
