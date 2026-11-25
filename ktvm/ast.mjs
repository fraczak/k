/**
 * kTVM AST definitions, canonical JSON artifact conversion, and error types.
 *
 * Implements the dual canonical representation specified in DOCS/KTVM_SPEC.md §9:
 *   - Shared AST manipulated by parser, printer, validator, specializer, and VM
 *   - 1-to-1 JSON artifact (`format: "k-tvm"`, `version: 1`)
 */

export const KTVM_FORMAT = "k-tvm";
export const KTVM_VERSION = 1;

export class KTVMSyntaxError extends SyntaxError {
  constructor(message, { line = 1, col = 1 } = {}) {
    super(`${message} (at ${line}:${col})`);
    this.name = "KTVMSyntaxError";
    this.line = line;
    this.col = col;
  }
}

export class KTVMValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(`kTVM validation failed:\n  - ${list.join("\n  - ")}`);
    this.name = "KTVMValidationError";
    this.errors = list;
  }
}

export class KTVMSchemaError extends TypeError {
  constructor(message) {
    super(`SchemaError: ${message}`);
    this.name = "KTVMSchemaError";
  }
}

export class KTVMQuotaError extends RangeError {
  constructor(kind, limit, observed) {
    super(`QuotaError: ${kind} limit exceeded (${observed} > ${limit})`);
    this.name = "KTVMQuotaError";
    this.quotaKind = kind;
    this.limit = limit;
    this.observed = observed;
  }
}

// --- Schema AST Constructors ---

export const S = {
  unit: () => ({ kind: "unit" }),
  any: () => ({ kind: "any" }),
  product: (fields = []) => ({ kind: "product", fields }),
  openProduct: (fields = []) => ({ kind: "open_product", fields }),
  union: (fields = []) => ({ kind: "union", fields }),
  openUnion: (fields = []) => ({ kind: "open_union", fields }),
  ref: (name, args = []) => ({ kind: "ref", name, args })
};

export function createModule({
  version = "0.1",
  layer = "mono",
  entry = null,
  schemas = [],
  procs = [],
  kernels = [],
  tables = []
} = {}) {
  return {
    format: KTVM_FORMAT,
    formatVersion: KTVM_VERSION,
    version,
    layer,
    entry,
    schemas,
    procs,
    kernels,
    tables
  };
}

export function cloneAst(node) {
  return structuredClone(node);
}

/**
 * Export a kTVM module AST to its canonical JSON artifact (`format: "k-tvm"`).
 */
export function moduleToJSON(mod) {
  return {
    format: KTVM_FORMAT,
    formatVersion: KTVM_VERSION,
    version: mod.version || "0.1",
    layer: mod.layer,
    entry: mod.entry ?? null,
    schemas: cloneAst(mod.schemas || []),
    procs: cloneAst(mod.procs || []),
    kernels: cloneAst(mod.kernels || []),
    tables: cloneAst(mod.tables || [])
  };
}

/**
 * Hydrate a canonical `format: "k-tvm"` JSON artifact back into a kTVM module AST.
 */
export function moduleFromJSON(obj) {
  if (!obj || typeof obj !== "object") {
    throw new Error("Invalid k-tvm JSON artifact: expected object");
  }
  if (obj.format !== KTVM_FORMAT) {
    throw new Error(`Invalid k-tvm JSON artifact format: ${obj.format}`);
  }
  if (obj.formatVersion !== KTVM_VERSION) {
    throw new Error(`Unsupported k-tvm formatVersion: ${obj.formatVersion}`);
  }
  if (obj.layer !== "poly" && obj.layer !== "mono") {
    throw new Error(`Invalid k-tvm layer: ${obj.layer}`);
  }
  return createModule({
    version: obj.version || "0.1",
    layer: obj.layer,
    entry: obj.entry ?? null,
    schemas: cloneAst(obj.schemas || []),
    procs: cloneAst(obj.procs || []),
    kernels: cloneAst(obj.kernels || []),
    tables: cloneAst(obj.tables || [])
  });
}

/**
 * Encode/decode dense integer arrays for `packed_base64` table blocks (little-endian Int32).
 */
export function packInt32Base64(int32Array) {
  const arr = int32Array instanceof Int32Array ? int32Array : Int32Array.from(int32Array);
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  return Buffer.from(bytes).toString("base64");
}

export function unpackInt32Base64(base64Str) {
  const buf = Buffer.from(base64Str, "base64");
  if ((buf.byteLength & 3) !== 0) {
    throw new Error(`Invalid packed_base64 Int32 byte length: ${buf.byteLength}`);
  }
  const out = new Int32Array(buf.byteLength / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = buf.readInt32LE(i * 4);
  }
  return out;
}
