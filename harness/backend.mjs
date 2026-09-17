// Base class for all backend adapters

export class BackendAdapter {
  constructor(id, name, options = {}) {
    this.id = id;
    this.name = name;
    this.options = options;
  }

  isAvailable() {
    return true;
  }

  getLaneName() {
    return this.name;
  }

  /**
   * Compiles or prepares a test case for execution.
   * @param {object} testCase
   * @param {object} options
   * @returns {Promise<object>} compiled artifact/handle
   */
  async compile(testCase, options = {}) {
    throw new Error(`compile() not implemented for backend '${this.id}'`);
  }

  /**
   * Creates a runner for a suite of compiled cases.
   * @param {Array<object>} compiledCases
   * @param {object} options
   * @returns {Promise<BackendRunner>}
   */
  async createRunner(compiledCases, options = {}) {
    throw new Error(`createRunner() not implemented for backend '${this.id}'`);
  }
}

export class BackendRunner {
  constructor(backendId, options = {}) {
    this.backendId = backendId;
    this.options = options;
  }

  /**
   * Run a single case.
   * @param {object} compiledCase
   * @param {object} options { trace?: boolean, profile?: boolean }
   * @returns {Promise<{ outputWire?: Buffer, outputVal?: any, trace?: object, profile?: object }>}
   */
  async runSingle(compiledCase, options = {}) {
    throw new Error(`runSingle() not implemented for runner '${this.backendId}'`);
  }

  /**
   * Run all cases once.
   * @param {Array<object>} compiledCases
   * @returns {Promise<void>}
   */
  async runBatch(compiledCases) {
    for (const c of compiledCases) {
      await this.runSingle(c);
    }
  }

  /**
   * Run timed iterations over all cases.
   * @param {Array<object>} compiledCases
   * @param {number} iterations
   * @returns {Promise<{ totalNs: number, perIterationMs: number, iterationTimes: number[] }>}
   */
  async runIterations(compiledCases, iterations) {
    const iterationTimes = [];
    let totalNs = 0;

    for (let i = 0; i < iterations; i++) {
      const t0 = process.hrtime.bigint();
      await this.runBatch(compiledCases);
      const t1 = process.hrtime.bigint();
      const diffNs = Number(t1 - t0);
      totalNs += diffNs;
      iterationTimes.push(diffNs / 1000000);
    }

    return {
      totalNs,
      perIterationMs: iterations > 0 ? (totalNs / iterations / 1000000) : 0,
      iterationTimes
    };
  }

  async close() {
    // Optional cleanup
  }
}
