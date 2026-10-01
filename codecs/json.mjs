#!/usr/bin/env node

import { withPattern, runCodecCLI } from "./runtime/codec-sdk.mjs";
import { fromJsonValue, toJsonValue, patternFromJsonValue } from "./json-codec.mjs";

export const doc = `
JSON codec (RFC 8259).

Translates JSON data to/from self-describing enveloped k values.
`;

export function parse(text) {
  const json = JSON.parse(text);
  const value = fromJsonValue(json);
  const pattern = patternFromJsonValue(json);
  return withPattern(value, pattern);
}

export function print(value) {
  return JSON.stringify(toJsonValue(value));
}

runCodecCLI(import.meta.url, { parse, print, doc });
