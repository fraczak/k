/**
 * Recursive-descent lexer & parser for the kTVM textual DSL (.ktvmp / .ktvm).
 *
 * Implements the exact EBNF grammar from DOCS/KTVM_SPEC.md §9.
 */

import { KTVMSyntaxError, S, createModule } from "./ast.mjs";

const IDENT_START = /[A-Za-z_]/;
const IDENT_CONT = /[A-Za-z0-9_?'-]/;
const DIGIT = /[0-9]/;

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = () => {
    const ch = source[i++];
    if (ch === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    return ch;
  };

  while (i < n) {
    const ch = source[i];
    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }
    // Line comments: -- ... or // ...
    if ((ch === "-" && source[i + 1] === "-") || (ch === "/" && source[i + 1] === "/")) {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }
    // Block comments: /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      const startLine = line;
      const startCol = col;
      advance();
      advance();
      let closed = false;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        throw new KTVMSyntaxError("Unterminated block comment", { line: startLine, col: startCol });
      }
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Multi-char punctuation
    if (ch === "-" && source[i + 1] === ">") {
      advance(); advance();
      tokens.push({ type: "ARROW", value: "->", line: startLine, col: startCol });
      continue;
    }
    if (ch === "=" && source[i + 1] === ">") {
      advance(); advance();
      tokens.push({ type: "FAT_ARROW", value: "=>", line: startLine, col: startCol });
      continue;
    }
    if (ch === "." && source[i + 1] === "." && source[i + 2] === ".") {
      advance(); advance(); advance();
      tokens.push({ type: "ELLIPSIS", value: "...", line: startLine, col: startCol });
      continue;
    }

    // Sigil identifiers: $SCHEMA, @PROC, &TABLE, %VAR
    if (ch === "$" || ch === "@" || ch === "&" || ch === "%") {
      if (ch === "@" && i + 1 < n && DIGIT.test(source[i + 1])) {
        // @INT offset token (used in peek_bits %in, @0, 2)
        advance();
        let num = "";
        while (i < n && DIGIT.test(source[i])) num += advance();
        tokens.push({ type: "AT_INT", value: Number(num), line: startLine, col: startCol });
        continue;
      }
      if (i + 1 < n && IDENT_START.test(source[i + 1])) {
        const sigil = advance();
        let id = "";
        while (i < n && IDENT_CONT.test(source[i])) id += advance();
        const typeMap = { "$": "SCHEMA_ID", "@": "PROC_ID", "&": "TABLE_ID", "%": "VAR_ID" };
        tokens.push({ type: typeMap[sigil], value: sigil + id, line: startLine, col: startCol });
        continue;
      }
      throw new KTVMSyntaxError(`Unexpected sigil '${ch}' without identifier`, { line: startLine, col: startCol });
    }

    // String literal
    if (ch === "\"") {
      advance();
      let str = "";
      let closed = false;
      while (i < n) {
        const c = advance();
        if (c === "\"") {
          closed = true;
          break;
        }
        if (c === "\\") {
          if (i >= n) break;
          const esc = advance();
          switch (esc) {
            case "n": str += "\n"; break;
            case "r": str += "\r"; break;
            case "t": str += "\t"; break;
            case "b": str += "\b"; break;
            case "f": str += "\f"; break;
            case "\\": str += "\\"; break;
            case "\"": str += "\""; break;
            case "u": {
              let hex = "";
              for (let k = 0; k < 4 && i < n; k++) hex += advance();
              if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
                throw new KTVMSyntaxError(`Invalid \\u escape '\\u${hex}'`, { line: startLine, col: startCol });
              }
              str += String.fromCharCode(parseInt(hex, 16));
              break;
            }
            default: str += esc; break;
          }
        } else {
          str += c;
        }
      }
      if (!closed) {
        throw new KTVMSyntaxError("Unterminated string literal", { line: startLine, col: startCol });
      }
      tokens.push({ type: "STRING", value: str, line: startLine, col: startCol });
      continue;
    }

    // Bits literal 0b... or Number (INT / FLOAT)
    if (DIGIT.test(ch)) {
      if (ch === "0" && (source[i + 1] === "b" || source[i + 1] === "B")) {
        advance(); advance();
        let bits = "";
        while (i < n && (source[i] === "0" || source[i] === "1")) bits += advance();
        if (bits.length === 0) {
          throw new KTVMSyntaxError("Empty binary literal 0b", { line: startLine, col: startCol });
        }
        tokens.push({ type: "BITS_LIT", value: bits, line: startLine, col: startCol });
        continue;
      }
      let num = "";
      while (i < n && DIGIT.test(source[i])) num += advance();
      if (source[i] === "." && i + 1 < n && DIGIT.test(source[i + 1])) {
        num += advance();
        while (i < n && DIGIT.test(source[i])) num += advance();
        tokens.push({ type: "FLOAT", value: num, line: startLine, col: startCol });
      } else {
        tokens.push({ type: "INT", value: num, line: startLine, col: startCol });
      }
      continue;
    }

    // Identifier / keyword
    if (IDENT_START.test(ch)) {
      let id = "";
      while (i < n && IDENT_CONT.test(source[i])) {
        // Avoid swallowing '->' as part of identifier
        if (source[i] === "-" && source[i + 1] === ">") break;
        id += advance();
      }
      tokens.push({ type: "IDENT", value: id, line: startLine, col: startCol });
      continue;
    }

    // Single-char punctuation
    const single = "(){}[]:;,=.|/?+-";
    if (single.includes(ch)) {
      advance();
      tokens.push({ type: ch, value: ch, line: startLine, col: startCol });
      continue;
    }

    throw new KTVMSyntaxError(`Unexpected character '${ch}'`, { line: startLine, col: startCol });
  }

  tokens.push({ type: "EOF", value: "", line, col });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
  }

  next() {
    return this.tokens[this.pos++];
  }

  expect(type, value = null) {
    const tok = this.peek();
    if (tok.type !== type || (value !== null && tok.value !== value)) {
      const want = value !== null ? `'${value}'` : type;
      throw new KTVMSyntaxError(`Expected ${want}, got ${tok.type} ('${tok.value}')`, tok);
    }
    return this.next();
  }

  match(type, value = null) {
    const tok = this.peek();
    if (tok.type === type && (value === null || tok.value === value)) {
      return this.next();
    }
    return null;
  }

  parseModule() {
    // header ::= "ktvm" version layer_kind ("entry" PROC_ID)? ";"
    this.expect("IDENT", "ktvm");
    let version;
    if (this.peek().type === "FLOAT") {
      version = this.next().value;
    } else {
      const maj = this.expect("INT").value;
      this.expect(".");
      const min = this.expect("INT").value;
      version = `${maj}.${min}`;
    }
    const layerTok = this.expect("IDENT");
    if (layerTok.value !== "poly" && layerTok.value !== "mono") {
      throw new KTVMSyntaxError(`Expected 'poly' or 'mono', got '${layerTok.value}'`, layerTok);
    }
    let entry = null;
    if (this.match("IDENT", "entry")) {
      entry = this.expect("PROC_ID").value;
    }
    this.expect(";");

    const schemas = [];
    const procs = [];
    const kernels = [];
    const tables = [];

    while (this.peek().type !== "EOF") {
      const kw = this.peek();
      if (kw.type !== "IDENT") {
        throw new KTVMSyntaxError(`Expected top-level declaration, got ${kw.type} ('${kw.value}')`, kw);
      }
      if (kw.value === "schema") schemas.push(this.parseSchemaDecl());
      else if (kw.value === "proc") procs.push(this.parseProcDecl());
      else if (kw.value === "kernel") kernels.push(this.parseKernelDecl());
      else if (kw.value === "table") tables.push(this.parseTableDecl());
      else {
        throw new KTVMSyntaxError(`Unknown top-level keyword '${kw.value}'`, kw);
      }
    }

    return createModule({ version, layer: layerTok.value, entry, schemas, procs, kernels, tables });
  }

  // --- Labels & Schemas ---

  parseLabel() {
    const tok = this.peek();
    if (tok.type === "IDENT" || tok.type === "INT" || tok.type === "STRING" || tok.type === "+" || tok.type === "-") {
      return this.next().value;
    }
    throw new KTVMSyntaxError(`Expected label, got ${tok.type} ('${tok.value}')`, tok);
  }

  parseSchemaParams() {
    const params = [];
    if (this.match("[")) {
      params.push(this.expect("SCHEMA_ID").value);
      while (this.match(",")) {
        params.push(this.expect("SCHEMA_ID").value);
      }
      this.expect("]");
    }
    return params;
  }

  parseSchemaArgs() {
    const args = [];
    if (this.match("[")) {
      args.push(this.parseSchemaExpr());
      while (this.match(",")) {
        args.push(this.parseSchemaExpr());
      }
      this.expect("]");
    }
    return args;
  }

  parseSchemaDecl() {
    this.expect("IDENT", "schema");
    const name = this.expect("SCHEMA_ID").value;
    const params = this.parseSchemaParams();
    this.expect("=");
    const expr = this.parseSchemaExpr();
    this.expect(";");
    return { name, params, expr };
  }

  parseSchemaExpr() {
    const tok = this.peek();
    if (tok.type === "SCHEMA_ID") {
      const name = this.next().value;
      const args = this.parseSchemaArgs();
      return S.ref(name, args);
    }
    if (tok.type === "IDENT") {
      if (tok.value === "unit") {
        this.next();
        return S.unit();
      }
      if (tok.value === "any") {
        this.next();
        return S.any();
      }
      if (tok.value === "product" || tok.value === "union") {
        const kind = this.next().value;
        this.expect("{");
        const fields = this.parseFieldSpecs(false);
        this.expect("}");
        return kind === "product" ? S.product(fields) : S.union(fields);
      }
      if (tok.value === "open_product" || tok.value === "open_union") {
        const kind = this.next().value;
        this.expect("{");
        const fields = this.parseFieldSpecs(true);
        this.expect("}");
        return kind === "open_product" ? S.openProduct(fields) : S.openUnion(fields);
      }
    }
    throw new KTVMSyntaxError(`Expected schema expression, got ${tok.type} ('${tok.value}')`, tok);
  }

  parseFieldSpecs(requireEllipsis) {
    const fields = [];
    let sawEllipsis = false;
    while (this.peek().type !== "}") {
      if (this.match("ELLIPSIS")) {
        sawEllipsis = true;
        this.match(",");
        break;
      }
      const label = this.parseLabel();
      this.expect(":");
      const schema = this.parseSchemaExpr();
      fields.push({ label, schema });
      if (!this.match(",")) {
        if (this.match("ELLIPSIS")) {
          sawEllipsis = true;
          this.match(",");
        }
        break;
      }
    }
    if (requireEllipsis && !sawEllipsis) {
      throw new KTVMSyntaxError("Expected '...' in open_product / open_union", this.peek());
    }
    return fields;
  }

  // --- Procedures (Network Layer) ---

  parsePortList() {
    const ports = [];
    if (this.peek().type === ")") return ports;
    do {
      const name = this.expect("VAR_ID").value;
      this.expect(":");
      const schema = this.parseSchemaExpr();
      ports.push({ name, schema });
    } while (this.match(","));
    return ports;
  }

  parseVarList() {
    const vars = [];
    if (this.peek().type === ")") return vars;
    do {
      vars.push(this.expect("VAR_ID").value);
    } while (this.match(","));
    return vars;
  }

  parseLabeledVars() {
    const fields = [];
    if (this.peek().type === ")") return fields;
    do {
      const label = this.parseLabel();
      this.expect(":");
      const name = this.expect("VAR_ID").value;
      fields.push({ label, name });
    } while (this.match(","));
    return fields;
  }

  parseProcDecl() {
    this.expect("IDENT", "proc");
    const name = this.expect("PROC_ID").value;
    const params = this.parseSchemaParams();
    this.expect("(");
    const inputs = this.parsePortList();
    this.expect(")");
    this.expect("ARROW");
    this.expect("(");
    const outputs = this.parsePortList();
    this.expect(")");

    const attrs = [];
    while (this.peek().type === "IDENT" && ["acyclic", "branching", "total"].includes(this.peek().value)) {
      attrs.push(this.next().value);
    }

    this.expect("{");
    const body = [];
    while (this.peek().type !== "}") {
      body.push(this.parseNetStmt());
    }
    this.expect("}");
    return { name, params, inputs, outputs, attrs, body };
  }

  parseNetStmt() {
    const tok = this.expect("IDENT");
    switch (tok.value) {
      case "chan": {
        const name = this.expect("VAR_ID").value;
        this.expect(":");
        const schema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "chan", name, schema };
      }
      case "barrier": {
        const name = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "barrier", name };
      }
      case "drain": {
        const src = this.expect("VAR_ID").value;
        this.expect(":");
        const schema = this.parseSchemaExpr();
        let barrier = null;
        if (this.match("ARROW")) {
          barrier = this.expect("VAR_ID").value;
        }
        this.expect(";");
        return { op: "drain", src, schema, barrier };
      }
      case "gate": {
        const barrier = this.expect("VAR_ID").value;
        this.expect(",");
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "gate", barrier, src, dst };
      }
      case "splice": {
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "splice", src, dst };
      }
      case "coerce": {
        const src = this.expect("VAR_ID").value;
        this.expect(":");
        const srcSchema = this.parseSchemaExpr();
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(":");
        const dstSchema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "coerce", src, srcSchema, dst, dstSchema };
      }
      case "const_unit": {
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "const_unit", dst };
      }
      case "tee": {
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        this.expect("(");
        const dsts = this.parseVarList();
        this.expect(")");
        this.expect(";");
        return { op: "tee", src, dsts };
      }
      case "wrap": {
        this.expect("|");
        const tag = this.parseLabel();
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "wrap", tag, src, dst };
      }
      case "match": {
        this.expect("/");
        const tag = this.parseLabel();
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "match", tag, src, dst };
      }
      case "demux": {
        const src = this.expect("VAR_ID").value;
        this.expect(":");
        const schema = this.parseSchemaExpr();
        this.expect("ARROW");
        this.expect("(");
        const fields = this.parseLabeledVars();
        this.expect(")");
        this.expect(";");
        return { op: "demux", src, schema, fields };
      }
      case "mux": {
        this.expect("(");
        const fields = this.parseLabeledVars();
        this.expect(")");
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(":");
        const schema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "mux", fields, dst, schema };
      }
      case "project": {
        this.expect(".");
        const field = this.parseLabel();
        const src = this.expect("VAR_ID").value;
        this.expect(":");
        const srcSchema = this.parseSchemaExpr();
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(":");
        const dstSchema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "project", field, src, srcSchema, dst, dstSchema };
      }
      case "guard": {
        this.expect("?");
        const schema = this.parseSchemaExpr();
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "guard", schema, src, dst };
      }
      case "spawn": {
        const target = this.expect("PROC_ID").value;
        const schemaArgs = this.parseSchemaArgs();
        this.expect("(");
        const inputs = this.parseVarList();
        this.expect(")");
        this.expect("ARROW");
        this.expect("(");
        const outputs = this.parseVarList();
        this.expect(")");
        let after = null;
        let token = null;
        if (this.match("IDENT", "after")) {
          after = this.expect("VAR_ID").value;
        }
        if (this.match("IDENT", "as")) {
          token = this.expect("VAR_ID").value;
        }
        this.expect(";");
        return { op: "spawn", target, schemaArgs, inputs, outputs, after, token };
      }
      case "exec": {
        const target = this.expect("PROC_ID").value;
        this.expect("(");
        const inputs = this.parseVarList();
        this.expect(")");
        this.expect("ARROW");
        this.expect("(");
        const outputs = this.parseVarList();
        this.expect(")");
        this.expect(";");
        return { op: "exec", target, inputs, outputs };
      }
      case "switch": {
        this.expect("(");
        const inputs = this.parseVarList();
        this.expect(")");
        this.expect("{");
        const arms = [];
        let defaultBody = null;
        while (this.peek().type !== "}") {
          if (this.match("IDENT", "case")) {
            this.expect("(");
            const patterns = [];
            do {
              if (this.match("/")) {
                patterns.push({ kind: "tag", tag: this.parseLabel() });
              } else {
                this.expect("IDENT", "_");
                patterns.push({ kind: "wildcard" });
              }
            } while (this.match(","));
            this.expect(")");
            this.expect(":");
            this.expect("{");
            const body = [];
            while (this.peek().type !== "}") body.push(this.parseNetStmt());
            this.expect("}");
            arms.push({ patterns, body });
          } else if (this.match("IDENT", "default")) {
            this.expect(":");
            this.expect("{");
            defaultBody = [];
            while (this.peek().type !== "}") defaultBody.push(this.parseNetStmt());
            this.expect("}");
          } else {
            throw new KTVMSyntaxError(`Expected 'case' or 'default' in switch`, this.peek());
          }
        }
        this.expect("}");
        return { op: "switch", inputs, arms, defaultBody };
      }
      case "spec": {
        this.expect("(");
        const inputs = this.parseVarList();
        this.expect(")");
        this.expect("ARROW");
        this.expect("(");
        const outputs = this.parseVarList();
        this.expect(")");
        this.expect("{");
        const branches = [];
        while (this.peek().type !== "}") {
          this.expect("IDENT", "branch");
          const index = Number(this.expect("INT").value);
          this.expect(":");
          this.expect("{");
          const body = [];
          while (this.peek().type !== "}") body.push(this.parseNetStmt());
          this.expect("}");
          branches.push({ index, body });
        }
        this.expect("}");
        return { op: "spec", inputs, outputs, branches };
      }
      default:
        throw new KTVMSyntaxError(`Unknown network instruction '${tok.value}'`, tok);
    }
  }

  // --- Kernels ---

  parseKernelDecl() {
    this.expect("IDENT", "kernel");
    const name = this.expect("PROC_ID").value;
    this.expect("(");
    const inputs = this.parsePortList();
    this.expect(")");
    this.expect("ARROW");
    this.expect("(");
    const outputs = this.parsePortList();
    this.expect(")");

    const attrs = [];
    while (this.peek().type === "IDENT" && ["total", "tmc"].includes(this.peek().value)) {
      attrs.push(this.next().value);
    }

    this.expect("{");
    const regs = [];
    const stacks = [];
    while (this.peek().type === "IDENT" && (this.peek().value === "reg" || this.peek().value === "stack")) {
      if (this.match("IDENT", "reg")) {
        const rname = this.expect("IDENT").value;
        this.expect(":");
        this.expect("IDENT", "enum");
        this.expect("(");
        const states = Number(this.expect("INT").value);
        this.expect(")");
        let init = 0;
        if (this.match("=")) {
          init = Number(this.expect("INT").value);
        }
        this.expect(";");
        regs.push({ name: rname, states, init });
      } else {
        this.expect("IDENT", "stack");
        const sname = this.expect("IDENT").value;
        this.expect(":");
        this.expect("IDENT", "bits");
        this.expect(";");
        stacks.push({ name: sname });
      }
    }

    const blocks = [];
    while (this.peek().type !== "}") {
      blocks.push(this.parseKernelBlock());
    }
    this.expect("}");
    return { name, inputs, outputs, attrs, regs, stacks, blocks };
  }

  parseKernelBlock() {
    const label = this.expect("IDENT").value;
    this.expect(":");
    const stmts = [];
    let term = null;
    while (true) {
      const tok = this.peek();
      if (tok.type === "IDENT" && this._isKernelTerm(tok.value)) {
        term = this.parseKernelTerm();
        break;
      }
      stmts.push(this.parseKernelStmt());
    }
    return { label, stmts, term };
  }

  _isKernelTerm(kw) {
    return (
      kw === "goto" ||
      kw === "retire" ||
      kw === "fail" ||
      kw === "handoff" ||
      kw === "switch_bits" ||
      kw === "switch_reg" ||
      kw === "table_step" ||
      kw === "stack_table_step" ||
      kw === "fsm_table_step"
    );
  }

  parseKernelStmt() {
    if (this.peek().type === "VAR_ID") {
      const dst = this.next().value;
      this.expect("=");
      const op = this.expect("IDENT").value;
      if (op === "peek_bits") {
        const src = this.expect("VAR_ID").value;
        this.expect(",");
        const offset = this.expect("AT_INT").value;
        this.expect(",");
        const width = Number(this.expect("INT").value);
        this.expect("IDENT", "else");
        const onEof = this.expect("IDENT").value;
        this.expect(";");
        return { op: "peek_bits", dst, src, offset, width, onEof };
      }
      if (op === "stack_pop") {
        const stack = this.expect("IDENT").value;
        this.expect(",");
        const width = Number(this.expect("INT").value);
        this.expect("IDENT", "else");
        const onEmpty = this.expect("IDENT").value;
        this.expect(";");
        return { op: "stack_pop", dst, stack, width, onEmpty };
      }
      throw new KTVMSyntaxError(`Expected 'peek_bits' or 'stack_pop' after '='`, this.peek());
    }

    const tok = this.expect("IDENT");
    switch (tok.value) {
      case "shift_bits": {
        const src = this.expect("VAR_ID").value;
        this.expect(",");
        const width = Number(this.expect("INT").value);
        this.expect(";");
        return { op: "shift_bits", src, width };
      }
      case "shift_tag": {
        const src = this.expect("VAR_ID").value;
        this.expect(",");
        const width = Number(this.expect("INT").value);
        this.expect("ARROW");
        const nextSchema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "shift_tag", src, width, nextSchema };
      }
      case "push_bits":
      case "unshift_bits": {
        const dst = this.expect("VAR_ID").value;
        this.expect(",");
        const bits = this.expect("BITS_LIT").value;
        this.expect(",");
        const width = Number(this.expect("INT").value);
        this.expect(";");
        return { op: tok.value, dst, bits, width };
      }
      case "set_reg": {
        const reg = this.expect("IDENT").value;
        this.expect(",");
        const value = Number(this.expect("INT").value);
        this.expect(";");
        return { op: "set_reg", reg, value };
      }
      case "stack_push": {
        const stack = this.expect("IDENT").value;
        this.expect(",");
        const bits = this.expect("BITS_LIT").value;
        this.expect(",");
        const width = Number(this.expect("INT").value);
        this.expect(";");
        return { op: "stack_push", stack, bits, width };
      }
      case "stack_clear": {
        const stack = this.expect("IDENT").value;
        this.expect(";");
        return { op: "stack_clear", stack };
      }
      case "drain_guard": {
        const src = this.expect("VAR_ID").value;
        this.expect(":");
        const schema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "drain_guard", src, schema };
      }
      case "dpda_copy": {
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(":");
        const schema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "dpda_copy", src, dst, schema };
      }
      case "dpda_coerce": {
        const src = this.expect("VAR_ID").value;
        this.expect(":");
        const srcSchema = this.parseSchemaExpr();
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(":");
        const dstSchema = this.parseSchemaExpr();
        this.expect(";");
        return { op: "dpda_coerce", src, srcSchema, dst, dstSchema };
      }
      case "splice": {
        const src = this.expect("VAR_ID").value;
        this.expect("ARROW");
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "splice", src, dst };
      }
      case "close": {
        const dst = this.expect("VAR_ID").value;
        this.expect(";");
        return { op: "close", dst };
      }
      case "yield": {
        const dst = this.expect("VAR_ID").value;
        this.expect(",");
        const threshold = Number(this.expect("INT").value);
        this.expect(";");
        return { op: "yield", dst, threshold };
      }
      default:
        throw new KTVMSyntaxError(`Unknown kernel statement '${tok.value}'`, tok);
    }
  }

  parseExitMap() {
    this.expect("ARROW");
    this.expect("IDENT", "exits");
    this.expect("{");
    const exits = {};
    while (this.peek().type !== "}") {
      const kTok = this.peek();
      let key;
      if (kTok.type === "INT") {
        key = String(Number(this.next().value));
      } else if (kTok.type === "IDENT" && (kTok.value === "short" || kTok.value === "fail")) {
        key = this.next().value;
      } else {
        throw new KTVMSyntaxError(`Expected exit key (int, 'short', or 'fail')`, kTok);
      }
      this.expect(":");
      exits[key] = this.expect("IDENT").value;
      if (!this.match(",")) break;
    }
    this.expect("}");
    return exits;
  }

  parseKernelTerm() {
    const tok = this.expect("IDENT");
    switch (tok.value) {
      case "goto": {
        const target = this.expect("IDENT").value;
        this.expect(";");
        return { op: "goto", target };
      }
      case "retire":
        this.expect(";");
        return { op: "retire" };
      case "fail":
        this.expect(";");
        return { op: "fail" };
      case "handoff": {
        const target = this.expect("PROC_ID").value;
        this.expect("(");
        const inputs = this.parseVarList();
        this.expect(")");
        this.expect("ARROW");
        this.expect("(");
        const outputs = this.parseVarList();
        this.expect(")");
        this.expect(";");
        return { op: "handoff", target, inputs, outputs };
      }
      case "switch_bits": {
        const src = this.expect("VAR_ID").value;
        this.expect("{");
        const cases = [];
        let defaultTarget = null;
        while (this.peek().type !== "}") {
          if (this.match("IDENT", "case")) {
            const bits = this.expect("BITS_LIT").value;
            this.expect(":");
            this.expect("IDENT", "goto");
            const target = this.expect("IDENT").value;
            this.expect(";");
            cases.push({ bits, target });
          } else if (this.match("IDENT", "default")) {
            this.expect(":");
            this.expect("IDENT", "goto");
            defaultTarget = this.expect("IDENT").value;
            this.expect(";");
          } else {
            throw new KTVMSyntaxError("Expected 'case' or 'default' in switch_bits", this.peek());
          }
        }
        this.expect("}");
        return { op: "switch_bits", src, cases, defaultTarget };
      }
      case "switch_reg": {
        const reg = this.expect("IDENT").value;
        this.expect("{");
        const cases = [];
        while (this.peek().type !== "}") {
          this.expect("IDENT", "case");
          const value = Number(this.expect("INT").value);
          this.expect(":");
          this.expect("IDENT", "goto");
          const target = this.expect("IDENT").value;
          this.expect(";");
          cases.push({ value, target });
        }
        this.expect("}");
        return { op: "switch_reg", reg, cases };
      }
      case "table_step": {
        const table = this.expect("TABLE_ID").value;
        this.expect(",");
        const reg = this.expect("IDENT").value;
        this.expect(",");
        this.expect("(");
        const inputs = this.parseVarList();
        this.expect(")");
        this.expect(",");
        this.expect("(");
        const outputs = this.parseVarList();
        this.expect(")");
        const exits = this.parseExitMap();
        this.expect(";");
        return { op: "table_step", table, reg, inputs, outputs, exits };
      }
      case "stack_table_step": {
        const table = this.expect("TABLE_ID").value;
        this.expect(",");
        const reg = this.expect("IDENT").value;
        this.expect(",");
        const input = this.expect("VAR_ID").value;
        this.expect(",");
        const stack = this.expect("IDENT").value;
        this.expect(",");
        const output = this.expect("VAR_ID").value;
        const exits = this.parseExitMap();
        this.expect(";");
        return { op: "stack_table_step", table, reg, input, stack, output, exits };
      }
      case "fsm_table_step": {
        const table = this.expect("TABLE_ID").value;
        this.expect(",");
        const input = this.expect("VAR_ID").value;
        this.expect(",");
        this.expect("(");
        const outputs = this.parseVarList();
        this.expect(")");
        const exits = this.parseExitMap();
        this.expect(";");
        return { op: "fsm_table_step", table, input, outputs, exits };
      }
      default:
        throw new KTVMSyntaxError(`Unknown kernel terminator '${tok.value}'`, tok);
    }
  }

  // --- Static Bit-Chunk Tables ---

  parseTableDecl() {
    this.expect("IDENT", "table");
    const name = this.expect("TABLE_ID").value;
    const kindTok = this.expect("IDENT");
    if (!["chunk_table", "stack_table", "fsm_table"].includes(kindTok.value)) {
      throw new KTVMSyntaxError(`Invalid table kind '${kindTok.value}'`, kindTok);
    }
    this.expect("{");
    const props = {};
    let entries = null;
    let packedBase64 = null;

    while (this.peek().type !== "}") {
      const kTok = this.expect("IDENT");
      if (kTok.value === "entries") {
        this.expect("{");
        entries = [];
        while (this.peek().type !== "}") {
          const idx = Number(this.expect("INT").value);
          this.expect("FAT_ARROW");
          const val = this.parseTableVal();
          this.expect(";");
          entries.push({ index: idx, value: val });
        }
        this.expect("}");
      } else if (kTok.value === "packed_base64") {
        packedBase64 = this.expect("STRING").value;
        this.expect(";");
      } else {
        this.expect(":");
        props[kTok.value] = this.parseTableVal();
        this.expect(";");
      }
    }
    this.expect("}");
    return { name, kind: kindTok.value, props, entries, packedBase64 };
  }

  parseTableVal() {
    const tok = this.peek();
    if (tok.type === "INT") return Number(this.next().value);
    if (tok.type === "FLOAT") return Number(this.next().value);
    if (tok.type === "BITS_LIT") return { bits: this.next().value };
    if (tok.type === "STRING") return this.next().value;
    if (tok.type === "PROC_ID") return { proc: this.next().value };
    if (tok.type === "IDENT") return { ident: this.next().value };
    if (tok.type === "[") {
      this.next();
      const arr = [];
      while (this.peek().type !== "]") {
        arr.push(this.parseTableVal());
        if (!this.match(",")) break;
      }
      this.expect("]");
      return arr;
    }
    if (tok.type === "{") {
      this.next();
      const obj = {};
      while (this.peek().type !== "}") {
        const key = this.expect("IDENT").value;
        this.expect(":");
        obj[key] = this.parseTableVal();
        if (!this.match(",")) break;
      }
      this.expect("}");
      return obj;
    }
    throw new KTVMSyntaxError(`Unexpected token in table value: ${tok.type} ('${tok.value}')`, tok);
  }
}

export function parseModule(source) {
  if (typeof source !== "string") {
    throw new KTVMSyntaxError("parseModule requires a string source");
  }
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseModule();
}
