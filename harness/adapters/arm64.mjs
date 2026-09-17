import fs from "node:fs";
import path from "node:path";
import { BackendAdapter, BackendRunner } from "../backend.mjs";
import { PersistentExecutable } from "../persistent.mjs";
import { compileARM64ArtifactFromObject } from "../../backends/arm64/src/arm64.mjs";
import { decodeWire } from "../../backend-api.mjs";

class ARM64Runner extends BackendRunner {
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

export class ARM64Adapter extends BackendAdapter {
  constructor(options = {}) {
    const optLevel = options.optLevel || "-O2";
    super("arm64", `Linux ARM64 ${optLevel} (persistent)`, options);
    this.optLevel = optLevel;
  }

  isAvailable() {
    return process.arch === "arm64" && process.platform === "linux";
  }

  async compile(testCase, options = {}) {
    const cacheDir = options.cacheDir || path.join(process.cwd(), ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const exePath = path.join(cacheDir, `harness_arm64_${testCase.op || testCase.relName || "case"}`);

    try {
      compileARM64ArtifactFromObject(testCase.object, {
        entry: testCase.relName || testCase.op || testCase.relationName,
        inputPattern: testCase.inputPattern,
        outputPattern: testCase.outputPattern,
        outputPath: exePath,
        optLevel: this.optLevel,
        profile: Boolean(options.profile)
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
    return new ARM64Runner(this.id);
  }
}
