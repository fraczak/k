/**
 * kTVM Native C99 / LLVM Backend API (`k/ktvm/llvm/index.mjs`).
 *
 * Compiles validated concrete `mono` kTVM modules to standalone native binaries
 * via C99 + `clang -O3` (LLVM). Supports `--server` persistent pipe execution,
 * `--bench N` microbenchmarking, and standalone `stdin -> stdout` CLI mode.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { compileKTVMToC } from "./lower-c.mjs";
import { validateModule } from "../validator.mjs";
import { specializeKTVM } from "../specialize.mjs";
import { optimizeKTVM } from "../optimize/index.mjs";
import { compileKIRToKTVM } from "../lower-kir.mjs";

export { compileKTVMToC } from "./lower-c.mjs";

let cachedClangAvailable = null;

export function isClangAvailable(compiler = "clang") {
  if (compiler === "clang" && cachedClangAvailable !== null) return cachedClangAvailable;
  const res = spawnSync("which", [compiler], { stdio: "ignore" });
  const ok = res.status === 0;
  if (compiler === "clang") cachedClangAvailable = ok;
  return ok;
}

/**
 * Compile generated C99 source to a native executable using `clang` (LLVM).
 */
export function compileCToExecutable(
  cSource,
  exePath,
  {
    compiler = "clang",
    clangOpt = "-O3",
    keepCSource = false
  } = {}
) {
  const dir = path.dirname(exePath);
  fs.mkdirSync(dir, { recursive: true });
  const cPath = keepCSource
    ? `${exePath}.c`
    : path.join(os.tmpdir(), `ktvm_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.c`);

  fs.writeFileSync(cPath, cSource, "utf8");
  try {
    const args = [
      clangOpt,
      "-std=c99",
      "-Wno-unused-function",
      "-Wno-unused-label",
      cPath,
      "-o",
      exePath
    ];
    execFileSync(compiler, args, { stdio: ["ignore", "pipe", "pipe"] });
    return { exePath, cPath: keepCSource ? cPath : null };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString("utf8") : err.message;
    throw new Error(`kTVM clang compilation failed:\n${stderr}`);
  } finally {
    if (!keepCSource) {
      try { fs.unlinkSync(cPath); } catch {}
    }
  }
}

/**
 * Compile a concrete `mono` (or polymorphic `poly` with `inputPattern`) kTVM
 * module directly to a native executable.
 */
export function compileKTVMToExecutable(
  ktvmModule,
  exePath,
  {
    entry = null,
    inputPattern = null,
    optimize = true,
    optimizeOptions = {},
    validate = true,
    verifyTables = true,
    compiler = "clang",
    clangOpt = "-O3",
    keepCSource = false
  } = {}
) {
  let monoMod = ktvmModule;
  if (monoMod.layer === "poly") {
    if (!inputPattern) {
      throw new Error("compileKTVMToExecutable requires `inputPattern` for polymorphic 'poly' modules");
    }
    monoMod = specializeKTVM(monoMod, inputPattern, { entry });
  }
  if (optimize) {
    monoMod = optimizeKTVM(monoMod, {
      ...optimizeOptions,
      validate,
      verifyTables
    }).module;
  } else if (validate) {
    validateModule(monoMod, { verifyTables });
  }

  const acceptedInputPlists = inputPattern ? [inputPattern] : [];
  const lowered = compileKTVMToC(monoMod, {
    entry: entry || monoMod.entry,
    validate: false,
    acceptedInputPlists
  });
  compileCToExecutable(lowered.cSource, exePath, { compiler, clangOpt, keepCSource });

  return {
    exePath,
    entry: lowered.entry,
    ktvmModule: monoMod,
    inPlist: lowered.inPlist,
    outPlist: lowered.outPlist,
    stats: lowered.stats
  };
}

/**
 * Full end-to-end compilation from a K object/library (`lib` / `k-object`) +
 * relation name + concrete input pattern to a native LLVM executable!
 */
export function compileObjectToKTVMExecutable(
  objectOrLib,
  relationName,
  inputPattern,
  exePath,
  {
    optimize = true,
    optimizeOptions = {},
    validate = true,
    verifyTables = true,
    compiler = "clang",
    clangOpt = "-O3",
    keepCSource = false
  } = {}
) {
  const compiled = compileKIRToKTVM(objectOrLib, relationName, inputPattern, { validate: false });
  return compileKTVMToExecutable(compiled.module, exePath, {
    entry: compiled.entry,
    inputPattern,
    optimize,
    optimizeOptions,
    validate,
    verifyTables,
    compiler,
    clangOpt,
    keepCSource
  });
}

/**
 * Execute a compiled kTVM native executable once on a raw `k-wire` buffer
 * (CLI mode: stdin -> stdout), optionally returning parsed telemetry.
 */
export function executeKTVMExecutable(
  exePath,
  inputWire,
  {
    telemetry = false,
    quota = null
  } = {}
) {
  const args = [];
  if (telemetry) args.push("--telemetry");
  if (quota?.maxSteps != null) args.push("--max-steps", String(quota.maxSteps));
  if (quota?.maxNodes != null) args.push("--max-nodes", String(quota.maxNodes));
  if (quota?.maxBitDequeBytes != null) args.push("--max-bytes", String(quota.maxBitDequeBytes));

  const res = spawnSync(exePath, args, { input: Buffer.from(inputWire) });
  const stderr = res.stderr ? res.stderr.toString("utf8") : "";
  let parsedTelemetry = null;
  const tm = stderr.match(/KTVM_TELEMETRY\s+(.+)/);
  if (tm) {
    parsedTelemetry = {};
    for (const part of tm[1].trim().split(/\s+/)) {
      const [k, v] = part.split("=");
      if (k && v != null) {
        const camel = k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
        parsedTelemetry[camel] = Number(v);
      }
    }
  }
  const em = stderr.match(/KTVM_ERROR code=(-?\d+)/);
  const errorCode = em ? Number(em[1]) : 0;

  if (res.status === 0) {
    return { status: "OK", wire: res.stdout, errorCode: 0, telemetry: parsedTelemetry };
  }
  if (res.status === 1 && errorCode === -1) {
    return { status: "FAILED", wire: null, errorCode: -1, telemetry: parsedTelemetry };
  }
  return { status: "ERROR", wire: null, errorCode, stderr: stderr.trim(), telemetry: parsedTelemetry };
}
