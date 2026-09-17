import { createRegistry } from "./registry.mjs";
import { safeDeepEqual, average, min, max, stdDev, makeCacheDir } from "./util.mjs";
import { averageTrace } from "./trace.mjs";

export class BenchmarkSuite {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.cases = [];
    this.state = options.state || null;
    this.registry = createRegistry({ state: this.state, ...options });
    this.compiled = new Map(); // backendId -> Array<compiledCase>
    this.runners = new Map();  // backendId -> runner
    this.cacheDir = options.cacheDir || makeCacheDir(`k-harness-${name}-`);
  }

  addCase(testCase) {
    this.cases.push(testCase);
  }

  getBackend(id) {
    return this.registry.getBackend(id);
  }

  getAvailableBackendIds() {
    return this.registry.getAvailableBackends().map(b => b.id);
  }

  async compileAll(backendIds, options = {}) {
    const results = {};
    for (const id of backendIds) {
      const backend = this.getBackend(id);
      if (!backend.isAvailable()) {
        results[id] = { status: "unavailable", reason: "not supported on this platform" };
        continue;
      }

      const compiledCases = [];
      let allOk = true;
      let failureError = null;

      for (const tc of this.cases) {
        const res = await backend.compile(tc, {
          cacheDir: this.cacheDir,
          profile: options.profile,
          trace: options.trace
        });
        if (res.status !== "ok") {
          allOk = false;
          failureError = res.error;
        }
        compiledCases.push({ ...tc, ...res });
      }

      this.compiled.set(id, compiledCases);
      results[id] = {
        status: allOk ? "ok" : "failed",
        total: this.cases.length,
        ready: compiledCases.filter(c => c.status === "ok").length,
        error: failureError
      };
    }
    return results;
  }

  async getRunner(backendId) {
    let runner = this.runners.get(backendId);
    if (!runner) {
      const backend = this.getBackend(backendId);
      const compiledCases = this.compiled.get(backendId);
      if (!compiledCases) throw new Error(`Backend '${backendId}' not compiled yet`);
      runner = await backend.createRunner(compiledCases);
      this.runners.set(backendId, runner);
    }
    return runner;
  }

  async checkConformance(backendIds) {
    const baselineId = backendIds.includes("native-aware")
      ? "native-aware"
      : (backendIds.includes("kvm") ? "kvm" : backendIds[0]);

    const results = [];

    for (let i = 0; i < this.cases.length; i++) {
      const tc = this.cases[i];
      const caseResult = {
        name: tc.name || tc.op,
        conformance: {},
        passed: true
      };

      let baselineVal = tc.expectedVal;

      for (const id of backendIds) {
        const compiledCases = this.compiled.get(id);
        if (!compiledCases || compiledCases[i]?.status !== "ok") {
          caseResult.conformance[id] = { status: "compile_failed" };
          caseResult.passed = false;
          continue;
        }

        const runner = await this.getRunner(id);
        try {
          const res = await runner.runSingle(compiledCases[i], { trace: false });
          const val = res.outputVal;

          if (id === baselineId && baselineVal == null) {
            baselineVal = val;
          }

          const matches = baselineVal == null || safeDeepEqual(val, baselineVal);
          caseResult.conformance[id] = {
            status: matches ? "ok" : "mismatch",
            val
          };
          if (!matches) caseResult.passed = false;
        } catch (err) {
          caseResult.conformance[id] = {
            status: "error",
            error: err.message
          };
          caseResult.passed = false;
        }
      }

      results.push(caseResult);
    }

    return results;
  }

  async runTrace(backendIds, reps = 5) {
    const traceResults = [];

    for (let i = 0; i < this.cases.length; i++) {
      const tc = this.cases[i];
      const caseTrace = {
        op: tc.op || tc.name,
        label: tc.label || ""
      };

      for (const id of backendIds) {
        const compiledCases = this.compiled.get(id);
        if (!compiledCases || compiledCases[i]?.status !== "ok") continue;

        const runner = await this.getRunner(id);
        const samples = [];

        // Warmup 2 reps
        for (let w = 0; w < 2; w++) {
          await runner.runSingle(compiledCases[i], { trace: true });
        }

        // Measured reps
        for (let r = 0; r < reps; r++) {
          const res = await runner.runSingle(compiledCases[i], { trace: true });
          if (res.trace) samples.push(res.trace);
        }

        caseTrace[id] = averageTrace(samples);
      }

      traceResults.push(caseTrace);
    }

    return traceResults;
  }

  async runProfile(backendIds) {
    const profileResults = [];

    for (let i = 0; i < this.cases.length; i++) {
      const tc = this.cases[i];
      const caseProfile = {
        op: tc.op || tc.name
      };

      for (const id of backendIds) {
        const compiledCases = this.compiled.get(id);
        if (!compiledCases || compiledCases[i]?.status !== "ok") continue;

        const runner = await this.getRunner(id);
        const res = await runner.runSingle(compiledCases[i], { profile: true });
        if (res.profile) {
          caseProfile[id] = res.profile;
        }
      }

      profileResults.push(caseProfile);
    }

    return profileResults;
  }

  async runBenchmark(backendIds, { warmup = 1, iterations = 3 } = {}) {
    const benchResults = [];

    for (const id of backendIds) {
      const compiledCases = this.compiled.get(id);
      const readyCases = (compiledCases || []).filter(c => c.status === "ok");
      if (!readyCases || readyCases.length === 0) continue;

      const runner = await this.getRunner(id);
      const backend = this.getBackend(id);

      // Warmup
      if (warmup > 0) {
        for (let w = 0; w < warmup; w++) {
          await runner.runBatch(readyCases);
        }
      }

      // Measured iterations
      const iterRes = await runner.runIterations(readyCases, iterations);

      // Sample pure evaluation time (Phase 4) across cases
      let pureEvalMs = null;
      try {
        let totalEvalNs = 0;
        let count = 0;
        for (const c of readyCases) {
          const sample = await runner.runSingle(c, { trace: true });
          if (sample?.trace?.evalNs != null) {
            totalEvalNs += sample.trace.evalNs;
            count++;
          }
        }
        if (count > 0 && totalEvalNs > 0) {
          pureEvalMs = totalEvalNs / 1000000;
        }
      } catch {}

      benchResults.push({
        id,
        name: backend.getLaneName(),
        totalNs: iterRes.totalNs,
        perIterationMs: iterRes.perIterationMs,
        pureEvalMs,
        iterationTimes: iterRes.iterationTimes,
        minMs: min(iterRes.iterationTimes),
        maxMs: max(iterRes.iterationTimes),
        stdDevMs: stdDev(iterRes.iterationTimes),
        samples: iterations
      });
    }

    return benchResults;
  }

  async close() {
    for (const runner of this.runners.values()) {
      await runner.close();
    }
    this.runners.clear();
  }
}
