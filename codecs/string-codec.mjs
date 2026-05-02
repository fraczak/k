import { NODE_KIND } from "./runtime/codec.mjs";
import { decodeWire, encodeToWire } from "./runtime/prefix-codec.mjs";
import { patternToPropertyList } from "./runtime/pattern-json.mjs";
import { textToStringValue, stringValueToText } from "./runtime/unicode-string.mjs";

const STRING_PATTERN = {
  dictionary: [
    "0", "1", "10",
    "ascii", "bmp_common", "bmp_private_use",
    "car", "cdr", "cons",
    "h08_0F", "h10_7F", "h80_CF", "hD0_D7", "hE0_EF", "hF0_F7", "hF8", "hF9", "hFA_FB", "hFC_FD", "hFE_FF",
    "hi",
    "lo",
    "mid",
    "nil",
    "p02_03", "p04_07", "p08_0F", "p10",
    "plane", "plane0",
    "supplementary_plane1", "supplementary_planes2_16",
    "2", "3", "4", "5", "6", "7", "8", "9"
  ],
  nodes: [
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "nil", target: 1 }, { label: "cons", target: 2 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "car", target: 3 }, { label: "cdr", target: 0 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [
      { label: "ascii", target: 4 },
      { label: "plane0", target: 6 },
      { label: "bmp_common", target: 7 },
      { label: "bmp_private_use", target: 10 },
      { label: "supplementary_plane1", target: 12 },
      { label: "supplementary_planes2_16", target: 13 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 },
      { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "0", target: 1 }, { label: "1", target: 1 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "10", target: 5 }, { label: "9", target: 5 }, { label: "8", target: 5 }, { label: "7", target: 5 },
      { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 }, { label: "3", target: 5 },
      { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "hi", target: 8 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [
      { label: "h08_0F", target: 15 }, { label: "h10_7F", target: 16 }, { label: "h80_CF", target: 16 },
      { label: "hD0_D7", target: 15 }, { label: "hF9", target: 1 },
      { label: "hFA_FB", target: 17 }, { label: "hFC_FD", target: 17 }, { label: "hFE_FF", target: 17 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "7", target: 5 }, { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 },
      { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "hi", target: 11 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "hE0_EF", target: 18 }, { label: "hF0_F7", target: 15 }, { label: "hF8", target: 1 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "mid", target: 9 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "plane", target: 14 }, { label: "mid", target: 9 }, { label: "lo", target: 9 } ] },
    { kind: NODE_KIND.CLOSED_UNION, edges: [ { label: "p02_03", target: 17 }, { label: "p04_07", target: 19 }, { label: "p08_0F", target: 15 }, { label: "p10", target: 1 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [
      { label: "6", target: 5 }, { label: "5", target: 5 }, { label: "4", target: 5 },
      { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 }
    ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "0", target: 5 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "3", target: 5 }, { label: "2", target: 5 }, { label: "1", target: 5 }, { label: "0", target: 5 } ] },
    { kind: NODE_KIND.CLOSED_PRODUCT, edges: [ { label: "1", target: 5 }, { label: "0", target: 5 } ] }
  ]
};

const STRING_PATTERN_PROPERTY_LIST = patternToPropertyList(STRING_PATTERN);

function encodeText(text) {
  return encodeToWire(textToStringValue(text), STRING_PATTERN_PROPERTY_LIST);
}

function decodeText(buffer) {
  const { value } = decodeWire(buffer);
  return stringValueToText(value);
}

export { STRING_PATTERN, STRING_PATTERN_PROPERTY_LIST, textToStringValue, stringValueToText, encodeText, decodeText };
