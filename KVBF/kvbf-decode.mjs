#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { decodeKVBF } from "./kvbf.mjs";
import { formatTypedProgramWithType } from "./kvalue-text.mjs";

function parseArgs(argv) {
  const args = { registry: "type_registry/registry.json", idEncoding: "bnat", typeFormat: "hash" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--registry" && i + 1 < argv.length) {
      args.registry = argv[++i];
    } else if (arg === "--id-encoding" && i + 1 < argv.length) {
      args.idEncoding = argv[++i];
    } else if (arg === "--type-format" && i + 1 < argv.length) {
      args.typeFormat = argv[++i];
    } else if (arg === "--in" && i + 1 < argv.length) {
      args.input = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      args.output = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (!args.input) {
      args.input = arg;
    } else if (!args.output) {
      args.output = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: kvbf-decode [--registry <path>] [--id-encoding bnat|uleb128] [--type-format hash|canonical] [--in <file>] [--out <file>]",
    "  If --in/--out are omitted, stdin/stdout are used.",
  ].join("\n");
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const registryPath = path.resolve(args.registry);
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const inputBuffer = args.input ? fs.readFileSync(args.input) : fs.readFileSync(0);
const typedValue = decodeKVBF(inputBuffer, registry, { idEncoding: args.idEncoding });
const outputText = `${formatTypedProgramWithType(typedValue, registry, args.typeFormat)}\n`;

if (args.output) {
  fs.writeFileSync(args.output, outputText, "utf8");
} else {
  fs.writeFileSync(1, outputText, "utf8");
}
