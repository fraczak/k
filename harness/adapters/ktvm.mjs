import {
  compileKIRToKTVM,
  decodeWire,
  executeKTVM,
  executeKTVMWire
} from "../../backend-api.mjs";
import { BackendAdapter, BackendRunner } from "../backend.mjs";

class KTVMRunner extends BackendRunner {
  constructor(backendId, options = {}) {
    super(backendId);
    this.wire = options.wire !== false;
  }

  async runSingle(testCase) {
    const t0 = process.hrtime.bigint();
    let outputVal;
    let outputWire = null;
    let evalNs = 0;

    if (this.wire && testCase.inputWire) {
      const res = executeKTVMWire(testCase.compiled.module, testCase.inputWire, {
        entry: testCase.compiled.entry,
        validate: false,
        decodeValue: true
      });
      const tEnd = process.hrtime.bigint();
      evalNs = Number(tEnd - t0);
      outputVal = res.status === "OK" ? res.value : undefined;
      outputWire = res.status === "OK" ? res.wire : null;
    } else {
      const res = executeKTVM(testCase.compiled.module, [testCase.inputVal], {
        entry: testCase.compiled.entry,
        validate: false
      });
      const tEnd = process.hrtime.bigint();
      evalNs = Number(tEnd - t0);
      outputVal = res.status === "OK" ? res.value : undefined;
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
      if (this.wire && c.inputWire) {
        executeKTVMWire(c.compiled.module, c.inputWire, {
          entry: c.compiled.entry,
          validate: false,
          decodeValue: false
        });
      } else {
        executeKTVM(c.compiled.module, [c.inputVal], {
          entry: c.compiled.entry,
          validate: false,
          decodeValues: false
        });
      }
    }
  }
}

export class KTVMAdapter extends BackendAdapter {
  constructor(state = null, options = {}) {
    const wire = options.wire !== false;
    const id = options.id || (wire ? "ktvm" : "ktvm-pure");
    const name = options.name || (wire ? "kTVM Reference VM (direct k-wire)" : "kTVM Reference VM (in-memory)");
    super(id, name, options);
    this.state = state;
    this.wire = wire;
  }

  setState(state) {
    this.state = state;
  }

  async compile(testCase) {
    try {
      const inputPattern = testCase.inputPattern || (testCase.inputWire ? decodeWire(testCase.inputWire).pattern : null);
      const compiled = compileKIRToKTVM(testCase.object, testCase.relName || testCase.op, inputPattern, {
        validate: true
      });
      return {
        status: "ok",
        compiled,
        inputVal: testCase.inputVal,
        inputWire: testCase.inputWire,
        outputPattern: compiled.outputPlist
      };
    } catch (error) {
      return {
        status: "failed",
        error: error.stack || error.message || String(error)
      };
    }
  }

  async createRunner() {
    return new KTVMRunner(this.id, { wire: this.wire });
  }
}
