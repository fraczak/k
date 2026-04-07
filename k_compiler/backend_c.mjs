function cString(value) {
  return JSON.stringify(String(value));
}

function cIdent(value) {
  return String(value).replace(/[^A-Za-z0-9_]/g, "_");
}

function functionName(rel) {
  if (rel.canonicalName) {
    return `kfn_${cIdent(rel.canonicalName.replace(/^@/, ""))}`;
  }
  return `kfn_${cIdent(rel.name)}`;
}

function descriptorLiteral(value) {
  return cString(JSON.stringify(value));
}

function emitExpr(expr, inputExpr, ctx) {
  switch (expr.op) {
    case "RETURN_INPUT": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_return_input(${inputExpr});`);
      return out;
    }
    case "CHECK_CODE": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_guard_code(${inputExpr}, ${cString(expr.typeId)});`);
      return out;
    }
    case "CHECK_TYPE_VAR": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_guard_type_var(${inputExpr}, ${cString(expr.name)});`);
      return out;
    }
    case "CHECK_SHAPE": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_guard_shape(${inputExpr}, ${descriptorLiteral(expr)});`);
      return out;
    }
    case "CALL": {
      const out = ctx.allocOpt();
      const callee = ctx.functionNameBySource[expr.target] || `kfn_missing_${cIdent(expr.target)}`;
      ctx.line(`KOpt ${out} = ${callee}(${inputExpr});`);
      return out;
    }
    case "PROJECT_FIELD": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_project_field(${inputExpr}, ${descriptorLiteral(expr)});`);
      return out;
    }
    case "PROJECT_VARIANT": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_project_variant(${inputExpr}, ${descriptorLiteral(expr)});`);
      return out;
    }
    case "MAKE_VARIANT": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_make_variant(${inputExpr}, ${cString(expr.label)}, ${cString(expr.exactOutputType || "")});`);
      return out;
    }
    case "MAKE_PRODUCT": {
      const fieldValues = expr.fields.map((field, index) => {
        const fieldOpt = emitExpr(field.build, inputExpr, ctx);
        ctx.line(`if (!${fieldOpt}.ok) return krt_fail();`);
        const fieldValue = ctx.allocValue(`field_${index}`);
        ctx.line(`KValue ${fieldValue} = ${fieldOpt}.value;`);
        return { field, fieldValue };
      });
      const labelsArray = ctx.allocArray("field_labels");
      const valuesArray = ctx.allocArray("field_values");
      const labelItems = fieldValues.map(({ field }) => cString(field.label)).join(", ");
      const valueItems = fieldValues.map(({ fieldValue }) => fieldValue).join(", ");
      ctx.line(`static const char *${labelsArray}[] = { ${labelItems} };`);
      ctx.line(`KValue ${valuesArray}[] = { ${valueItems} };`);
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_make_product(${cString(expr.exactOutputType || "")}, ${fieldValues.length}, ${labelsArray}, ${valuesArray});`);
      return out;
    }
    case "SEQ": {
      let currentExpr = inputExpr;
      let currentOpt = null;
      for (const step of expr.steps) {
        currentOpt = emitExpr(step, currentExpr, ctx);
        ctx.line(`if (!${currentOpt}.ok) return krt_fail();`);
        currentExpr = `${currentOpt}.value`;
      }
      return currentOpt;
    }
    case "TRY": {
      const out = ctx.allocOpt();
      ctx.line(`KOpt ${out} = krt_fail();`);
      for (const branch of expr.branches) {
        const branchOpt = emitExpr(branch, inputExpr, ctx);
        ctx.line(`if (${branchOpt}.ok) { ${out} = ${branchOpt}; return ${out}; }`);
      }
      return out;
    }
    default:
      throw new Error(`Unsupported C backend op: ${expr.op}`);
  }
}

function emitFunction(rel, ctx) {
  const fnName = functionName(rel);
  const lines = [];
  const fnCtx = {
    functionNameBySource: ctx.functionNameBySource,
    tempIndex: 0,
    arrayIndex: 0,
    line(text = "") {
      lines.push(`  ${text}`);
    },
    allocOpt() {
      this.tempIndex += 1;
      return `tmp_${this.tempIndex}`;
    },
    allocValue(prefix = "value") {
      this.tempIndex += 1;
      return `${prefix}_${this.tempIndex}`;
    },
    allocArray(prefix = "array") {
      this.arrayIndex += 1;
      return `${prefix}_${this.arrayIndex}`;
    },
  };

  lines.push(`KOpt ${fnName}(KValue input) {`);
  const resultOpt = emitExpr(rel.body, "input", fnCtx);
  lines.push(`  return ${resultOpt};`);
  lines.push("}");
  return lines.join("\n");
}

function emitTypeMetadata(registryMetadata) {
  const lines = [];
  for (const typeId of Object.keys(registryMetadata.types).sort()) {
    const type = registryMetadata.types[typeId];
    const constName = `k_type_${cIdent(typeId.replace(/^@/, ""))}`;
    lines.push(`static const char ${constName}[] = ${cString(typeId)};`);
  }
  return lines.join("\n");
}

function compileToC(irModule) {
  const functionNameBySource = Object.keys(irModule.functions).reduce((result, sourceName) => {
    result[sourceName] = functionName(irModule.functions[sourceName]);
    return result;
  }, {});

  const functionDecls = Object.values(irModule.functions)
    .map((rel) => `KOpt ${functionName(rel)}(KValue input);`)
    .join("\n");

  const functionDefs = Object.values(irModule.functions)
    .map((rel) => emitFunction(rel, { functionNameBySource }))
    .join("\n\n");

  return [
    "/* Generated by k compiler C backend (prototype). */",
    "#include \"runtime.h\"",
    "",
    emitTypeMetadata(irModule.registryMetadata),
    "",
    functionDecls,
    "",
    functionDefs,
    "",
    `KOpt k_entry(KValue input) { return ${functionNameBySource[irModule.entryRelation]}(input); }`,
    "",
  ].join("\n");
}

export { compileToC };
export default { compileToC };
