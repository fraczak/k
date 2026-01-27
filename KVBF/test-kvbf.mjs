import fs from "node:fs";
import { parse } from "../typedValueParser.mjs";
import { decodeKVBF, encodeKVBF } from "./kvbf.mjs";

const registry = JSON.parse(fs.readFileSync("type_registry/registry.json", "utf8"));

const input = `@ERx5FFwYBEeKrLTVQn9NcNJJ8ymExRpnLV5jGQrw3nDx { c: 0, x: {"1": {"0": {"_": {}}}}, y: {"1": {"0": {"_": {}}}} }`;

const typedValue = parse(input);
const encodedBnat = encodeKVBF(typedValue, registry, { idEncoding: "bnat" });
const decodedBnat = decodeKVBF(encodedBnat, registry, { idEncoding: "bnat" });

if (decodedBnat.toString() !== typedValue.toString()) {
  throw new Error("KVBF round-trip failed for bnat back-reference encoding");
}

const encodedUleb = encodeKVBF(typedValue, registry, { idEncoding: "uleb128" });
const decodedUleb = decodeKVBF(encodedUleb, registry, { idEncoding: "uleb128" });

if (decodedUleb.toString() !== typedValue.toString()) {
  throw new Error("KVBF round-trip failed for uleb128 back-reference encoding");
}

console.log("KVBF round-trip ok");
