#!/usr/bin/env node
// !/usr/bin/node --stack-size=8000

import fs from "node:fs";
import { argv, stdin, exit, stdout } from "node:process";
import k from "./index.mjs";
import { decodeWire, encodeToWire } from "./codecs/runtime/prefix-codec.mjs";
import { decodeObject, objectToFunction, loadLibrary } from "./object.mjs";

const prog = argv[1];

let kScript, inputStream;

function usage() {
  console.error(`Usage: ${prog} [ --lib lib-file ]... [ --export spec ]... ( k-expr | -k file ) [ input-file ]`);
  console.error(`       E.g.,  echo '["zebara","ela"]' | k-parse --input-type '$x=<{} zebara, {} ela>; $v={x 0, x 1}; $v' | ${prog} '{.1 0}'`);
  console.error("Options:");
  console.error("  --lib file      Load a .klib dependency before compiling. May be repeated.");
  console.error("  --export spec   Export a library alias into scope. 'name' or 'libname:localname'. May be repeated.");
  console.error("  -h, --help      Show this help.");
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
      usage();
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
        const libBuffer = fs.readFileSync(libPath);
        libraries.push(loadLibrary(decodeObject(libBuffer)));
      } else if (args[0] === "--export") {
        args.shift();
        const spec = args.shift();
        if (!spec) throw new Error("--export requires a spec argument");
        exports.push(spec);
      } else {
        break;
      }
    }

    function buildExportPreamble() {
      if (exports.length === 0) return "";
      const aliasMap = {};
      for (const lib of libraries) {
        for (const [name, hash] of Object.entries(lib.relAlias || {})) {
          if (name !== "__main__") aliasMap[name] = hash;
        }
        for (const [hash, entry] of Object.entries(lib.meta || {})) {
          if (entry?.type !== "rel") continue;
          for (const origin of entry?.origins || []) {
            if (origin?.name && origin.name !== "__main__") aliasMap[origin.name] = hash;
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

    let kScriptStr = (function (arg) {
      if (arg == null) {
        throw new Error("Missing script argument");
      }
      if (arg === "-k") {
        return compileFile(args.shift(), libraries, buildExportPreamble());
      } else {
        return buildExportPreamble() + arg;
      }
    })(args.shift());
    let kScript = typeof kScriptStr === "function" ? kScriptStr : k.compile(kScriptStr, { libraries });
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
