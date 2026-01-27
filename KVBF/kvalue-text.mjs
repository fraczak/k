import { Product, Variant } from "../TypedValue.mjs";

const nameRE = /^[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*$/;

function formatLabel(label) {
  return nameRE.test(label) ? `${label}` : `${JSON.stringify(label)}`;
}

function sortLabels(labels) {
  return labels.slice().sort((a, b) => {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

function formatValueNative(value) {
  if (value instanceof Product) {
    const labels = sortLabels(Object.keys(value.product));
    if (labels.length === 0) return "{}";
    const fields = labels.map((label) => {
      const child = value.product[label];
      return `${formatValueNative(child)} ${formatLabel(label)}`;
    });
    return `{${fields.join(", ")}}`;
  }

  if (value instanceof Variant) {
    return `${formatValueNative(value.value)}|${formatLabel(value.tag)}`;
  }

  throw new Error("Unsupported value for native formatting");
}

function formatTypedLiteral(typedValue) {
  return `${typedValue.type} ${formatValueNative(typedValue.value)}`;
}

function formatTypedProgram(typedValue) {
  return `${formatValueNative(typedValue.value)} $ ${typedValue.type}`;
}

function formatTypedProgramWithType(typedValue, registry, typeFormat = "hash") {
  if (typeFormat === "hash") {
    return formatTypedProgram(typedValue);
  }
  if (typeFormat === "canonical") {
    const entry = registry[typedValue.type];
    if (!entry || !entry.def) {
      throw new Error(`Missing canonical definition for type ${typedValue.type}`);
    }
    return `${entry.def}\n${formatValueNative(typedValue.value)} $C0`;
  }
  throw new Error(`Unknown type format: ${typeFormat}`);
}

export {
  formatLabel,
  formatTypedLiteral,
  formatTypedProgram,
  formatTypedProgramWithType,
  formatValueNative,
};
