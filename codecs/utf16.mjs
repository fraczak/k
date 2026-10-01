#!/usr/bin/env node

import { withPattern, runCodecCLI } from "./runtime/codec-sdk.mjs";
import {
  STRING_PATTERN_PROPERTY_LIST,
  textToStringValue,
  stringValueToText
} from "./string-codec.mjs";

export const doc = `
UTF-16 text codec (BOM-aware).

Reads UTF-16 text (LE/BE with BOM or LE without BOM), outputs UTF-16LE with BOM.
`;

function decodeUtf16Input(buf) {
  if (!buf || buf.length === 0) return "";

  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const src = buf.subarray(2);
    if (src.length % 2 !== 0) throw new Error("UTF-16BE payload has odd byte length");
    const le = Buffer.alloc(src.length);
    for (let i = 0; i < src.length; i += 2) {
      le[i] = src[i + 1];
      le[i + 1] = src[i];
    }
    return le.toString("utf16le");
  }

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const src = buf.subarray(2);
    if (src.length % 2 !== 0) throw new Error("UTF-16LE payload has odd byte length");
    return src.toString("utf16le");
  }

  if (buf.length % 2 !== 0) throw new Error("UTF-16 input without BOM has odd byte length");
  return buf.toString("utf16le");
}

function encodeUtf16Output(text) {
  const bomLe = Buffer.from([0xff, 0xfe]);
  return Buffer.concat([bomLe, Buffer.from(text, "utf16le")]);
}

export function parse(input) {
  const text = Buffer.isBuffer(input) ? decodeUtf16Input(input) : String(input);
  return withPattern(textToStringValue(text), STRING_PATTERN_PROPERTY_LIST);
}

export function print(value) {
  const text = stringValueToText(value);
  return encodeUtf16Output(text);
}

runCodecCLI(import.meta.url, { parse, print, doc, readBuffer: true, addNewline: false });
