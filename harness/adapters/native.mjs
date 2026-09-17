import {
  codes,
  decodeWire,
  encodeToWire,
  run,
  run_converged
} from "../../backend-api.mjs";
import { BackendAdapter, BackendRunner } from "../backend.mjs";

class NativeRunner extends BackendRunner {
  constructor(backendId, mode, state) {
    super(backendId);
    this.mode = mode; // "aware" or "free"
    this.state = state;
  }

  async runSingle(testCase, options = {}) {
    const relDef = testCase.relDef;
    const inputVal = testCase.inputVal;
    const findCode = codes.find;

    if (this.mode === "free") {
      run_converged.defs = this.state;
    }

    const t0 = process.hrtime.bigint();
    const result = this.mode === "aware"
      ? run(findCode, relDef.def, inputVal, relDef.typePatternGraph)
      : run_converged(findCode, relDef.def, inputVal, relDef.typePatternGraph);
    const t1 = process.hrtime.bigint();

    const evalNs = Number(t1 - t0);

    const trace = options.trace ? {
      ipcReadNs: 0,
      decodeNs: 0,
      flatInNs: 0,
      evalNs,
      flatOutNs: 0,
      encodeNs: 0,
      ipcWriteNs: 0,
      totalNs: evalNs
    } : null;

    return {
      outputVal: result,
      trace
    };
  }
}

export class NativeAdapter extends BackendAdapter {
  constructor(mode = "free", state = null) {
    const id = mode === "aware" ? "native-aware" : "native-free";
    const name = mode === "aware" ? "Native JS (Envelope-Aware)" : "Native JS (Envelope-Free)";
    super(id, name);
    this.mode = mode;
    this.state = state;
  }

  setState(state) {
    this.state = state;
  }

  async compile(testCase) {
    return {
      status: "ok",
      relDef: testCase.relDef,
      inputVal: testCase.inputVal,
      outputPattern: testCase.outputPattern
    };
  }

  async createRunner(compiledCases) {
    return new NativeRunner(this.id, this.mode, this.state);
  }
}
