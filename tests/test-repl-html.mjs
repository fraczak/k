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
assert(html.includes("enabled-codecs-grid"), "repl.html must contain enabled codecs grid");
assert(!html.includes("btn-input-popup"), "repl.html must NOT contain input button");
assert(!html.includes("input-popup-modal"), "repl.html must NOT contain input popup modal");
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

  const cdpPort = 9333 + Math.floor(Math.random() * 500);
  const chrome = spawn(chromiumBin, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${cdpPort}`,
    "--no-sandbox",
    "--disable-extensions",
    `--user-data-dir=${tmpDir}`,
    `file://${replHtmlPath}`
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const list = await res.json();
        const page = list.find(item => item.url && item.url.includes("repl.html"));
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }

    assert(wsUrl, `Could not connect to Chromium CDP on port ${cdpPort}`);

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

    // Wait for window.kRepl to be ready
    await evaluateAsync(`new Promise((resolve, reject) => {
      let tries = 0;
      const check = () => {
        if (window.kRepl && typeof window.kRepl.executeCommand === "function") resolve(true);
        else if (++tries > 100) reject(new Error("Timeout waiting for window.kRepl"));
        else setTimeout(check, 50);
      };
      check();
    })`);

    // Check UI initialized
    const title = await evaluateAsync(`document.querySelector(".brand-name")?.textContent`);
    assert.strictEqual(title, "k repl", "Brand name should be 'k repl'");

    // Verify VFS curated files
    const vfsList = await evaluateAsync(`window.kRepl.getAllVfsFiles().sort()`);
    const expectedFiles = [
      "arithmetics.k",
      "core.k",
      "ieee.k",
      "ieee.mjs",
      "int.mjs",
      "json.mjs",
      "poly.k",
      "unit.mjs",
      "utf8.mjs"
    ].sort();
    assert.deepStrictEqual(vfsList, expectedFiles, `getAllVfsFiles() must match curated files list, got: ${JSON.stringify(vfsList)}`);

    // Test :load arithmetics.k
    const loadOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":load arithmetics.k");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(loadOut.includes("loaded arithmetics.k"), `Expected loaded arithmetics.k, got: ${loadOut}`);

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

    // Test :codec load int.mjs
    const loadIntOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codec load int.mjs");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(loadIntOut.includes("loaded codec int.mjs"), `Expected loaded codec int.mjs, got: ${loadIntOut}`);

    // Check codecs badge updated to 1
    const badgeCount = await evaluateAsync(`document.getElementById("codecs-count-badge")?.textContent`);
    assert.strictEqual(badgeCount, "1", "Codecs badge count should be 1 after loading int.mjs codec");

    // Test evaluating 10 int with int.mjs codec active -> output should format using int.mjs serializer
    const formattedVal = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand("10 int");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(formattedVal.includes("int.mjs: 10"), `Expected 'int.mjs: 10' in output, got: ${formattedVal}`);

    // Test modal interaction via openCodecsModal (only enabled codecs shown)
    const modalCheck = await evaluateAsync(`(() => {
      window.kRepl.openCodecsModal();
      const modal = document.getElementById("codecs-modal");
      const cardInt = document.getElementById("card-codec-int_mjs");
      const grid = document.getElementById("enabled-codecs-grid");
      const cards = grid ? Array.from(grid.querySelectorAll(".codec-card")) : [];

      return {
        open: modal?.classList.contains("open"),
        hasIntCard: Boolean(cardInt),
        cardCount: cards.length
      };
    })()`);
    assert.strictEqual(modalCheck.open, true, "Codecs modal should open");
    assert.strictEqual(modalCheck.hasIntCard, true, "Card for enabled int.mjs codec should exist");
    assert.strictEqual(modalCheck.cardCount, 1, "Only 1 enabled codec card should exist");

    // Test loading unit.mjs via REPL command
    const loadUnitOut = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codec load unit.mjs");
      window.kRepl.openCodecsModal();
      const cardUnit = document.getElementById("card-codec-unit_mjs");
      const badge = document.getElementById("codecs-count-badge");
      return {
        hasUnitCard: Boolean(cardUnit),
        badgeCount: badge?.textContent
      };
    })()`);
    assert.strictEqual(loadUnitOut.hasUnitCard, true, "card-codec-unit_mjs should exist after loading unit.mjs");
    assert.strictEqual(loadUnitOut.badgeCount, "2", "Badge count should be 2 after loading unit.mjs");

    // Test unloading unit.mjs via card Unload button
    const unloadUnitCheck = await evaluateAsync(`(async () => {
      const unloadBtn = document.querySelector("#card-codec-unit_mjs .btn-danger");
      unloadBtn.click();
      await new Promise(r => setTimeout(r, 60));
      const cardUnit = document.getElementById("card-codec-unit_mjs");
      const badge = document.getElementById("codecs-count-badge");
      return {
        hasUnitCard: Boolean(cardUnit),
        badgeCount: badge?.textContent
      };
    })()`);
    assert.strictEqual(unloadUnitCheck.hasUnitCard, false, "card-codec-unit_mjs should be removed after Unload");
    assert.strictEqual(unloadUnitCheck.badgeCount, "1", "Badge count should be 1 after unloading unit.mjs");

    // Close codecs modal
    await evaluateAsync(`(() => {
      document.getElementById("codecs-modal")?.classList.remove("open");
    })()`);

    // Test :input directive without args outputs usage in terminal
    await evaluateAsync(`window.kRepl.executeCommand(":input")`);
    const inputUsageCheck = await evaluateAsync(`(() => {
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines.slice(-2).join(" ");
    })()`);
    assert(inputUsageCheck.includes("Usage: :input <codec.mjs> [text]"), `Expected usage text, got: ${inputUsageCheck}`);

    // Test :input int.mjs sets prompt to int.mjs>
    await evaluateAsync(`window.kRepl.executeCommand(":input int.mjs")`);
    const promptAfterInput = await evaluateAsync(`document.getElementById("prompt-label")?.textContent`);
    assert.strictEqual(promptAfterInput, "int.mjs> ", `Expected prompt label 'int.mjs> ', got: '${promptAfterInput}'`);

    // Enter value '55' at the prompt
    const submitResult = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand("55");
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(submitResult.includes("int.mjs: 55"), `Expected int.mjs: 55 after entering value, got: ${submitResult}`);

    // Verify prompt is restored to '> '
    const promptAfterValue = await evaluateAsync(`document.getElementById("prompt-label")?.textContent`);
    assert.strictEqual(promptAfterValue, "> ", `Expected prompt label '> ', got: '${promptAfterValue}'`);

    // Test Tab autocompletion for :input: typing ":input " and pressing Tab does NOT repeat :input
    const tabCompletionCheck = await evaluateAsync(`(() => {
      const inputEl = document.getElementById("repl-input");
      inputEl.value = ":input ";
      inputEl.selectionStart = inputEl.selectionEnd = 7;
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      inputEl.dispatchEvent(event);
      return {
        value: inputEl.value,
        hasDuplicates: inputEl.value.includes(":input :input")
      };
    })()`);
    assert.strictEqual(tabCompletionCheck.hasDuplicates, false, `:input Tab completion duplicated command: '${tabCompletionCheck.value}'`);
    assert(tabCompletionCheck.value.startsWith(":input int.mjs"), `Expected completion to start with ':input int.mjs', got: '${tabCompletionCheck.value}'`);

    // Test JSON codec with float64 in browser: :input json.mjs then {"a":"Woj","n":123}
    await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":load core.k");
      await window.kRepl.executeCommand(":load ieee.k");
      await window.kRepl.executeCommand(":codec load json.mjs");
      await window.kRepl.executeCommand(":input json.mjs");
    })()`);
    const jsonPromptCheck = await evaluateAsync(`document.getElementById("prompt-label")?.textContent`);
    assert.strictEqual(jsonPromptCheck, "json.mjs> ", `Expected prompt 'json.mjs> ', got: '${jsonPromptCheck}'`);

    // Enter JSON value with float64
    const jsonResult = await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand('{"a":"Woj","n":123}');
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(jsonResult.includes('json.mjs: {"a":"Woj","n":123}'), `Expected json.mjs: {"a":"Woj","n":123}, got: ${jsonResult}`);

    // Verify Reset button is removed from navbar
    const hasResetBtn = await evaluateAsync(`Boolean(document.getElementById("btn-reset"))`);
    assert.strictEqual(hasResetBtn, false, "Reset button should be removed from navbar");

    // Test one-line codec input: :input json.mjs {"a":"Test","n":456}
    await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(':input json.mjs {"a":"Test","n":456}');
    })()`);
    const patternResult = await evaluateAsync(`(() => {
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(patternResult.includes('json.mjs: {"a":"Test","n":456}'), `Expected json.mjs: {"a":"Test","n":456}, got: ${patternResult}`);

    // Test integer list input: :input int.mjs [0,1,2]
    await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":input int.mjs [0,1,2]");
    })()`);
    const listResult = await evaluateAsync(`(() => {
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(listResult.includes('int.mjs: [0,1,2]'), `Expected int.mjs: [0,1,2], got: ${listResult}`);

    // Test utf8.mjs input: :input utf8.mjs Hello world
    await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codec load utf8.mjs");
      await window.kRepl.executeCommand(":input utf8.mjs Hello world");
    })()`);
    const utf8Result = await evaluateAsync(`(() => {
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(utf8Result.includes('utf8.mjs: Hello world'), `Expected utf8.mjs: Hello world, got: ${utf8Result}`);

    // Test ieee.mjs input: :input ieee.mjs 3.14159
    await evaluateAsync(`(async () => {
      await window.kRepl.executeCommand(":codec load ieee.mjs");
      await window.kRepl.executeCommand(":input ieee.mjs 3.14159");
    })()`);
    const ieeeResult = await evaluateAsync(`(() => {
      const lines = Array.from(document.querySelectorAll(".entry-line")).map(el => el.textContent);
      return lines[lines.length - 1];
    })()`);
    assert(ieeeResult.includes('ieee.mjs: 3.14159'), `Expected ieee.mjs: 3.14159, got: ${ieeeResult}`);


    // Verify text selection holds in output element
    const selectionCheck = await evaluateAsync(`(() => {
      const output = document.getElementById("terminal-output");
      const range = document.createRange();
      range.selectNodeContents(output);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      // Simulate click on terminal container/output
      output.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return window.getSelection().toString().length > 0;
    })()`);
    assert.strictEqual(selectionCheck, true, "Selection in terminal output should hold after click");

    // === Test Tree View Functionality ===
    console.log("   Verifying Tree View: initial depth <= 3, folding/unfolding, mode toggle, and pattern cycles...");

    // 1. Evaluate a 5-level deep nested product: { { { { {} e } d } c } b }
    await evaluateAsync(`window.kRepl.executeCommand("{ { { { {} e } d } c } b }")`);

    const treeCheck = await evaluateAsync(`(() => {
      const entries = document.querySelectorAll(".terminal-entry");
      const lastEntry = entries[entries.length - 1];
      const container = lastEntry.querySelector(".k-entry-container");
      if (!container) return { error: "No .k-entry-container found" };

      const treeView = container.querySelector(".k-tree-view");
      const rawView = container.querySelector(".k-raw-view");
      const treeBtn = container.querySelector(".k-btn-mode.active");
      const rawBtn = container.querySelectorAll(".k-btn-mode")[1];

      // Check Value section
      const valSection = container.querySelector(".k-tree-value-section");
      if (!valSection) return { error: "No value section" };
      if (valSection.open) return { error: "Value section should be collapsed by default (open === false)" };

      // Check product details nodes hierarchy
      // Level 1: root product (depth 1)
      const level1 = valSection.querySelector(".k-tree-section-body > .k-tree-node.k-tree-product");
      if (!level1 || !level1.open) return { error: "Level 1 product should be open" };

      // Level 2: .b product (depth 2)
      const level2 = level1.querySelector(".k-tree-children .k-tree-node.k-tree-product");
      if (!level2 || !level2.open) return { error: "Level 2 product should be open" };

      // Level 3: .c product (depth 3)
      const level3 = level2.querySelector(".k-tree-children .k-tree-node.k-tree-product");
      if (!level3 || !level3.open) return { error: "Level 3 product should be open" };

      // Level 4: .d product (depth 4) -> MUST BE COLLAPSED (open === false)
      const level4 = level3.querySelector(".k-tree-children .k-tree-node.k-tree-product");
      if (!level4) return { error: "Level 4 product node missing" };
      if (level4.open) return { error: "Level 4 product should be collapsed (open === false)" };

      // Check pattern section exists and is collapsed by default
      const patSection = container.querySelector(".k-tree-pat-section");
      if (!patSection) return { error: "No pattern section" };
      if (patSection.open) return { error: "Pattern section should be collapsed by default (open === false)" };

      // Test Mode Toggle: click Raw
      rawBtn.click();
      const rawVisible = rawView.style.display !== "none" && treeView.style.display === "none";

      // Click Tree back
      container.querySelector(".k-btn-mode").click();
      const treeVisible = treeView.style.display !== "none" && rawView.style.display === "none";

      // Test Unfolding Level 4
      level4.open = true;
      level4.dispatchEvent(new Event("toggle"));

      // After toggle, level 4's children should be populated with .e
      const level4Text = level4.textContent;
      const unfoldedHasE = level4Text.includes(".e") || level4Text.includes("42");

      return {
        success: true,
        rawVisible,
        treeVisible,
        unfoldedHasE
      };
    })()`);

    assert.strictEqual(treeCheck.success, true, `Tree view validation failed: ${treeCheck.error}`);
    assert.strictEqual(treeCheck.rawVisible, true, "Clicking Raw should show raw view and hide tree view");
    assert.strictEqual(treeCheck.treeVisible, true, "Clicking Tree should restore tree view");
    assert.strictEqual(treeCheck.unfoldedHasE, true, "Unfolding level 4 should lazily populate its children");

    // 2. Test recursive pattern tree with cycle detection
    await evaluateAsync(`window.kRepl.executeCommand("10")`);
    const patCycleCheck = await evaluateAsync(`(() => {
      const entries = document.querySelectorAll(".terminal-entry");
      const lastEntry = entries[entries.length - 1];
      const patSection = lastEntry.querySelector(".k-tree-pat-section");
      if (!patSection) return { error: "No pattern section for 10" };

      const cycleBadges = patSection.querySelectorAll(".k-badge-cycle");
      const varDefs = patSection.querySelectorAll(".k-pat-vardef");

      return {
        hasCycleBadge: cycleBadges.length > 0,
        hasVarDef: varDefs.length > 0
      };
    })()`);

    assert.strictEqual(patCycleCheck.hasCycleBadge, true, "Pattern tree for recursive type should have cycle badge");
    assert.strictEqual(patCycleCheck.hasVarDef, true, "Pattern tree for recursive type should have variable definition (=X0)");

    // 3. Test variant chain depth limits and Expand All / Collapse All on 10
    const variantDepthAndActionsCheck = await evaluateAsync(`(() => {
      const entries = document.querySelectorAll(".terminal-entry");
      const lastEntry = entries[entries.length - 1];
      const valSection = lastEntry.querySelector(".k-tree-value-section");

      // Hierarchy for 10 (variant chain: + -> 1 -> 0 -> 1 -> ...)
      const v1 = valSection?.querySelector(".k-tree-section-body > .k-tree-node.k-tree-variant");
      const v2 = v1?.querySelector(".k-tree-children .k-tree-node.k-tree-variant");
      const v3 = v2?.querySelector(".k-tree-children .k-tree-node.k-tree-variant");
      const v4 = v3?.querySelector(".k-tree-children .k-tree-node.k-tree-variant");

      const v1Open = !!v1?.open;
      const v2Open = !!v2?.open;
      const v3Open = !!v3?.open;
      const v4Collapsed = v4 ? !v4.open : false;

      // Click Expand All
      const actionBtns = lastEntry.querySelectorAll(".k-btn-action");
      const expandBtn = actionBtns[0];
      const collapseBtn = actionBtns[1];

      expandBtn.click();
      const allOpenAfterExpand = v4.open;

      // Click Collapse All
      collapseBtn.click();
      const newV4 = valSection?.querySelector(
        ".k-tree-section-body > .k-tree-node.k-tree-variant .k-tree-children .k-tree-node.k-tree-variant .k-tree-children .k-tree-node.k-tree-variant .k-tree-children .k-tree-node.k-tree-variant"
      );
      const v4CollapsedAgain = newV4 ? !newV4.open : false;

      return {
        v1Open,
        v2Open,
        v3Open,
        v4Collapsed,
        allOpenAfterExpand,
        v4CollapsedAgain
      };
    })()`);

    assert.strictEqual(variantDepthAndActionsCheck.v1Open, true, "Variant level 1 must be open");
    assert.strictEqual(variantDepthAndActionsCheck.v2Open, true, "Variant level 2 must be open");
    assert.strictEqual(variantDepthAndActionsCheck.v3Open, true, "Variant level 3 must be open");
    assert.strictEqual(variantDepthAndActionsCheck.v4Collapsed, true, "Variant level 4 must be collapsed by default");
    assert.strictEqual(variantDepthAndActionsCheck.allOpenAfterExpand, true, "Expand button should expand collapsed nodes");
    assert.strictEqual(variantDepthAndActionsCheck.v4CollapsedAgain, true, "Collapse button should reset deeper nodes to collapsed");

    // 4. Verify shortened welcome banner
    const bannerCheck = await evaluateAsync(`(() => {
      const banner = document.querySelector(".welcome-banner");
      const title = banner?.querySelector(".welcome-title")?.textContent.trim();
      const desc = banner?.querySelector(".welcome-desc");
      const tips = banner?.querySelector(".welcome-tips");
      return { hasBanner: !!banner, title, hasDesc: !!desc, hasTips: !!tips };
    })()`);
    assert.strictEqual(bannerCheck.hasBanner, true, "Welcome banner should be present");
    assert.strictEqual(bannerCheck.title, "k interactive repl", "Welcome banner title should be 'k interactive repl'");
    assert.strictEqual(bannerCheck.hasDesc, false, "Welcome banner description should be removed");
    assert.strictEqual(bannerCheck.hasTips, false, "Welcome banner tips should be removed");

    // 5. Test narrow viewport rendering (e.g. 600px width)
    await send("Emulation.setDeviceMetricsOverride", { width: 600, height: 800, deviceScaleFactor: 1, mobile: false });
    const narrowNavbarCheck = await evaluateAsync(`(() => {
      const btnHelp = document.getElementById("btn-help");
      if (!btnHelp) return { found: false };
      const rect = btnHelp.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth;
      btnHelp.click();
      const helpModalOpen = document.getElementById("help-modal")?.classList.contains("open");
      const modalText = document.getElementById("help-modal")?.textContent || "";
      const hasRel = modalText.includes(":rel ");
      const hasVal = modalText.includes(":val");
      const hasTiming = modalText.includes(":timing");
      const hasCodecDefine = modalText.includes(":codec define");
      const hasType = modalText.includes(":type <name>");
      return {
        found: true,
        isVisible,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        helpModalOpen,
        hasRel,
        hasVal,
        hasTiming,
        hasCodecDefine,
        hasType
      };
    })()`);
    assert.strictEqual(narrowNavbarCheck.found, true, "#btn-help should exist");
    assert.strictEqual(narrowNavbarCheck.isVisible, true, "#btn-help should be visible within narrow viewport");
    assert.strictEqual(narrowNavbarCheck.helpModalOpen, true, "Clicking #btn-help in narrow viewport should open help modal");
    assert.strictEqual(narrowNavbarCheck.hasRel, false, "Help modal should not contain :rel");
    assert.strictEqual(narrowNavbarCheck.hasVal, false, "Help modal should not contain :val");
    assert.strictEqual(narrowNavbarCheck.hasTiming, false, "Help modal should not contain :timing");
    assert.strictEqual(narrowNavbarCheck.hasCodecDefine, false, "Help modal should not contain :codec define");
    assert.strictEqual(narrowNavbarCheck.hasType, true, "Help modal should contain :type <name>");

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
