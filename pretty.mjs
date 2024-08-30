import { find } from "./codes.mjs";

function compareAs(fn) {
  return function (a, b) {
    [a, b] = [a, b].map(fn);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };
}

const nameRE = /^[a-zA-Z0-9_][a-zA-Z0-9_?!]*$/;

function prettyCode_labels (representatives, label_ref_map) {
  return Object.keys(label_ref_map)
    .sort( compareAs((x) => x) )
    .map( (label) => {
      const plabel = nameRE.test(label) ? label : `'${label}'`;
      return `${prettyCode(representatives, {
        code: "ref",
        ref: label_ref_map[label],
      })} ${plabel}`;
    })
    .join(", ");
};

function prettyCode (representatives, codeExp) {
  switch (codeExp.code) {
    case "ref":
      const name = representatives[codeExp.ref] || codeExp.ref;
      if (name.startsWith(":")) {
        return prettyCode(representatives, find(name));
      } else {
        return name;
      }
    case "product":
      return `{${prettyCode_labels(representatives, codeExp.product)}}`;
    case "union":
      return `< ${prettyCode_labels(representatives, codeExp.union)} >`;
    case "vector":
      return `[${prettyCode(representatives, {code:'ref', ref:codeExp.vector})}]`;
      // return `[${representatives[codeExp.vector] || codeExp.vector}]`;
    default:
      return ":error";
  }
};

function prettyFilter (prettyCode, filter) {
  const fieldsStr = (f) => 
    Object.keys(f.fields).map( (key) => 
      `${key}: ${prettyFilter(prettyCode, f.fields[key])}` 
    ).join(", ") + (f.open ? ", ..." : ""); 
  switch (filter.type) {
    case "name":
      return filter.name;
    case "code":
      return `$${prettyCode({
          code: "ref",
          ref: filter.code,
        })}`;
    case "vector":
      return `[${prettyFilter(prettyCode, filter.vector)}]`;
    case null:
      return `(${fieldsStr(filter)})`;
    case "union":
      return `<${fieldsStr(filter)}>`;
    case "product":
      return `{${fieldsStr(filter)}}`;
  }
  throw new Error("unreachable");
}

function prettyRel (prettyCode, exp) {
  "use strict";
  const pretty = (exp) => {
    switch (exp.op) {
      case "filter":
        return `?${prettyFilter(prettyCode, exp.filter)}`;
      case "pipe":
        return `|`;        
      case "caret":
        return `(${pretty(exp.caret)} ^)`;        
      case "vector":
        return `[${exp.vector.map(pretty).join(", ")}]`;
      case "union":
        return `<${exp.union.map(pretty).join(", ")}>`;
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
