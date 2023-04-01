
const compareAs = function(fn) {
    return function(a, b) {
      [a, b] = [a, b].map(fn);
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    };
  };

  const
  nameRE = /^[a-zA-Z0-9_][a-zA-Z0-9_?!]*$/;

const  prettyCode_labels = function(codes, representatives, label_ref_map) {
    var labels;
    return labels = Object.keys(label_ref_map).sort(compareAs(function(x) {
      return x;
    })).map(function(label) {
      var plabel;
      plabel = nameRE.test(label) ? label : `'${label}'`;
      return `${prettyCode(codes, representatives, {
        code: "ref",
        ref: label_ref_map[label]
      })} ${plabel}`;
    }).join(", ");
  };

const  prettyCode = function(codes, representatives, codeExp) {
    var name, ref, ref1;
    switch (codeExp.code) {
      case "ref":
        name = (ref = representatives[codeExp.ref]) != null ? ref : codeExp.ref;
        if (name.startsWith(":")) {
          return prettyCode(codes, representatives, codes[name]);
        } else {
          return name;
        }
        break;
      case "product":
        return `{${prettyCode_labels(codes, representatives, codeExp.product)}}`;
      case "union":
        return `<${prettyCode_labels(codes, representatives, codeExp.union)}>`;
      case "vector":
        return `[${(ref1 = representatives[codeExp.vector]) != null ? ref1 : codeExp.vector}]`;
      default:
        return ":error";
    }
  };

const  prettyRel = function(prettyCode, exp) {
    "use strict";
    var pretty;
    pretty = function(exp) {
      switch (exp.op) {
        case 'vector':
          return `[${exp.vector.map(pretty).join(", ")}]`;
        case 'union':
          return `<${exp.union.map(pretty).join(", ")}>`;
        case 'ref':
          return exp.ref;
        case 'identity':
          return "()";
        case 'comp':
          return exp.comp.map(pretty).join(" ");
        case 'str':
          return `'${exp.str}'`;
        case 'int':
          return exp.int;
        case 'dot':
          if ('number' === typeof exp.dot) {
            return `.${exp.dot}`;
          } else if (nameRE.test(exp.dot)) {
            return `.${exp.dot}`;
          } else {
            return `'${exp.dot}'`;
          }
          break;
        case 'code':
          return `$${prettyCode({
            code: "ref",
            ref: exp.code
          })}`;
        case 'product':
          return (function(labelled) {
            return `{${labelled.join(", ")}}`;
          })(exp.product.map(function({label, exp}) {
            if (nameRE.test(label)) {
              return `${pretty(exp)} ${label}`;
            } else {
              return `${pretty(exp)} '${label}'`;
            }
          }));
      }
    };
    return pretty(exp);
  };

export default {prettyCode, prettyRel};
export {prettyCode, prettyRel};