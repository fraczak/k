/**
 * Public API for @fraczak/k's kTVM (Transducer Virtual Machine) backend.
 */

export {
  KTVM_FORMAT,
  KTVM_VERSION,
  KTVMSyntaxError,
  KTVMValidationError,
  KTVMSchemaError,
  KTVMQuotaError,
  S,
  createModule,
  cloneAst,
  moduleToJSON,
  moduleFromJSON,
  packInt32Base64,
  unpackInt32Base64
} from "./ast.mjs";

export { parseModule, tokenize } from "./parser.mjs";
export { printModule, printSchemaExpr } from "./printer.mjs";

export {
  compareLabels,
  isClosedSchemaKind,
  isClosedPlist,
  substituteSchemaExpr,
  compileSchemaExprToPlist,
  canonicalizePlistOrder,
  subPlist,
  mooreMinimize,
  mooreKey,
  schemasEquivalent,
  isUnitSchema,
  unionTagInfo,
  unionOrdinalInfo,
  productFields,
  productFieldInfo,
  plistToSchemaAst,
  unifyContractWithConcrete,
  intersectSchemas
} from "./schema.mjs";

export {
  CHAN_STATUS,
  QuotaTracker,
  BitDeque,
  BitStack
} from "./bit-deque.mjs";

export {
  DPDA_RESULT,
  encodePayloadToDeque,
  decodeDequeToValue,
  writeBytesToDeque,
  dequeToPaddedBytes,
  splitEnvelopedWire,
  frameEnvelopedWire,
  encodeValueToEnvelopedWire,
  decodeEnvelopedWireToValue,
  createDpdaSkip,
  stepDpdaSkip,
  createDpdaCopy,
  stepDpdaCopy,
  createDpdaCoerce,
  stepDpdaCoerce
} from "./wire.mjs";

export {
  validateModule,
  verifyTableBisimulation
} from "./validator.mjs";

export {
  specializeKTVM,
  clearSpecializationCache
} from "./specialize.mjs";

export {
  KTVMRuntime,
  executeKTVM,
  executeKTVMWire
} from "./vm.mjs";
