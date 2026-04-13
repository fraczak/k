/**
 * Value I/O with Type Information
 * 
 * This module wraps the valueParser to support explicit type information.
 * 
 * Migration strategy (2 steps):
 * - Step 1 (current): Add type parameter to all parseValue calls, but keep text parsing
 * - Step 2 (future): Replace implementation to use binary codec
 */

import { parse as parseValueText } from "./valueParser.mjs";
import { Value, fromObject } from "./Value.mjs";

/**
 * Parse a value from text with optional type information
 * 
 * @param {string} text - JSON-like text representation
 * @param {string|null} typeName - Canonical type name (e.g., "@ABC123...")
 * @param {Object|null} typeInfo - Type definition (for validation/future use)
 * @returns {Value} - Product or Variant
 * 
 * Step 1: Type parameters are accepted but not yet used
 * Step 2: Will validate against type and eventually parse binary format
 */
export function parseValue(text, typeName = null, typeInfo = null) {
  // Step 1: Ignore type for now, just parse text as before
  // TODO Step 2: Validate parsed value against typeInfo if provided
  return parseValueText(text);
}

/**
 * Serialize a value to text
 * 
 * @param {Value} value - Product or Variant
 * @param {string|null} typeName - Canonical type name (optional)
 * @param {Object|null} typeInfo - Type definition (optional)
 * @returns {string} - JSON representation
 * 
 * Step 1: Returns JSON, ignoring type
 * Step 2: Will encode to binary format
 */
export function printValue(value, typeName = null, typeInfo = null) {
  // Step 1: Just serialize to JSON as before
  // TODO Step 2: Encode to binary format using codec
  return JSON.stringify(value);
}

/**
 * Convert JavaScript object to k Value
 * (No change needed - this is type-agnostic)
 */
export { fromObject } from "./Value.mjs";

export default { parseValue, printValue, fromObject };
