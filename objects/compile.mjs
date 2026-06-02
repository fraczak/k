#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { argv, exit, stdin, stdout } from "node:process";
import {
  compileObjectBuffer,
  compileLibraryBuffer,
  decodeObject,
  loadLibrary
} from "../object.mjs";
import { lowerToKVM } from "../kvm.mjs";
import { annotate } from "../index.mjs";

function helpText() {
  return [
    "Compile a k source, .ko, or .klib into .ko, .klib, or .kvm output.",
    "Output format is inferred from the output file extension, or from --format.",
    "",
    `Usage: ${argv[1]} [options] [input-file [output-file]]`,
    "",
    "Arguments:",
    "  input-file   Source .k, .ko, or .klib file. Reads UTF-8 source from stdin when omitted.",
    "  output-file  Output path (.ko, .klib, or .kvm). Writes to stdout when omitted.",
    "",
    "Options:",
    "  --lib file       Load a .klib dependency before compiling. May be repeated.",
    "  --export spec    Export a library alias into the source scope. May be repeated.",
    "                   spec is 'name' or 'libname:localname'.",
    "  --format fmt     Output format: ko, klib, or kvm. Overrides extension detection.",
    "  -h, --help       Show this help.",
    "",
    "When input is .ko or .klib and output is .kvm, the object's relations are",
    "lowered to kVM. For .klib input producing .ko or .kvm, a k expression for",
    "'main' must be supplied via --main or appended to the .klib as trailing source.",
    "",
    "Examples:",
    `  ${argv[1]} program.k program.ko`,
    `  ${argv[1]} program.k program.klib`,
    `  ${argv[1]} program.k program.kvm`,
    `  ${argv[1]} program.ko program.kvm`,
    `  ${argv[1]} --lib core.klib --export add --export mul:times program.k program.ko`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

async function readStdinBytes() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function inferFormat(outputPath) {
  if (!outputPath) return "ko";
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === ".klib") return "klib";
  if (ext === ".kvm") return "kvm";
  return "ko";
}

function inferInputType(inputPath) {
  if (!inputPath) return "k";
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".ko") return "ko";
  if (ext === ".klib") return "klib";
  return "k";
}

function buildExportPreamble(exports, libraries) {
  if (exports.length === 0) return "";
  // Build a combined alias map from all libraries: name -> @hash
  const aliasMap = {};
  for (const lib of libraries) {
    for (const [name, hash] of Object.entries(lib.relAlias || {})) {
      if (name !== "__main__") aliasMap[name] = hash;
    }
    for (const [hash, entry] of Object.entries(lib.meta || {})) {
      if (entry?.type !== "rel") continue;
      for (const origin of entry?.origins || []) {
        if (origin?.name && origin.name !== "__main__") {
          aliasMap[origin.name] = hash;
        }
      }
    }
  }
  const lines = [];
  for (const spec of exports) {
    const [libName, localName] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
    const hash = aliasMap[libName];
    if (!hash) throw new Error(`--export: '${libName}' not found in loaded libraries`);
    const body = hash.startsWith("@") ? hash.slice(1) : hash;
    lines.push(`${localName} = @${body};`);
  }
  return lines.join("\n") + "\n";
}

function compileToKVM(source, options) {
  const defs = annotate(source, options);
  const kvmProgram = {};
  for (const [name, relDef] of Object.entries(defs.rels)) {
    kvmProgram[name] = lowerToKVM(relDef, name);
  }
  return JSON.stringify(kvmProgram, null, 2) + "\n";
}

function objectToKVM(object) {
  const kvmProgram = {};
  for (const [name, relDef] of Object.entries(object.rels)) {
    kvmProgram[name] = lowerToKVM(relDef, name);
  }
  return JSON.stringify(kvmProgram, null, 2) + "\n";
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  const libraries = [];
  let format = null;
  const exports = [];

  while (args.length > 0 && args[0].startsWith("-")) {
    if (args[0] === "--lib") {
      args.shift();
      const libPath = args.shift();
      if (!libPath) throw new Error("--lib requires a file argument");
      libraries.push(loadLibrary(decodeObject(fs.readFileSync(libPath))));
    } else if (args[0] === "--export") {
      args.shift();
      const spec = args.shift();
      if (!spec) throw new Error("--export requires a spec argument (name or libname:localname)");
      exports.push(spec);
    } else if (args[0] === "--format") {
      args.shift();
      format = args.shift();
      if (!["ko", "klib", "kvm"].includes(format))
        throw new Error(`Unknown format: ${format}. Use ko, klib, or kvm.`);
    } else {
      throw new Error(`Unknown option: ${args[0]}`);
    }
  }

  const inputPath = args.shift() || null;
  const outputPath = args.shift() || null;
  const outputFormat = format || inferFormat(outputPath);
  const inputType = inferInputType(inputPath);

  let output;

  if (inputType === "ko" || inputType === "klib") {
    const buffer = inputPath == null ? await readStdinBytes() : fs.readFileSync(inputPath);
    const object = decodeObject(buffer);
    if (inputType === "klib") {
      libraries.push(loadLibrary(object));
    }

    if (outputFormat === "kvm") {
      if (inputType === "klib") {
        throw new Error("Cannot produce .kvm from .klib alone; use a .ko or .k input.");
      }
      output = objectToKVM(object);
    } else if (outputFormat === "ko") {
      if (inputType === "ko") {
        // already a .ko, just copy
        output = buffer;
      } else {
        throw new Error("Cannot produce .ko from .klib without a main expression; provide .k source instead.");
      }
    } else if (outputFormat === "klib") {
      if (inputType === "klib") {
        output = buffer;
      } else {
        throw new Error("Cannot produce .klib from .ko; provide .k source instead.");
      }
    }
  } else {
    // Input is .k source
    const rawSource = inputPath == null
      ? (await readStdinBytes()).toString("utf8")
      : fs.readFileSync(inputPath, "utf8");
    const preamble = buildExportPreamble(exports, libraries);
    const source = preamble + rawSource;
    const opts = { source: inputPath || "<stdin>", libraries };

    if (outputFormat === "ko") {
      output = compileObjectBuffer(source, opts);
    } else if (outputFormat === "klib") {
      output = compileLibraryBuffer(source, opts);
    } else if (outputFormat === "kvm") {
      output = compileToKVM(source, opts);
    }
  }

  if (outputPath == null) {
    stdout.write(output);
  } else {
    fs.writeFileSync(outputPath, output);
  }
} catch (error) {
  console.error(error.message || String(error));
  usage();
  exit(1);
}
