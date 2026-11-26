/**
 * Canonical pretty-printer for kTVM AST modules (.ktvmp / .ktvm).
 *
 * Guarantees exact round-trip idempotency with parser.mjs (`parseModule(printModule(ast))`).
 */

const BARE_LABEL = /^(?:[A-Za-z_][A-Za-z0-9_?'-]*|[0-9]+|[+-])$/;

function formatLabel(label) {
  if (BARE_LABEL.test(label) && !label.includes("->")) {
    return label;
  }
  return JSON.stringify(label);
}

export function printSchemaExpr(expr) {
  switch (expr.kind) {
    case "unit":
      return "unit";
    case "any":
      return "any";
    case "ref":
      if (expr.args && expr.args.length > 0) {
        return `${expr.name}[${expr.args.map(printSchemaExpr).join(", ")}]`;
      }
      return expr.name;
    case "product":
    case "union": {
      if (!expr.fields || expr.fields.length === 0) return `${expr.kind} {}`;
      const parts = expr.fields.map((f) => `${formatLabel(f.label)}: ${printSchemaExpr(f.schema)}`);
      return `${expr.kind} { ${parts.join(", ")} }`;
    }
    case "open_product":
    case "open_union": {
      const parts = (expr.fields || []).map((f) => `${formatLabel(f.label)}: ${printSchemaExpr(f.schema)}`);
      parts.push("...");
      return `${expr.kind} { ${parts.join(", ")} }`;
    }
    default:
      throw new Error(`Unknown schema expr kind: ${expr.kind}`);
  }
}

function printPorts(ports) {
  return (ports || []).map((p) => `${p.name}: ${printSchemaExpr(p.schema)}`).join(", ");
}

function printLabeledVars(fields) {
  return (fields || []).map((f) => `${formatLabel(f.label)}: ${f.name}`).join(", ");
}

function printNetStmt(stmt, indent) {
  const pad = "  ".repeat(indent);
  switch (stmt.op) {
    case "chan":
      return `${pad}chan ${stmt.name} : ${printSchemaExpr(stmt.schema)};`;
    case "barrier":
      return `${pad}barrier ${stmt.name};`;
    case "drain":
      return `${pad}drain ${stmt.src} : ${printSchemaExpr(stmt.schema)}${stmt.barrier ? ` -> ${stmt.barrier}` : ""};`;
    case "gate":
      return `${pad}gate ${stmt.barrier}, ${stmt.src} -> ${stmt.dst};`;
    case "splice":
      return `${pad}splice ${stmt.src} -> ${stmt.dst};`;
    case "coerce":
      return `${pad}coerce ${stmt.src} : ${printSchemaExpr(stmt.srcSchema)} -> ${stmt.dst} : ${printSchemaExpr(stmt.dstSchema)};`;
    case "const_unit":
      return `${pad}const_unit -> ${stmt.dst};`;
    case "tee":
      return `${pad}tee ${stmt.src} -> (${stmt.dsts.join(", ")});`;
    case "wrap":
      return `${pad}wrap |${formatLabel(stmt.tag)} ${stmt.src} -> ${stmt.dst};`;
    case "match":
      return `${pad}match /${formatLabel(stmt.tag)} ${stmt.src} -> ${stmt.dst};`;
    case "demux":
      return `${pad}demux ${stmt.src} : ${printSchemaExpr(stmt.schema)} -> (${printLabeledVars(stmt.fields)});`;
    case "mux":
      return `${pad}mux (${printLabeledVars(stmt.fields)}) -> ${stmt.dst} : ${printSchemaExpr(stmt.schema)};`;
    case "project":
      return `${pad}project .${formatLabel(stmt.field)} ${stmt.src} : ${printSchemaExpr(stmt.srcSchema)} -> ${stmt.dst} : ${printSchemaExpr(stmt.dstSchema)};`;
    case "guard":
      return `${pad}guard ?${printSchemaExpr(stmt.schema)} ${stmt.src} -> ${stmt.dst};`;
    case "spawn": {
      const sargs = stmt.schemaArgs && stmt.schemaArgs.length > 0
        ? `[${stmt.schemaArgs.map(printSchemaExpr).join(", ")}]`
        : "";
      const aft = stmt.after ? ` after ${stmt.after}` : "";
      const tok = stmt.token ? ` as ${stmt.token}` : "";
      return `${pad}spawn ${stmt.target}${sargs}(${stmt.inputs.join(", ")}) -> (${stmt.outputs.join(", ")})${aft}${tok};`;
    }
    case "exec":
      return `${pad}exec ${stmt.target}(${stmt.inputs.join(", ")}) -> (${stmt.outputs.join(", ")});`;
    case "switch": {
      const lines = [`${pad}switch (${stmt.inputs.join(", ")}) {`];
      for (const arm of stmt.arms) {
        const pats = arm.patterns.map((p) => (p.kind === "tag" ? `/${formatLabel(p.tag)}` : "_"));
        lines.push(`${pad}  case (${pats.join(", ")}): {`);
        for (const s of arm.body) lines.push(printNetStmt(s, indent + 2));
        lines.push(`${pad}  }`);
      }
      if (stmt.defaultBody) {
        lines.push(`${pad}  default: {`);
        for (const s of stmt.defaultBody) lines.push(printNetStmt(s, indent + 2));
        lines.push(`${pad}  }`);
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "spec": {
      const lines = [`${pad}spec (${stmt.inputs.join(", ")}) -> (${stmt.outputs.join(", ")}) {`];
      for (const br of stmt.branches) {
        lines.push(`${pad}  branch ${br.index}: {`);
        for (const s of br.body) lines.push(printNetStmt(s, indent + 2));
        lines.push(`${pad}  }`);
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    default:
      throw new Error(`Unknown net stmt op: ${stmt.op}`);
  }
}

function printKernelStmt(stmt, indent) {
  const pad = "  ".repeat(indent);
  switch (stmt.op) {
    case "peek_bits":
      return `${pad}${stmt.dst} = peek_bits ${stmt.src}, @${stmt.offset}, ${stmt.width} else ${stmt.onEof};`;
    case "shift_bits":
      return `${pad}shift_bits ${stmt.src}, ${stmt.width};`;
    case "shift_tag":
      return `${pad}shift_tag ${stmt.src}, ${stmt.width} -> ${printSchemaExpr(stmt.nextSchema)};`;
    case "push_bits":
    case "unshift_bits":
      return `${pad}${stmt.op} ${stmt.dst}, 0b${stmt.bits}, ${stmt.width};`;
    case "set_reg":
      return `${pad}set_reg ${stmt.reg}, ${stmt.value};`;
    case "stack_push":
      return `${pad}stack_push ${stmt.stack}, 0b${stmt.bits}, ${stmt.width};`;
    case "stack_pop":
      return `${pad}${stmt.dst} = stack_pop ${stmt.stack}, ${stmt.width} else ${stmt.onEmpty};`;
    case "stack_clear":
      return `${pad}stack_clear ${stmt.stack};`;
    case "drain_guard":
      return `${pad}drain_guard ${stmt.src} : ${printSchemaExpr(stmt.schema)};`;
    case "dpda_copy":
      return `${pad}dpda_copy ${stmt.src} -> ${stmt.dst} : ${printSchemaExpr(stmt.schema)};`;
    case "dpda_coerce":
      return `${pad}dpda_coerce ${stmt.src} : ${printSchemaExpr(stmt.srcSchema)} -> ${stmt.dst} : ${printSchemaExpr(stmt.dstSchema)};`;
    case "splice":
      return `${pad}splice ${stmt.src} -> ${stmt.dst};`;
    case "close":
      return `${pad}close ${stmt.dst};`;
    case "yield":
      return `${pad}yield ${stmt.dst}, ${stmt.threshold};`;
    default:
      throw new Error(`Unknown kernel stmt op: ${stmt.op}`);
  }
}

function printExitMap(exits) {
  const entries = Object.entries(exits).map(([k, v]) => `${k}: ${v}`);
  return `exits { ${entries.join(", ")} }`;
}

function printKernelTerm(term, indent) {
  const pad = "  ".repeat(indent);
  switch (term.op) {
    case "goto":
      return `${pad}goto ${term.target};`;
    case "retire":
      return `${pad}retire;`;
    case "fail":
      return `${pad}fail;`;
    case "handoff":
      return `${pad}handoff ${term.target}(${term.inputs.join(", ")}) -> (${term.outputs.join(", ")});`;
    case "switch_bits": {
      const lines = [`${pad}switch_bits ${term.src} {`];
      for (const c of term.cases) {
        lines.push(`${pad}  case 0b${c.bits}: goto ${c.target};`);
      }
      if (term.defaultTarget) {
        lines.push(`${pad}  default: goto ${term.defaultTarget};`);
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "switch_reg": {
      const lines = [`${pad}switch_reg ${term.reg} {`];
      for (const c of term.cases) {
        lines.push(`${pad}  case ${c.value}: goto ${c.target};`);
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "table_step":
      return `${pad}table_step ${term.table}, ${term.reg}, (${term.inputs.join(", ")}), (${term.outputs.join(", ")}) -> ${printExitMap(term.exits)};`;
    case "stack_table_step":
      return `${pad}stack_table_step ${term.table}, ${term.reg}, ${term.input}, ${term.stack}, ${term.output} -> ${printExitMap(term.exits)};`;
    case "fsm_table_step":
      return `${pad}fsm_table_step ${term.table}, ${term.input}, (${term.outputs.join(", ")}) -> ${printExitMap(term.exits)};`;
    default:
      throw new Error(`Unknown kernel term op: ${term.op}`);
  }
}

function printTableVal(val) {
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(printTableVal).join(", ")}]`;
  if (val && typeof val === "object") {
    if ("bits" in val) return `0b${val.bits}`;
    if ("proc" in val) return val.proc;
    if ("ident" in val) return val.ident;
    const entries = Object.entries(val).map(([k, v]) => `${k}: ${printTableVal(v)}`);
    return `{ ${entries.join(", ")} }`;
  }
  throw new Error(`Unsupported table value: ${val}`);
}

export function printModule(mod) {
  const sections = [];
  const entryPart = mod.entry ? ` entry ${mod.entry}` : "";
  sections.push(`ktvm ${mod.version || "0.1"} ${mod.layer}${entryPart};`);

  if (mod.schemas && mod.schemas.length > 0) {
    const lines = mod.schemas.map((s) => {
      const params = s.params && s.params.length > 0 ? `[${s.params.join(", ")}]` : "";
      return `schema ${s.name}${params} = ${printSchemaExpr(s.expr)};`;
    });
    sections.push(lines.join("\n"));
  }

  for (const proc of mod.procs || []) {
    const params = proc.params && proc.params.length > 0 ? `[${proc.params.join(", ")}]` : "";
    const attrs = proc.attrs && proc.attrs.length > 0 ? ` ${proc.attrs.join(" ")}` : "";
    const lines = [`proc ${proc.name}${params}(${printPorts(proc.inputs)}) -> (${printPorts(proc.outputs)})${attrs} {`];
    for (const stmt of proc.body) lines.push(printNetStmt(stmt, 1));
    lines.push("}");
    sections.push(lines.join("\n"));
  }

  for (const k of mod.kernels || []) {
    const attrs = k.attrs && k.attrs.length > 0 ? ` ${k.attrs.join(" ")}` : "";
    const lines = [`kernel ${k.name}(${printPorts(k.inputs)}) -> (${printPorts(k.outputs)})${attrs} {`];
    for (const r of k.regs || []) {
      const init = r.init ? ` = ${r.init}` : "";
      lines.push(`  reg ${r.name} : enum(${r.states})${init};`);
    }
    for (const st of k.stacks || []) {
      lines.push(`  stack ${st.name} : bits;`);
    }
    for (const blk of k.blocks || []) {
      lines.push(`  ${blk.label}:`);
      for (const s of blk.stmts) lines.push(printKernelStmt(s, 2));
      lines.push(printKernelTerm(blk.term, 2));
    }
    lines.push("}");
    sections.push(lines.join("\n"));
  }

  for (const t of mod.tables || []) {
    const lines = [`table ${t.name} ${t.kind} {`];
    for (const [k, v] of Object.entries(t.props || {})) {
      lines.push(`  ${k}: ${printTableVal(v)};`);
    }
    if (t.entries) {
      lines.push("  entries {");
      for (const row of t.entries) {
        lines.push(`    ${row.index} => ${printTableVal(row.value)};`);
      }
      lines.push("  }");
    } else if (t.packedBase64 != null) {
      lines.push(`  packed_base64 ${JSON.stringify(t.packedBase64)};`);
    }
    lines.push("}");
    sections.push(lines.join("\n"));
  }

  return `${sections.join("\n\n")}\n`;
}
