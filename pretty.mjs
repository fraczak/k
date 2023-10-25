function compareAs(fn) {
  return function (a, b) {
    [a, b] = [a, b].map(fn);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };
}

const nameRE = /^[a-zA-Z0-9_][a-zA-Z0-9_?!]*$/;

function prettyCode_labels (codes, representatives, label_ref_map) {
  return Object.keys(label_ref_map)
    .sort( compareAs((x) => x) )
    .map( (label) => {
      const plabel = nameRE.test(label) ? label : `'${label}'`;
      return `${prettyCode(codes, representatives, {
        code: "ref",
        ref: label_ref_map[label],
      })} ${plabel}`;
    })
    .join(", ");
};

function prettyCode (codes, representatives, codeExp) {
  switch (codeExp.code) {
    case "ref":
      const name = representatives[codeExp.ref] || codeExp.ref;
      if (name.startsWith(":")) {
        return prettyCode(codes, representatives, codes[name]);
      } else {
        return name;
      }
    case "product":
      return `{${prettyCode_labels(codes, representatives, codeExp.product)}}`;
    case "union":
      return `< ${prettyCode_labels(codes, representatives, codeExp.union)} >`;
    case "vector":
      return `[${prettyCode(codes,representatives, {code:'ref', ref:codeExp.vector})}]`;
      // return `[${representatives[codeExp.vector] || codeExp.vector}]`;
    case "set":
      return `<< ${prettyCode(codes,representatives, {code:'ref', ref:codeExp.set})} >>`;
      // return `<< ${representatives[codeExp.set] || codeExp.set} >>`;
    default:
      return ":error";
  }
};

function prettyRel (prettyCode, exp) {
  "use strict";
  const pretty = (exp) => {
    switch (exp.op) {
      case "vector":
        return `[${exp.vector.map(pretty).join(", ")}]`;
      case "union":
        return `< ${exp.union.map(pretty).join(", ")} >`;
      case "ref":
        return exp.ref;
      case "identity":
        return "()";
      case "comp":
        return exp.comp.map(pretty).join(" ");
      case "str":
        return `'${exp.str}'`;
      case "int":
        return exp.int;
      case "dot":
        if ("number" === typeof exp.dot) {
          return `.${exp.dot}`;
        } else if (nameRE.test(exp.dot)) {
          return `.${exp.dot}`;
        } else {
          return `'${exp.dot}'`;
        }
        break;
      case "set":
        return `<< ${exp.set.map(pretty).join(", ")} >>`;
      case "pipe":
        return "|";
      case "aggregate":
        return '@';
      case "code":
        return `$${prettyCode({
          code: "ref",
          ref: exp.code,
        })}`;
      case "product":
        return (function (labelled) {
          return `{${labelled.join(", ")}}`;
        })(
          exp.product.map(function ({ label, exp }) {
            if (nameRE.test(label)) {
              return `${pretty(exp)} ${label}`;
            } else {
              return `${pretty(exp)} '${label}'`;
            }
          })
        );
    }
  };
  return pretty(exp);
};

export default { prettyCode, prettyRel };
export { prettyCode, prettyRel };
