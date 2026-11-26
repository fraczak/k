import {
  compileObjectToKTVMWasm,
  decodeWire,
  instantiateKTVMWasm
} from "../../backend-api.mjs";
import { BackendAdapter, BackendRunner } from "../backend.mjs";

class KTVMWasmRunner extends BackendRunner {
  constructor(backendId) {
    super(backendId);
  }

  async runSingle(testCase) {
    const t0 = process.hrtime.bigint();
    const res = testCase.runner.executeWire(testCase.inputWire, { decodeValue: false });
    const tEval = process.hrtime.bigint();
    const evalNs = Number(tEval - t0);

    let outputVal;
    let outputWire = null;
    if (res.status === "OK") {
      outputWire = res.wire;
      outputVal = decodeWire(res.wire, { eager: true }).value;
    }

    const trace = {
      ipcReadNs: 0,
      decodeNs: 0,
      flatInNs: 0,
      evalNs,
      flatOutNs: 0,
      encodeNs: 0,
      ipcWriteNs: 0,
      totalNs: evalNs
    };

    return {
      outputVal,
      outputWire,
      trace,
      profile: null
    };
  }

  async runBatch(compiledCases) {
    for (const c of compiledCases) {
      c.runner.executeWire(c.inputWire, { decodeValue: false });
    }
  }
}

export class KTVMWasmAdapter extends BackendAdapter {
  constructor(options = {}) {
    const optimize = options.optimize !== false;
    const id = options.id || (optimize ? "ktvm-wasm-opt" : "ktvm-wasm");
    const name = options.name || (
      optimize
        ? "kTVM WebAssembly Optimized (fused + MWTR tables, direct k-wire)"
        : "kTVM WebAssembly (direct k-wire)"
    );
    super(id, name, options);
    this.optimize = optimize;
    this.budgetBytes = options.budgetBytes;
  }

  isAvailable() {
    return true;
  }

  async compile(testCase) {
    try {
      const inputPattern = testCase.inputPattern || (testCase.inputWire ? decodeWire(testCase.inputWire).pattern : null);
      const artifact = await compileObjectToKTVMWasm(
        testCase.object,
        testCase.relName || testCase.op,
        inputPattern,
        {
          optimize: this.optimize,
          budgetBytes: this.budgetBytes,
          validate: true,
          verifyTables: true
        }
      );
      const runner = await instantiateKTVMWasm(artifact);
      return {
        status: "ok",
        artifact,
        runner,
        inputVal: testCase.inputVal,
        inputWire: testCase.inputWire,
        outputPattern: artifact.outPlist
      };
    } catch (error) {
      return {
        status: "failed",
        error: error.stack || error.message || String(error)
      };
    }
  }

  async createRunner() {
    return new KTVMWasmRunner(this.id);
  }
}
