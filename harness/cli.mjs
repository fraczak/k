#!/usr/bin/env node

import { parseArgs } from "node:util";
import { createPolySuite } from "./suites/poly.mjs";
import {
  formatPhaseTable,
  formatProfileTable,
  formatBenchmarkTable
} from "./format.mjs";

async function main() {
  const options = {
    suite: { type: "string", default: "poly" },
    backends: { type: "string", short: "b" },
    iterations: { type: "string", short: "i", default: "3" },
    warmup: { type: "string", short: "w", default: "1" },
    trace: { type: "boolean", default: false },
    profile: { type: "boolean", default: false },
    conformance: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    format: { type: "string", default: "text" },
    listLength: { type: "string", default: "40" },
    help: { type: "boolean", short: "h", default: false }
  };

  const { values } = parseArgs({ options, allowPositionals: true });

  if (values.help) {
    console.log(`Usage: node harness/cli.mjs [options]

Options:
  --suite <name>       Benchmark suite: poly (default: poly)
  -b, --backends <csv> Comma-separated backends (default: all available)
  -i, --iterations <n> Measured iterations (default: 3)
  -w, --warmup <n>     Warmup iterations (default: 1)
  --trace              Measure 7-phase nanosecond execution timing
  --profile            Measure per-function call count profiling
  --conformance        Verify output equality across all backends
  --all                Run conformance, profile, trace, and benchmark
  --format <fmt>       Output format: text, json (default: text)
  --listLength <n>     Workload size for list operations (default: 40)
  -h, --help           Show this help message
`);
    return;
  }

  const listLength = parseInt(values.listLength, 10);
  const iterations = parseInt(values.iterations, 10);
  const warmup = parseInt(values.warmup, 10);
  const doTrace = values.trace || values.all;
  const doProfile = values.profile || values.all;
  const doConformance = values.conformance || values.all;
  const doBenchmark = !values.trace && !values.profile && !values.conformance ? true : values.all;

  console.log(`==> Initializing test suite: ${values.suite} (listLength=${listLength})...`);
  let suite;
  if (values.suite === "poly") {
    suite = await createPolySuite({ listLength });
  } else {
    throw new Error(`Unknown suite: ${values.suite}`);
  }

  const available = suite.getAvailableBackendIds();
  const selectedBackends = values.backends
    ? values.backends.split(",").map(b => b.trim()).filter(Boolean)
    : available;

  console.log(`==> Target backends: ${selectedBackends.join(", ")}`);
  console.log(`==> Compiling test cases for backends...`);
  const compileResults = await suite.compileAll(selectedBackends, {
    profile: doProfile,
    trace: doTrace
  });

  for (const [id, res] of Object.entries(compileResults)) {
    console.log(`  [${id}] ${res.status}: ${res.ready}/${res.total} cases ready`);
    if (res.status !== "ok" && res.error) {
      console.log(`      Error: ${res.error.split("\n")[0]}`);
    }
  }

  const readyBackends = selectedBackends.filter(id => compileResults[id]?.status === "ok");

  try {
    // 1. Conformance
    if (doConformance) {
      console.log("\n==> Running Conformance Verification...");
      const confResults = await suite.checkConformance(readyBackends);
      let allPassed = true;
      for (const r of confResults) {
        const statuses = Object.entries(r.conformance).map(([id, c]) => `${id}:${c.status}`).join(" ");
        console.log(`  ${r.name.padEnd(15)} -> ${statuses}`);
        if (!r.passed) allPassed = false;
      }
      console.log(allPassed ? "  All backends conform!" : "  Conformance failure detected!");
    }

    // 2. Profile
    if (doProfile) {
      console.log("\n==> Running Per-Function Call Profiling...");
      const profResults = await suite.runProfile(readyBackends);
      console.log(formatProfileTable(profResults, readyBackends));
    }

    // 3. Trace
    if (doTrace) {
      console.log("\n==> Running 7-Phase Execution Tracing...");
      const traceResults = await suite.runTrace(readyBackends, 3);
      console.log(formatPhaseTable(traceResults, readyBackends));
    }

    // 4. Benchmark
    if (doBenchmark) {
      console.log(`\n==> Running Benchmark (${iterations} iterations, ${warmup} warmup)...`);
      const benchResults = await suite.runBenchmark(readyBackends, { warmup, iterations });
      if (values.format === "json") {
        console.log(JSON.stringify(benchResults, null, 2));
      } else {
        console.log(formatBenchmarkTable(benchResults));
      }
    }
  } finally {
    await suite.close();
  }
}

main().catch(err => {
  console.error("Harness error:", err);
  process.exit(1);
});
