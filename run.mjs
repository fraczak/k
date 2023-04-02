import functors from "functors";

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

function run(exp) {
  const evalExp = (value, cb) => {
    if (value === undefined) return cb(null, undefined);
    switch (exp.op) {
      case "code":
        return cb(null, verify(exp.code, value) ? value : undefined);
      case "identity":
        return cb(null, value);
      case "str":
      case "int":
        return cb(null, exp[exp.op]);
      case "ref":
        const defn = run.defs.rels[exp.ref];
        if (defn != null) return run(defn[defn.length - 1])(value, cb);
        return cb(null, builtin[exp.ref](value));
      case "dot":
        return cb(null, value[exp.dot]);
      case "comp":
        return functors.compose(exp.comp.map(run))(value, cb);
      case "union": {
        const afns = exp.union.map((exp) => (v, cb) => {
          if (v === undefined) return run(exp)(value, cb);
          return cb(null, v);
        });
        return functors.compose(afns)(undefined, cb);
      }
      case "vector": {
        const afns = exp.vector.map((exp) => (v, cb) => {
          if (v === undefined) return cb(null, undefined);
          return functors.compose([
            run(exp),
            functors.delay((x) => v.concat([x])),
          ])(value, cb);
        });
        return functors.compose(afns)([], cb);
      }
      case "product": {
        const afns = exp.product.map(({ label, exp }) => (v, cb) => {
          if (v === undefined) return cb(null, undefined);
          return functors.compose([
            run(exp),
            functors.delay((x) => { v[label] = x; return v; }),
          ])(value, cb);
        });
        return functors.compose(afns)({}, cb);
      }
      default:
        return cb(new Error(`Unknown op: ${exp.op}`));
    }
  };
  return (e, cb) => setImmediate(evalExp.bind(null, e, cb));
}

export default run;
export { run };
