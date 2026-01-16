import hash from "./hash.mjs";

const theRepository = { codes: {  } };

const unitCode = function() {
  const unitCodeDef = encodeCodeToString("{}", { "{}": { code: "product", product: [] } });
  return hash(unitCodeDef);
}();

theRepository.codes[unitCode] = { code: "product", product: {} };

function encodeCodeToString(code, codes = theRepository.codes) {
  let i = 0;
  const Q = [[code,i]];
  const D = {[code]: i++};
  let result=[];
  while (Q.length > 0) {
    const [x,c] = Q.shift();
    const c_code = codes[x];
    const u_args =  Object.keys(c_code[c_code.code]).sort().map((k) => {
      const u_arg = c_code[c_code.code][k];
      if (D[u_arg] === undefined) {
        Q.push([u_arg,i]);
        D[u_arg] = i++;
      }
      return `C${D[u_arg]}${JSON.stringify(k)}`;
    });
    if (c_code.code == "union") {
      //result += `$${c}=<${u_args.join(",")}>;`;
      result.push(`$C${result.length}=<${u_args.join(",")}>;`);
    } else if (c_code.code == "product") {
      //result += `$${c}={${u_args.join(",")}};`;
      result.push(`$C${result.length}={${u_args.join(",")}};`);
    } else {
      throw new Error(`Unexpected code ${c_code.code}`);
    }
  }
  return result.join("");
};

function are_different(classes, representatives, name1, name2, codes) {
  if (name1 === name2) return false;
  const code1 = codes[name1];
  const code2 = codes[name2];
  if (code1.code !== code2.code) return true;
  switch (code1.code) {
    case "union":
    case "product":
      const [fields1, fields2] = [code1, code2].map((code) => {
        const arg = code[code.code];
        return Object.keys(arg).reduce((fields, label) => {
          const ref = representatives[arg[label]];
          fields[label] = ref != null ? ref : arg[label];
          return fields;
        }, {});
      });
      if (Object.keys(fields1).length !== Object.keys(fields2).length)
        return true;

      for (const field in fields1) {
        if (fields2[field] !== fields1[field]) return true;
      }
  }
  return false;
}

function minimize(codes) {
  const names = Object.keys(codes);
  const classes = {};
  classes[unitCode] = names;
  const representatives = names.reduce((representatives, name) => {
    representatives[name] = unitCode;
    return representatives;
  }, {});
  let changed = true;
  while (changed) {
    changed = false;
    for (const name1 in classes) {
      const [eq_names, dif_names] = classes[name1].reduce(
        ([eq_names, dif_names], name2) => {
          // console.log(JSON.stringify({classes,codes,representatives,name1,name2},null,2));
          if (are_different(classes, representatives, name1, name2, codes)) {
            dif_names.push(name2);
          } else {
            eq_names.push(name2);
          }
          return [eq_names, dif_names];
        },
        [[], []]
      );
      classes[name1] = eq_names;

      if (dif_names.length > 0) {
        const new_rep = dif_names[0];
        changed = true;
        classes[new_rep] = dif_names;
        dif_names.forEach((name) => (representatives[name] = new_rep));
      }
    }
  }

  return { classes, representatives };
}

function resolveRefs(codes) {
  const resolved = {};
  
  for (const name in codes) {
    const code = codes[name];
    if (code.code === "ref" && code.ref.startsWith("@")) {
      // This is an alias to a canonical type (by name or by hash)
      const refName = code.ref.substring(1); // Remove the @ prefix
      
      // Check if it's a reference to a user-defined type in the current codes
      if (codes[refName] !== undefined) {
        resolved[name] = refName;
      } 
      // Check if it's a reference to an existing canonical hash in the repository
      else if (theRepository.codes[code.ref] !== undefined) {
        resolved[name] = code.ref;
      } 
      else {
        throw new Error(`Type alias references undefined type: ${code.ref}`);
      }
    } else {
      resolved[name] = name;
    }
  }
  
  return resolved;
}

