#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import k from "./index.mjs";
import {
  decodeWire,
  encodeToWire
} from "./codecs/runtime/prefix-codec.mjs";
import {
  compileLibrary,
  decodeObject,
  objectToFunction,
  loadLibrary,
  buildExportPreamble
} from "./object.mjs";

let kScript, inputStream;

function helpText() {
  const prog = argv[1] || "k.mjs";
  return [
    "Compile and execute a k expression or file over a binary",
    "pattern+value wire stream using the JavaScript interpreter.",
    "",
    `Usage: ${prog} [options]`,
    "       ( source-snippet | input-file ) [ input-wire-file ]",
    "",
    "Arguments:",
    "  source-snippet   Inline k source snippet.",
    "  input-file       Source .k, .ko, or .klib file.",
    "  input-wire-file  Optional binary wire input (default: stdin).",
    "",
    "Options:",
    "  --lib file       Load one .klib or .k library before compiling.",
    "  --export spec    Export library alias into scope. Repeatable.",
    "                   spec is 'name' or 'libname:localname'.",
    "  -h, --help       Show this help.",
    "",
    "Examples:",
    `  echo '"abc"' | k-parse | ${prog} '{.1 0}' | k-print`,
    `  echo '{"x":1,"y":2}' | k-json --parse | \\`,
    `    ${prog} --lib Examples/poly.k --export concat \\`,
    `      's={()xs,()ys}concat; s' | k-json --print`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function compileFile(filePath, libraries, preamble) {
  const buffer = fs.readFileSync(filePath);
  try {
    return objectToFunction(decodeObject(buffer));
  } catch {
    return k.compile(preamble + buffer.toString("utf8"), { libraries });
  }
}

({ kScript, inputStream } = ((args) => {
  try {
    if (args.includes("-h") || args.includes("--help")) {
      usage(console.log);
      return exit(0);
    }

    const libraries = [];
    const exports = [];
    // Parse --lib and --export flags
    while (args.length > 0 && args[0].startsWith("--")) {
      if (args[0] === "--lib") {
        args.shift();
        const libPath = args.shift();
        if (!libPath) throw new Error("--lib requires a file argument");
        if (libraries.length > 0) {
          throw new Error("--lib may be specified at most once");
        }
        if (libPath.endsWith(".k")) {
          const raw = fs.readFileSync(libPath, "utf8");
          libraries.push(
            loadLibrary(compileLibrary(raw, { source: libPath }))
          );
        } else {
          const libBuffer = fs.readFileSync(libPath);
          libraries.push(loadLibrary(decodeObject(libBuffer)));
        }
      } else if (args[0] === "--export") {
        args.shift();
        const spec = args.shift();
        if (!spec) throw new Error("--export requires a spec argument");
        exports.push(spec);
      } else {
        break;
      }
    }

    const preamble = buildExportPreamble(exports, libraries);

    let kScriptStr = (function (arg) {
      if (arg == null) {
        throw new Error("Missing script argument");
      }
      if (arg === "-k") {
        throw new Error(
          "-k is no longer supported; " +
          "pass the source/object file path directly"
        );
      }
      if (isFile(arg)) return compileFile(arg, libraries, preamble);
      return preamble + arg;
    })(args.shift());
    let kScript = typeof kScriptStr === "function"
      ? kScriptStr
      : k.compile(kScriptStr, { libraries });
    inputStream = (function (arg) {
      if (arg == null) {
        return stdin;
      }
      return fs.createReadStream(arg);
    })(args.shift());
    return { kScript, inputStream };
  } catch (error) {
    console.error(error);
    usage();
    return exit(-1);
  }
})(argv.slice(2)));

const buffer = [];
inputStream.on("data", (data) => buffer.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
inputStream.on("end", () => {
  try {
    const inputBuffer = Buffer.concat(buffer);
    const { pattern: inputPattern, value } = decodeWire(inputBuffer);
    const result = kScript(value);
    if (result === undefined) {
      throw new Error("k expression evaluated to undefined; cannot encode undefined output value");
    }
    stdout.write(encodeToWire(result, result.pattern));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
