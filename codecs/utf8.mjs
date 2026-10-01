#!/usr/bin/env node

import { withPattern, runCodecCLI } from "./runtime/codec-sdk.mjs";
import {
  STRING_PATTERN_PROPERTY_LIST,
  textToStringValue,
  stringValueToText
} from "./string-codec.mjs";

export const doc = `
UTF-8 text codec.

Encodes/decodes text strings to/from the canonical k string pattern.
`;

export function parse(text) {
  const value = textToStringValue(text);
  return withPattern(value, STRING_PATTERN_PROPERTY_LIST);
}

export function print(value) {
  return stringValueToText(value);
}

runCodecCLI(import.meta.url, { parse, print, doc, addNewline: false });
