import assert from "assert";

const modulo = (a, b) => ((+a % (b = +b)) + b) % b;
const valid = (x) => (isNaN(x) ? undefined : x);

class SetValue {
  constructor(open = false) {
    this.isOpen = () => open;
    this.isClosed = () => !open;
    this.items = {};
  }

  add(value) {
    const key = JSON.stringify(value);
    this.items[key] = value;
    return this;
  }

  size() {
    return Object.keys(this.items).length;
  }

  values() {
    return Object.values(this.items);
  }

  toJSON() {
    if (this.isOpen()) {
     return {OPEN_SET: Object.values(this.items)};
    }
    return {SET: Object.values(this.items)};
  }
}

function isSetAndOpen(x) {
  return (x instanceof SetValue) && x.isOpen();
}

function isSetAndClosed(x) {
  return (x instanceof SetValue) && x.isClosed();
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
  CONS: ([x, y]) => { try { return [x, ...y]; } catch (e) { return undefined; } },
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
    case "set": 
      if (isSetAndClosed(value)) {
        return value.values().every((x) =>
          verify(code.set, x)
        );
      }
      return false;
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
    if (isSetAndOpen(value)) {
      if (exp.op === "caret") {
        const result = new SetValue();
        for (const v of value.values()) {
          result.add(v);
        }
        return result;
      } else {
        const result = new SetValue(true);
        for (const v of value.values()) {
          const r = run(exp, v);
          if (r !== undefined) result.add(r);
        }
        return result;
      }
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
        assert(isSetAndClosed(value), "PIPE (|): value must be a closed set");
        const result = new SetValue(true);
        for (const v of value.values()) {
          result.add(v);
        }
        return result;
      }
      case "at":
        assert(isSetAndClosed(value), "AT (@): value must be a closed set");
        return value.values();
      case "comp":
        for (let i = 0, len = exp.comp.length - 1; i < len; i++) {
          const result = run(exp.comp[i], value);
          if (result === undefined) return;
          value = result;
        }
        exp = exp.comp[exp.comp.length - 1];
        continue;
      case "union":
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
        let resultIsOpenSet = false;
        for (let i = 0, len = exp.vector.length; i < len; i++) {
          const r = run(exp.vector[i], value);
          if (r === undefined) return;
          if (resultIsOpenSet) {
            if (isSetAndOpen(r)) {
              let newResult = new SetValue(true);
              for (const v of r.values()) {
                for (const x of result.values()) {
                  newResult.add([...x, v]);
                }
              }
              result = newResult;
            } else {
              let newResult = new SetValue(true);
              for (const x of result.values()) {
                newResult.add([...x, r]);
              }
              result = newResult;
            } 
          } else {
            if (isSetAndOpen(r)) {
              resultIsOpenSet = true;
              let newResult = new SetValue(true);
              for (const v of r.values()) {
                newResult.add([...result, v]);
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
        let resultIsOpenSet = false;
        for (let i = 0, len = exp.product.length; i < len; i++) {
          const { label, exp: e } = exp.product[i];
          const r = run(e, value);
          if (r === undefined) return;
          if (resultIsOpenSet) {
            if (isSetAndOpen(r)) {
              let newResult = new SetValue(true);
              for (const v of r.values()) {
                for (const x of result.values()) {
                  newResult.add({...x, [label]: v});
                }
              }
              result = newResult;
            } else {
              let newResult = new SetValue(true);
              for (const x of result.values()) {
                newResult.add({...x, [label]: r});
              }
              result = newResult;
            } 
          } else {
            if (isSetAndOpen(r)) {
              resultIsOpenSet = true;
              let newResult = new SetValue(true);
              for (const v of r.values()) {
                newResult.add({...result, [label]: v});
              }
              result = newResult;
            } else {
              result[label] = r;
            }
          }      
        }
        return result
      }
      case "set": {
        const result = new SetValue();
        for (let i = 0, len = exp.set.length; i < len; i++) {
          const r = run(exp.set[i], value);
          if (r === undefined) continue;
          if (isSetAndOpen(r)) {
            for (const v of r.values()) {
              result.add(v);
            }
          } else {
            result.add(r);
          }
        }
        return result;
      }  
      default:
        assert(false,`Unknown operation: '${exp.op}'`);
    }
  };
}

export default run;
export { run };
