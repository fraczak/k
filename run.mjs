const modulo = (a, b) => ((+a % (b = +b)) + b) % b;

const valid = (x) => (isNaN(x) ? undefined : x);

const builtin = {
  "_log!": function (arg) {
    console.error(`_log!: ${JSON.stringify(arg)}`);
    return arg;
  },
  GT: function (args) {
    var _, ok;
    [ok, _] = (function ([last, ...args]) {
      return args.reduce(
        function ([ok, last], x) {
          return [ok && last > x, x];
        },
        [true, last]
      );
    })(args);
    if (ok) {
      return args;
    }
  },
  EQ: function (args) {
    var _, ok;
    [ok, _] = (function ([last, ...args]) {
      return args.reduce(
        function ([ok, last], x) {
          return [ok && last === x, x];
        },
        [true, last]
      );
    })(args);
    if (ok) {
      return args;
    }
  },
  PLUS: function (args) {
    return valid(
      args.reduce(function (res, x) {
        return res + x;
      }, 0)
    );
  },
  TIMES: function (args) {
    return valid(
      args.reduce(function (res, x) {
        return res * x;
      }, 1)
    );
  },
  DIV: function ([x, y]) {
    var div, rem;
    div = Math.floor(x / y);
    rem = modulo(x, y);
    if (x === div * y + rem) {
      return { div, rem };
    }
  },
  FDIV: function ([x, y]) {
    return x / y;
  },
  CONCAT: function (strs) {
    return strs.join("");
  },
  true: function () {
    return true;
  },
  false: function () {
    return false;
  },
  null: function () {
    return null;
  },
  toJSON: function (x) {
    return JSON.stringify(x);
  },
  fromJSON: function (x) {
    return JSON.parse(x);
  },
  CONS: function ([x, y]) {
    return [x, ...y];
  },
  SNOC: function (x) {
    if (x.length > 1) {
      return [x[0], x.slice(1)];
    }
  },
  toDateMsec: function (x) {
    return new Date(x).getTime();
  },
  toDateStr: function (x) {
    return new Date(x).toISOString();
  },
};

const codes = {
  int: function (x) {
    return Number.isInteger(x);
  },
  string: function (x) {
    return x instanceof String || "string" === typeof x;
  },
  bool: function (x) {
    return x === true || x === false;
  },
};

const verify = function (code, value) {
  if (code == null) {
    // representatives = run.defs.representatives
    // defCodes = JSON.stringify run.defs.codes
    // console.log {code,value, representatives, defCodes}
    return false;
  }
  switch (code.code) {
    case "vector":
      if (!Array.isArray(value)) {
        return false;
      }
      return value.every(function (x) {
        return verify(code.vector, x);
      });
    case "product":
      if ("object" !== typeof value) {
        return false;
      }
      return (function (fields) {
        if (fields.length !== Object.keys(code.product).length) {
          return false;
        }
        return fields.every(function (label) {
          return verify(code.product[label], value[label]);
        });
      })(Object.keys(value));
    case "union":
      if ("object" !== typeof value) {
        return false;
      }
      return (function (fields) {
        if (fields.length !== 1) {
          return false;
        }
        return verify(code.union[fields[0]], value[fields[0]]);
      })(Object.keys(value));
    default:
      return (function (c) {
        if (c != null) {
          return verify(c, value);
        }
        return codes[code](value);
      })(run.defs.codes[run.defs.representatives[code]]);
  }
};

const run = function (exp, value) {
  "use strict";
  var defn, e, i, j, k, label, len, len1, len2, r, ref, ref1, ref2, result;
  if (value === void 0) {
    // console.log {exp,value}
    return void 0;
  }
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
      defn = run.defs.rels[exp.ref];
      if (defn != null) {
        return run(defn[defn.length - 1], value);
      }
      return builtin[exp.ref](value);
    case "dot":
      return value[exp.dot];
    case "comp":
      return exp.comp.reduce(function (value, exp) {
        if (value !== void 0) {
          return run(exp, value);
        }
      }, value);
    case "union":
      ref = exp.union;
      for (i = 0, len = ref.length; i < len; i++) {
        e = ref[i];
        result = run(e, value);
        if (result !== void 0) {
          return result;
        }
      }
      return void 0;
    case "vector":
      result = [];
      ref1 = exp.vector;
      for (j = 0, len1 = ref1.length; j < len1; j++) {
        e = ref1[j];
        r = run(e, value);
        if (r === void 0) {
          return;
        }
        result.push(r);
      }
      return result;
    case "product":
      result = {};
      ref2 = exp.product;
      for (k = 0, len2 = ref2.length; k < len2; k++) {
        ({ label, exp } = ref2[k]);
        r = run(exp, value);
        if (r === void 0) {
          return;
        }
        result[label] = r;
      }
      return result;
    default:
      return console.error(exp.op);
  }
};

export default run;
export { run };
