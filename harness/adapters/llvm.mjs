import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { BackendAdapter, BackendRunner } from "../backend.mjs";
import { PersistentExecutable } from "../persistent.mjs";
import { compileObjectToExecutable } from "../../backends/llvm/src/executable.mjs";
import { decodeWire } from "../../backend-api.mjs";
import { decodeObject, encodeObject } from "../../object.mjs";

function cloneObjectPayload(object) {
  return decodeObject(encodeObject(object));
}

class LLVMRunner extends BackendRunner {
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
        trace: res.trace,
        profile: res.trace?.profile
      };
    } else {
      const payload = await server.request(testCase.inputWire);
      const decoded = decodeWire(payload);
      return {
        outputWire: payload,
        outputVal: decoded.value,
        outputPattern: decoded.pattern
      };
    }
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

export class LLVMAdapter extends BackendAdapter {
  constructor(options = {}) {
    const clangOpt = options.clangOpt || "-O3";
    super("llvm", `LLVM Executable (persistent, ${clangOpt})`, options);
    this.clangOpt = clangOpt;
    this._available = null;
  }

  isAvailable() {
    if (this._available !== null) return this._available;
    try {
      execSync("which clang", { stdio: "ignore" });
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async compile(testCase, options = {}) {
    const cacheDir = options.cacheDir || path.join(process.cwd(), ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const exePath = path.join(cacheDir, `harness_llvm_${testCase.op || testCase.relName || "case"}`);

    try {
      const relation = testCase.relName || testCase.op || testCase.relationName || testCase.object.main;
      compileObjectToExecutable(cloneObjectPayload(testCase.object), exePath, {
        relation,
        inputPattern: testCase.inputPattern,
        runtimeMode: options.runtimeMode || "fast",
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

  async createRunner(compiledCases) {
    return new LLVMRunner(this.id);
  }
}
