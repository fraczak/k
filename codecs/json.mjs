#!/usr/bin/env node

import { withPattern, runCodecCLI } from "./runtime/codec-sdk.mjs";
import { fromJsonValue, toJsonValue, patternFromJsonValue } from "./json-codec.mjs";

export const doc = `
Schema-specializing JSON codec (RFC 8259).

Translates JSON data to/from self-describing enveloped k values where
each JSON document derives a document-specific pattern:
  - objects map to products { field: value, ... }
  - arrays map to indexed products { "0": a0, "1": a1, ... }
  - numbers, strings, booleans, and null map to canonical k values
(See djson.mjs for the universal singleton-pattern dynamic JSON codec.)
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
