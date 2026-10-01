#!/usr/bin/env node

import { Value, isProduct, withPattern, patternFromFilter, runCodecCLI } from "./runtime/codec-sdk.mjs";

export const doc = `
Unit codec for {}.

Translates the empty product {} to/from binary pattern+value stream.
`;

const UNIT_PATTERN = patternFromFilter("?{}");

export function parse() {
  return withPattern(Value.product({}), UNIT_PATTERN);
}

export function print(value) {
  if (!isProduct(value) || Object.keys(value.product).length !== 0) {
    throw new Error("Input is not a unit value");
  }
  return "{}";
}

runCodecCLI(import.meta.url, { parse, print, doc });

export {
  UNIT_PATTERN
};