function normalize(label_ref_map, representatives) {
  return Object.keys(label_ref_map).reduce((result, label) => {
    const name = label_ref_map[label];
    result[label] = representatives[name] || name;
    return result;
  }, {});
}

function normalizeAll(codes, representatives) {
  return Object.keys(codes).reduce(function (normalized, name) {
    if (name === representatives[name]) {
      const code = codes[name];
      switch (code.code) {
        case "union":
        case "product":
          normalized[name] = { ...code };
          normalized[name][code.code] = normalize(
            code[code.code],
            representatives
          );
          break;
        case "ref":
          // Ref codes should have been resolved in finalize, this shouldn't happen
          throw new Error(`Unresolved type alias: ${code.ref}`);
        default:
          throw new Error(`Unexpected code ${code.code}`);
      }
    }

    return normalized;
  }, {});
}

function finalize(codes) {
  // First, resolve all @name references to their actual code definitions
  const refResolution = resolveRefs(codes);
  const resolvedCodes = {};
  
  for (const name in codes) {
    const code = codes[name];
    if (code.code === "ref" && code.ref.startsWith("@")) {
      // This is an alias, use the resolved target's code
      const target = refResolution[name];
      
      // Check if target is a canonical hash (starts with @)
      if (target.startsWith("@")) {
        // Reference to existing canonical hash in repository
        resolvedCodes[name] = theRepository.codes[target];
      } else {
        // Reference to a user-defined type in current codes
        resolvedCodes[name] = codes[target];
      }
    } else {
      resolvedCodes[name] = code;
    }
  }
  
  const representatives = minimize(resolvedCodes).representatives;
  
  // Also update representatives to account for aliases
  // If name was aliased to target, and target maps to rep, then name should map to rep
  for (const name in refResolution) {
    if (refResolution[name] !== name) {
      const target = refResolution[name];
      representatives[name] = representatives[target];
    }
  }
  
  const normalizedCodes = normalizeAll(resolvedCodes, representatives);
  const globalNames = Object.keys(normalizedCodes).reduce((globalNames, name) => {
    const globalDef = encodeCodeToString(name, normalizedCodes);
    normalizedCodes[name].def = globalDef;
    globalNames[name] = hash(globalDef);
    return globalNames;
  }, {});
  const globalCodes = Object.keys(normalizedCodes).reduce((globalCodes, name) => {
    globalCodes[globalNames[name]] = normalizedCodes[name];
    return globalCodes;
  },{});
  // console.log("globalCodes",globalCodes);

  const extendedRepresentatives = Object.keys(representatives).reduce((result, name) => {
    result[name] = globalNames[representatives[name]] || name;
    return result;
  }, Object.values(globalNames).reduce((result, name) => ({[name]: name, ...result}),{}));
  // console.log("extendedRepresentatives",extendedRepresentatives);

  const normalizedGlobalCodes = normalizeAll(globalCodes, extendedRepresentatives);
  // console.log("normalizedGlobalCodes",normalizedGlobalCodes);

  return {
    codes: normalizedGlobalCodes,
    representatives: extendedRepresentatives
  };
}

function register(newCodes) {
  const { codes, representatives } = finalize( {...theRepository.codes,...newCodes});
  const reps = Object.values(representatives).reduce((reps,rep) => 
    ({...reps, [rep]:rep})
  , {});
  for (const rep in reps) {
    theRepository.codes[rep] = codes[rep];
  };
  return representatives;
}

function find(codeName) {
  return JSON.parse(JSON.stringify(theRepository.codes[codeName] || {code: "undefined"}));
};

function load(dump) {
  theRepository.codes = dump;
}

function dump() {
  return JSON.parse(JSON.stringify(theRepository.codes));
}

export default { minimize, normalize, normalizeAll, encodeCodeToString, finalize, unitCode, register, find, load, dump };
export { minimize, normalize, normalizeAll, encodeCodeToString, finalize, unitCode, register, find, load, dump };
