import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const replHtmlPath = path.join(root, "repl.html");

console.log("=== Testing Web REPL (repl.html) ===");

// 1. Build repl.html
console.log("1. Running scripts/build-repl-html.mjs...");
const buildResult = spawnSync(process.execPath, [path.join(root, "scripts/build-repl-html.mjs")], {
  cwd: root,
  stdio: "pipe",
  encoding: "utf8"
});

if (buildResult.status !== 0) {
  console.error(buildResult.stderr || buildResult.stdout);
  process.exit(buildResult.status ?? 1);
}

// 2. Validate self-contained HTML
console.log("2. Validating generated repl.html...");
assert(fs.existsSync(replHtmlPath), "repl.html must exist");
const html = fs.readFileSync(replHtmlPath, "utf8");

assert(html.length > 500000, `repl.html size (${html.length} bytes) is suspiciously small`);
assert(html.includes("<!DOCTYPE html>"), "repl.html must be valid HTML5");
assert(html.includes("<style>"), "repl.html must contain inlined CSS styles");
assert(html.includes('<script type="module">'), "repl.html must contain inlined module script");
assert(!html.includes('<script src="http'), "repl.html must NOT contain external remote scripts");
assert(html.includes("wasm-in-process"), "repl.html must mention wasm-in-process engine");
assert(html.includes("arithmetics.k"), "repl.html must embed standard examples");
assert(html.includes("btn-codecs"), "repl.html must contain Codecs button");
assert(html.includes("codecs-modal"), "repl.html must contain Codecs modal");
assert(html.includes("active-codecs-tbody"), "repl.html must contain active codecs table");
assert(html.includes("codec-preset-select"), "repl.html must contain codec preset templates");
assert(html.includes("btn-input-popup"), "repl.html must contain input button");
assert(html.includes("input-popup-modal"), "repl.html must contain input popup modal");
console.log("   repl.html is valid, self-contained, and has size:", (html.length / 1024).toFixed(1), "KB");

// 3. If Chromium is available, run end-to-end browser test
const chromiumBin = ["chromium-browser", "chromium", "google-chrome"].find(bin => {
  const res = spawnSync("which", [bin], { stdio: "ignore" });
  return res.status === 0;
});

if (chromiumBin) {
  console.log(`3. Running browser verification with ${chromiumBin}...`);
  const tmpDir = `/tmp/chrome-test-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  const chrome = spawn(chromiumBin, [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=9222",
    "--no-sandbox",
    "--disable-extensions",
    `--user-data-dir=${tmpDir}`,
    `file://${replHtmlPath}`
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch("http://127.0.0.1:9222/json/list");
        const list = await res.json();
        const page = list.find(item => item.type === "page" && item.url.includes("repl.html"));
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }

    assert(wsUrl, "Could not connect to Chromium CDP on port 9222");

    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let idCounter = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    function send(method, params = {}) {
      const id = idCounter++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send("Page.enable");
    await send("Runtime.enable");
    await new Promise(r => setTimeout(r, 1200));

    async function evaluateAsync(expression) {
      const res = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || "Evaluation error");
      }
      return res.result?.value;
    }

    // Check UI initialized
    const title = await evaluateAsync(`document.querySelector(".brand-name")?.textContent`);
    assert.strictEqual(title, "k repl", "Brand name should be 'k repl'");

    // Test :load Examples/arithmetics.k
    const loadOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":load Examples/arithmetics.k");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert.strictEqual(loadOut, "loaded Examples/arithmetics.k");

    // Test evaluating 10
    const valOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand("10");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(valOut.includes("{}|_|0|1|0|1"), `Expected 10 in output, got: ${valOut}`);

    // Test {10 int x, 5 int y} plus
    const plusOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand("{10 int x, 5 int y} plus");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(plusOut.includes("{}|_|1|1|1|1|+"), `Expected 15 in output, got: ${plusOut}`);

    // Test :codecs initially empty
    const codecsOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codecs");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert.strictEqual(codecsOut, "(none)");

    // Test :codec load int
    const loadIntOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codec load int");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(loadIntOut.includes("loaded codec int"), `Expected loaded codec int, got: ${loadIntOut}`);

    // Check codecs badge updated to 1
    const badgeCount = await evaluateAsync(`document.getElementById("codecs-count-badge")?.textContent`);
    assert.strictEqual(badgeCount, "1", "Codecs badge count should be 1 after loading int codec");

    // Test evaluating 10 int with int codec active -> output should format using int serializer
    const formattedVal = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand("10 int");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(formattedVal.includes("int: 10"), `Expected 'int: 10' in output, got: ${formattedVal}`);

    // Test defining inline custom codec via :codec define
    await evaluateAsync(`window.kRepl.executeCommand(":type bool = <{} true, {} false>")`);
    const defineCodecOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codec define yn bool ({ parse: (t) => Value.variant(t.trim() === 'yes' ? 'true' : 'false', Value.product({})), print: (v) => v.tag === 'true' ? 'YES' : 'NO' })");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(defineCodecOut.includes("defined codec yn"), `Expected defined codec yn, got: ${defineCodecOut}`);

    // Test modal interaction via openCodecsModal
    const modalIsOpen = await evaluateAsync(`(() => {
      window.kRepl.openCodecsModal();
      return document.getElementById("codecs-modal")?.classList.contains("open");
    })()`);
    assert.strictEqual(modalIsOpen, true, "Codecs modal should open");

    // Close codecs modal
    await evaluateAsync(`(() => {
      document.getElementById("codecs-modal")?.classList.remove("open");
    })()`);

    // Test :input opens input popup modal
    await evaluateAsync(`window.kRepl.executeCommand(":input int")`);
    const inputModalOpen = await evaluateAsync(`document.getElementById("input-popup-modal")?.classList.contains("open")`);
    assert.strictEqual(inputModalOpen, true, "Executing :input int should open input popup modal");

    // Enter value '55' in popup and submit
    const submitResult = await evaluateAsync(`(async () => {
      const textEl = document.getElementById("input-popup-text");
      textEl.value = "55";
      await window.kRepl.submitInputPopup();
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(submitResult.includes("int: 55"), `Expected int: 55 after submitting input popup, got: ${submitResult}`);

    // Verify modal is closed after submission
    const modalClosedAfterSubmit = await evaluateAsync(`!document.getElementById("input-popup-modal")?.classList.contains("open")`);
    assert.strictEqual(modalClosedAfterSubmit, true, "Input modal should be closed after submit");

    // Test :input directive without args opens input popup
    await evaluateAsync(`window.kRepl.executeCommand(":input")`);
    const inputWithoutArgsOpensModal = await evaluateAsync(`document.getElementById("input-popup-modal")?.classList.contains("open")`);
    assert.strictEqual(inputWithoutArgsOpensModal, true, "Executing :input without args should open input popup");

    // Test cancelInputPopup
    await evaluateAsync(`window.kRepl.cancelInputPopup()`);
    const modalClosedAfterCancel = await evaluateAsync(`!document.getElementById("input-popup-modal")?.classList.contains("open")`);
    assert.strictEqual(modalClosedAfterCancel, true, "Input modal should close on cancel");

    ws.close();
    console.log("   Browser execution verified successfully!");
  } finally {
    chrome.kill();
    await new Promise(r => setTimeout(r, 500));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
} else {
  console.log("3. Chromium not found, skipping headless browser CDP step.");
}

console.log("OK - Web REPL test passed.");
