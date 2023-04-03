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
      break;
    case "vector":
      const [arg1, arg2] = [code1, code2].map(
        ({ vector }) => representatives[vector] || vector
      );
      if (arg1 !== arg2) return true;
  }
  return false;
}

function minimize(codes) {
  const names = Object.keys(codes);
  const classes = {};
  classes["{}"] = names;
  const representatives = names.reduce((representatives, name) => {
    representatives[name] = "{}";
    return representatives;
  }, {});
  let changed = true;
  while (changed) {
    changed = false;
    for (const name1 in classes) {
      const [eq_names, dif_names] = classes[name1].reduce(
        ([eq_names, dif_names], name2) => {
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
          normalized[name] = { code: code.code };
          normalized[name][code.code] = normalize(
            code[code.code],
            representatives
          );
          break;
        case "vector":
          normalized[name] = {
            code: "vector",
            vector: representatives[code.vector] || code.vector,
          };
      }
    }

    return normalized;
  }, {});
}

export default { minimize, normalize, normalizeAll };
export { minimize, normalize, normalizeAll };
