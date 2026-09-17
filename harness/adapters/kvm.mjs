import {
  codes,
  decodeWire,
  encodeToWire,
  executeKVM,
  lowerToKVM,
  specializeKVM
} from "../../backend-api.mjs";
import { BackendAdapter, BackendRunner } from "../backend.mjs";

class KVMRunner extends BackendRunner {
  constructor(backendId, state, options = {}) {
    super(backendId);
    this.state = state;
    this.wire = options.wire !== false;
  }

  getContext(profile = null) {
    return {
      rels: this.state?.rels || {},
      codes: this.state?.codes || {},
      findCode: codes.find,
      profile,
      hashToName: this.state?.hashToName || null,
      options: {
        envelopeFree: true
      }
    };
  }

  async runSingle(testCase, options = {}) {
    const profile = options.profile ? {} : null;
    const context = this.getContext(profile);
    const targetFunc = testCase.specKvmFunc || testCase.kvmFunc;

    let inputVal = testCase.inputVal;
    const t0 = process.hrtime.bigint();
    let tDecode = t0;

    if (this.wire && testCase.inputWire) {
      const decoded = decodeWire(testCase.inputWire);
      inputVal = decoded.value;
      tDecode = process.hrtime.bigint();
    }

    const tEvalStart = process.hrtime.bigint();
    const result = executeKVM(targetFunc, inputVal, context);
    const tEvalEnd = process.hrtime.bigint();

    let outputWire = null;
    let tEncode = tEvalEnd;
    if (this.wire && result !== undefined) {
      const outPattern = testCase.outputPattern || targetFunc.outputPattern;
      outputWire = encodeToWire(result, outPattern);
      tEncode = process.hrtime.bigint();
    }

    const decodeNs = Number(tDecode - t0);
    const evalNs = Number(tEvalEnd - tEvalStart);
    const encodeNs = Number(tEncode - tEvalEnd);
    const totalNs = Number(tEncode - t0);

    const trace = {
      ipcReadNs: 0,
      decodeNs,
      flatInNs: 0,
      evalNs,
      flatOutNs: 0,
      encodeNs,
      ipcWriteNs: 0,
      totalNs
    };

    return {
      outputVal: result,
      outputWire,
      trace,
      profile
    };
  }

  async runBatch(compiledCases) {
    const context = this.getContext();
    for (const c of compiledCases) {
      const targetFunc = c.specKvmFunc || c.kvmFunc;
      if (this.wire && c.inputWire) {
        const decoded = decodeWire(c.inputWire);
        const result = executeKVM(targetFunc, decoded.value, context);
        if (result !== undefined) {
          const outPattern = c.outputPattern || targetFunc.outputPattern;
          encodeToWire(result, outPattern);
        }
      } else {
        executeKVM(targetFunc, c.inputVal, context);
      }
    }
  }
}

export class KVMAdapter extends BackendAdapter {
  constructor(state = null, options = {}) {
    const wire = options.wire !== false;
    const id = options.id || (wire ? "kvm" : "kvm-pure");
    const name = options.name || (wire ? "kVM Interpreter (wire codec)" : "kVM Interpreter (in-memory)");
    super(id, name, options);
    this.state = state;
    this.wire = wire;
  }

  setState(state) {
    this.state = state;
  }

  async compile(testCase, options = {}) {
    try {
      const kvmFunc = testCase.kvmFunc || lowerToKVM(testCase.relDef, testCase.relName || testCase.op);
      let specKvmFunc = kvmFunc;
      if (testCase.inputPattern) {
        try {
          specKvmFunc = specializeKVM(kvmFunc, testCase.inputPattern);
        } catch {
          specKvmFunc = kvmFunc;
        }
      }
      return {
        status: "ok",
        kvmFunc,
        specKvmFunc,
        inputVal: testCase.inputVal,
        inputWire: testCase.inputWire,
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
    return new KVMRunner(this.id, this.state, { wire: this.wire });
  }
}
