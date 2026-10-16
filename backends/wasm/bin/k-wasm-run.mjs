#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout, stderr } from "node:process";

import { instantiateWasmArtifact } from "../src/wasm.mjs";

function helpText() {
  const prog = argv[1] || "k-wasm-run.mjs";
  return [
    "Run a standalone WebAssembly (.wasm) artifact over a binary",
    "pattern+value wire stream.",
    "",
    `Usage: ${prog} [options] wasm-file [ input-wire-file ]`,
    "",
    "Arguments:",
    "  wasm-file        Input .wasm artifact produced by k-wasm-compile.",
    "  input-wire-file  Optional binary wire input (default: stdin).",
    "",
    "Options:",
    "  --server    Run as persistent server reading framed requests from",
    "              stdin.",
    "  -h, --help  Show this help.",
    "",
    "Environment Variables:",
    "  K_TRACE, TRACE  When '1', output phase tracing metrics to stderr.",
    "",
    "Examples:",
    `  echo '"hello"' | k-json --parse | \\`,
    `    ${prog} prog.wasm | k-json --print`,
    `  ${prog} prog.wasm input.wire > output.wire`,
    `  ${prog} --server prog.wasm`
  ].join("\n");
}

function usage(stream = console.error) {
  stream(helpText());
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      );
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function runServer(runner) {
  const tracing =
    process.env.K_TRACE === "1" || process.env.TRACE === "1";
  let inBuffer = Buffer.alloc(0);
  let readStartNs = 0n;

  stdin.on("data", (chunk) => {
    if (inBuffer.length === 0) {
      readStartNs = process.hrtime.bigint();
    }
    inBuffer = Buffer.concat([inBuffer, chunk]);
    processBuffer();
  });

  stdin.on("end", () => {
    exit(0);
  });

  function processBuffer() {
    while (inBuffer.length >= 4) {
      const len = inBuffer.readUInt32BE(0);
      if (inBuffer.length < 4 + len) {
        break;
      }
      const t1 = process.hrtime.bigint();
      const payload = inBuffer.subarray(4, 4 + len);
      inBuffer = inBuffer.subarray(4 + len);

      try {
        let outWire;
        let trace = null;
        if (tracing) {
          const res = runner.execute(payload, { trace: true });
          outWire = res.outputWire;
          trace = res.trace;
        } else {
          outWire = runner.execute(payload);
        }

        const writeStart = process.hrtime.bigint();
        const outHdr = Buffer.allocUnsafe(4);
        outHdr.writeUInt32BE(outWire.length, 0);
        stdout.write(outHdr);
        stdout.write(outWire);
        const tEnd = process.hrtime.bigint();

        if (tracing && trace) {
          const ipcReadNs = readStartNs > 0n ? Number(t1 - readStartNs) : 0;
          const decodeNs = trace.decodeNs;
          const flatInNs = trace.flatInNs;
          const evalNs = trace.evalNs;
          const flatOutNs = trace.flatOutNs;
          const encodeNs = trace.encodeNs;
          const ipcWriteNs = Number(tEnd - writeStart);
          const totalNs = Number(tEnd - (readStartNs > 0n ? readStartNs : t1));
          stderr.write(
            `K_TRACE_PHASES backend=wasm ipc_read_ns=${ipcReadNs} ` +
              `decode_ns=${decodeNs} flat_in_ns=${flatInNs} ` +
              `eval_ns=${evalNs} flat_out_ns=${flatOutNs} ` +
              `encode_ns=${encodeNs} ipc_write_ns=${ipcWriteNs} ` +
              `total_ns=${totalNs}\n`
          );
        }
      } catch (err) {
        const msg = err.stack || err.message || String(err);
        stderr.write(`Wasm server error: ${msg}\n`);
        exit(1);
      }

      readStartNs = process.hrtime.bigint();
    }
  }
}

async function main() {
  const rawArgs = argv.slice(2);
  if (rawArgs.includes("-h") || rawArgs.includes("--help")) {
    usage(console.log);
    return;
  }

  const isServer = rawArgs.includes("--server");
  const args = rawArgs.filter((a) => a !== "--server");

  const wasmPath = args.shift();
  if (!wasmPath) throw new Error("Missing .wasm artifact path");

  const artifact = fs.readFileSync(wasmPath);
  const runner = await instantiateWasmArtifact(artifact);

  if (isServer) {
    if (args.length > 0) {
      throw new Error("Too many arguments for --server mode");
    }
    await runServer(runner);
    return;
  }

  const inputPath = args.shift();
  if (args.length > 0) throw new Error("Too many arguments");

  const inputStream =
    inputPath == null ? stdin : fs.createReadStream(inputPath);
  const input = await readAll(inputStream);
  const tracing =
    process.env.K_TRACE === "1" || process.env.TRACE === "1";
  if (tracing) {
    const res = runner.execute(input, { trace: true });
    stdout.write(res.outputWire);
    if (res.trace) {
      const trace = res.trace;
      stderr.write(
        `K_TRACE_PHASES backend=wasm ipc_read_ns=0 ` +
          `decode_ns=${trace.decodeNs} flat_in_ns=${trace.flatInNs} ` +
          `eval_ns=${trace.evalNs} flat_out_ns=${trace.flatOutNs} ` +
          `encode_ns=${trace.encodeNs} ipc_write_ns=0 ` +
          `total_ns=${trace.evalNs}\n`
      );
    }
  } else {
    stdout.write(runner.execute(input));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
});
