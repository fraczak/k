import { spawn } from "node:child_process";
import { parseTraceLine } from "./trace.mjs";

export class PersistentExecutable {
  constructor(exePath, { env = {} } = {}) {
    this.exePath = exePath;
    this.child = spawn(exePath, ["--server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, K_TRACE: "1", ...env }
    });
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.stderr = [];
    this.stderrRemainder = "";
    this.traces = [];
    this.waitingForTrace = [];
    this.closed = false;
    this.currentProfile = null;
    this.lastProfile = null;

    this.child.stdout.on("data", chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainOutput();
    });

    this.child.stderr.on("data", chunk => {
      this.stderr.push(chunk);
      this.stderrRemainder += chunk.toString("utf8");
      let idx;
      while ((idx = this.stderrRemainder.indexOf("\n")) !== -1) {
        const line = this.stderrRemainder.slice(0, idx).trim();
        this.stderrRemainder = this.stderrRemainder.slice(idx + 1);
        if (line === "K_PROFILE_BEGIN") {
          this.currentProfile = {};
        } else if (line.startsWith("K_FUNC_CALL ") && this.currentProfile) {
          const match = line.match(/^K_FUNC_CALL name=(\S+) count=(\d+)$/);
          if (match) this.currentProfile[match[1]] = Number(match[2]);
        } else if (line === "K_PROFILE_END") {
          this.lastProfile = this.currentProfile;
          this.currentProfile = null;
        } else if (line.startsWith("K_TRACE_PHASES ")) {
          const parsed = parseTraceLine(line);
          if (parsed) {
            if (this.lastProfile) {
              parsed.profile = this.lastProfile;
              this.lastProfile = null;
            }
            if (this.waitingForTrace.length > 0) {
              const item = this.waitingForTrace.shift();
              item.resolve({ payload: item.payload, trace: parsed });
            } else {
              this.traces.push(parsed);
            }
          }
        }
      }
    });

    this.child.on("error", error => this.fail(error));
    this.child.on("close", status => {
      this.closed = true;
      if (status !== 0) {
        this.fail(new Error(`${this.exePath} --server failed with status ${status}\n${Buffer.concat(this.stderr).toString("utf8")}`.trim()));
      } else if (this.pending.length > 0 || this.waitingForTrace.length > 0) {
        this.fail(new Error(`${this.exePath} --server closed with pending request(s)`));
      }
    });
  }

  fail(error) {
    while (this.pending.length > 0) this.pending.shift().reject(error);
    while (this.waitingForTrace.length > 0) this.waitingForTrace.shift().reject(error);
  }

  drainOutput() {
    while (this.pending.length > 0 && this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) return;
      const payload = Buffer.from(this.buffer.subarray(4, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);
      const req = this.pending.shift();
      if (!req.includeTrace) {
        req.resolve(payload);
      } else if (this.traces.length > 0) {
        const trace = this.traces.shift();
        req.resolve({ payload, trace });
      } else {
        this.waitingForTrace.push({ payload, resolve: req.resolve, reject: req.reject });
      }
    }
  }

  request(payloadWire) {
    if (this.closed) return Promise.reject(new Error(`${this.exePath} --server is closed`));
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject, includeTrace: false });
      const lengthHeader = Buffer.alloc(4);
      lengthHeader.writeUInt32BE(payloadWire.length, 0);
      this.child.stdin.write(Buffer.concat([lengthHeader, payloadWire]));
    });
  }

  requestWithTrace(payloadWire) {
    if (this.closed) return Promise.reject(new Error(`${this.exePath} --server is closed`));
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject, includeTrace: true });
      const lengthHeader = Buffer.alloc(4);
      lengthHeader.writeUInt32BE(payloadWire.length, 0);
      this.child.stdin.write(Buffer.concat([lengthHeader, payloadWire]));
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch {}
    this.child.kill();
  }
}
