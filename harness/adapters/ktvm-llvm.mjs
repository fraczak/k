/**
 * Benchmark harness adapter for kTVM Native C/LLVM executables (`ktvm-llvm`, `ktvm-llvm-opt`).
 *
 * Uses the same `PersistentExecutable` (`--server` + `K_TRACE=1`) framing protocol
 * as `harness/adapters/llvm.mjs` for apples-to-apples head-to-head comparison.
 */

import fs from "node:fs";
import path from "node:path";

import { BackendAdapter, BackendRunner } from "../backend.mjs";
import { PersistentExecutable } from "../persistent.mjs";
import { decodeWire } from "../../backend-api.mjs";
import {
  compileObjectToKTVMExecutable,
  isClangAvailable
} from "../../ktvm/llvm/index.mjs";

class KTVMLLVMRunner extends BackendRunner {
  constructor(backendId, servers = new Map()) {
    super(backendId);
    this.servers = servers;
  }

  getServer(exePath) {
    let server = this.servers.get(exePath);
    if (!server) {
      server = new PersistentExecutable(exePath);
      this.servers.set(exePath, server);
    }
    return server;
  }

  async runSingle(testCase, options = {}) {
    const server = this.getServer(testCase.exePath);
    if (options.trace) {
      const res = await server.requestWithTrace(testCase.inputWire);
      const decoded = decodeWire(res.payload);
      return {
        outputWire: res.payload,
        outputVal: decoded.value,
        outputPattern: decoded.pattern,
        trace: res.trace
      };
    }
    const payload = await server.request(testCase.inputWire);
    const decoded = decodeWire(payload);
    return {
      outputWire: payload,
      outputVal: decoded.value,
      outputPattern: decoded.pattern
    };
  }

  async runBatch(compiledCases) {
    for (const c of compiledCases) {
      const server = this.getServer(c.exePath);
      await server.request(c.inputWire);
    }
  }

  async close() {
    for (const server of this.servers.values()) {
      server.close();
    }
    this.servers.clear();
  }
}

export class KTVMLLVMAdapter extends BackendAdapter {
  constructor({ optimize = true, clangOpt = "-O3", ...options } = {}) {
    super(
      optimize ? "ktvm-llvm-opt" : "ktvm-llvm",
      optimize
        ? `kTVM Native C/LLVM Optimized (${clangOpt}, persistent)`
        : `kTVM Native C/LLVM (${clangOpt}, persistent)`,
      options
    );
    this.optimize = optimize;
    this.clangOpt = clangOpt;
  }

  isAvailable() {
    return isClangAvailable("clang");
  }

  async compile(testCase, options = {}) {
    const cacheDir = options.cacheDir || path.join(process.cwd(), ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const tag = this.optimize ? "opt" : "raw";
    const name = testCase.op || testCase.relName || "case";
    const exePath = path.join(cacheDir, `harness_ktvm_llvm_${tag}_${name}`);

    try {
      const relation = testCase.relHash || testCase.relName || testCase.op || testCase.object.main;
      compileObjectToKTVMExecutable(testCase.object, relation, testCase.inputPattern, exePath, {
        optimize: this.optimize,
        clangOpt: this.clangOpt
      });
      return {
        status: "ok",
        exePath,
        inputWire: testCase.inputWire,
        inputVal: testCase.inputVal,
        outputPattern: testCase.outputPattern
      };
    } catch (error) {
      return {
        status: "failed",
        error: error.stack || error.message || String(error)
      };
    }
  }

  async createRunner() {
    return new KTVMLLVMRunner(this.id);
  }
}
