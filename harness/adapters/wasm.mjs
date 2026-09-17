import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackendAdapter, BackendRunner } from "../backend.mjs";
import { PersistentExecutable } from "../persistent.mjs";
import {
  compileWasmArtifactFromObject,
  instantiateWasmArtifact
} from "../../backends/wasm/src/wasm.mjs";
import { decodeWire } from "../../backend-api.mjs";

class WasmInProcessRunner extends BackendRunner {
  constructor(backendId) {
    super(backendId);
  }

  async runSingle(testCase, options = {}) {
    const runner = testCase.runner;
    if (options.trace) {
      const res = runner.execute(testCase.inputWire, { trace: true });
      const decoded = decodeWire(res.outputWire);
      return {
        outputWire: res.outputWire,
        outputVal: decoded.value,
        outputPattern: decoded.pattern,
        trace: {
          ipcReadNs: 0,
          decodeNs: res.trace.decodeNs,
          flatInNs: res.trace.flatInNs,
          evalNs: res.trace.evalNs,
          flatOutNs: res.trace.flatOutNs,
          encodeNs: res.trace.encodeNs,
          ipcWriteNs: 0,
          totalNs: res.trace.totalNs
        }
      };
    } else {
      const outWire = runner.execute(testCase.inputWire);
      const decoded = decodeWire(outWire);
      return {
        outputWire: outWire,
        outputVal: decoded.value,
        outputPattern: decoded.pattern
      };
    }
  }

  async runBatch(compiledCases) {
    for (const c of compiledCases) {
      c.runner.execute(c.inputWire);
    }
  }

  async close() {}
}

class WasmPipeRunner extends BackendRunner {
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

export class WasmAdapter extends BackendAdapter {
  constructor(options = {}) {
    const mode = options.mode || "pipe"; // "pipe" or "in-process"
    const id = options.id || (mode === "in-process" ? "wasm-in-process" : "wasm");
    const name = options.name || `WebAssembly (${mode === "pipe" ? "persistent pipe" : "in-process"})`;
    super(id, name, options);
    this.mode = mode;
  }

  isAvailable() {
    return true; // Runs in Node.js via WABT / V8 Wasm
  }

  async compile(testCase, options = {}) {
    const cacheDir = options.cacheDir || path.join(process.cwd(), ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    const name = testCase.op || testCase.relName || "case";
    const wasmPath = path.join(cacheDir, `harness_wasm_${name}.wasm`);
    const exePath = path.join(cacheDir, `harness_wasm_${name}.exe`);

    try {
      const entry = testCase.relHash || testCase.relName || testCase.op;
      const wasmBuf = await compileWasmArtifactFromObject(testCase.object, {
        entry,
        profile: Boolean(options.profile)
      });
      fs.writeFileSync(wasmPath, wasmBuf);

      const runBin = fileURLToPath(import.meta.resolve("../../backends/wasm/bin/k-wasm-run.mjs"));
      fs.writeFileSync(exePath, `#!/bin/sh\nexec node "${runBin}" "${wasmPath}" "$@"\n`, { mode: 0o755 });

      let inProcessRunner = null;
      if (this.mode === "in-process") {
        inProcessRunner = await instantiateWasmArtifact(wasmBuf);
      }

      return {
        status: "ok",
        wasmPath,
        exePath,
        runner: inProcessRunner,
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
    if (this.mode === "in-process") {
      return new WasmInProcessRunner(this.id);
    }
    return new WasmPipeRunner(this.id);
  }
}
