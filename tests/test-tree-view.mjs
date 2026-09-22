import assert from "node:assert";
import { Value } from "../Value.mjs";
import {
  renderValueNode,
  renderPatternTree,
  createOutputEntryElement
} from "../browser/tree-view.mjs";

console.log("=== Testing Tree View (browser/tree-view.mjs) ===");

// Lightweight DOM mock for testing tree construction in Node.js
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
    this.open = false;
    this.children = [];
    this.listeners = {};
    this.style = {};
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }

  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || this.textContent;
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
    this._textContent = String(val).replace(/<[^>]*>/g, "");
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) fn(event);
  }

  querySelectorAll(selector) {
    const results = [];
    const check = (el) => {
      for (const child of el.children) {
        if (child instanceof MockElement) {
          let matches = false;
          if (selector === "details" && child.tagName === "DETAILS") matches = true;
          if (selector.startsWith(".") && child.className.split(" ").includes(selector.slice(1))) matches = true;
          if (matches) results.push(child);
          check(child);
        }
      }
    };
    check(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
  }
};
globalThis.Event = class Event {
  constructor(type) {
    this.type = type;
  }
};

// 1. Test renderValueNode for empty product
const emptyVal = Value.product({});
const emptyEl = renderValueNode(emptyVal);
assert.strictEqual(emptyEl.textContent, "{}", "Empty product must render as '{}'");

// 2. Test renderValueNode for nested products (depth tracking)
// { a: { b: { c: { d: {} } } } }
const deepProduct = Value.product({
  a: Value.product({
    b: Value.product({
      c: Value.product({
        d: Value.product({})
      })
    })
  })
});

const treeRoot = renderValueNode(deepProduct, 1, 3);
assert.strictEqual(treeRoot.tagName, "DETAILS", "Root product should be a <details> element");
assert.strictEqual(treeRoot.open, true, "Root product (depth 1) must be open");

// Find child .a
const nodeA = treeRoot.querySelectorAll(".k-tree-node")[0];
assert(nodeA, "Node .a must exist");
assert.strictEqual(nodeA.open, true, "Node .a (depth 2) must be open");

// Find child .b
const nodeB = nodeA.querySelectorAll(".k-tree-node")[0];
assert(nodeB, "Node .b must exist");
assert.strictEqual(nodeB.open, true, "Node .b (depth 3) must be open");

// Find child .c
const nodeC = nodeB.querySelectorAll(".k-tree-node")[0];
assert(nodeC, "Node .c must exist");
assert.strictEqual(nodeC.open, false, "Node .c (depth 4) must be collapsed (open === false)");

// Test lazy unfolding of node .c
assert.strictEqual(nodeC.querySelector(".k-tree-children").children.length, 0, "Children of collapsed node must not be populated initially");
nodeC.open = true;
nodeC.dispatchEvent(new Event("toggle"));
assert(nodeC.querySelector(".k-tree-children").children.length > 0, "Unfolding node .c must lazily populate its children");
assert(nodeC.textContent.includes(".d:"), "Unfolded children must include .d:");

// 3. Test renderValueNode for variant chain (integers: + -> 1 -> 0 -> 1 -> _ -> {})
const variantVal = Value.variant(
  "+",
  Value.variant(
    "1",
    Value.variant(
      "0",
      Value.variant(
        "1",
        Value.variant("_", Value.product({}))
      )
    )
  )
);

const varTree = renderValueNode(variantVal, 1, 3);
assert.strictEqual(varTree.tagName, "DETAILS");
assert.strictEqual(varTree.open, true, "Variant depth 1 (+) must be open");

const var2 = varTree.querySelectorAll(".k-tree-variant")[0];
assert.strictEqual(var2.open, true, "Variant depth 2 (1) must be open");

const var3 = var2.querySelectorAll(".k-tree-variant")[0];
assert.strictEqual(var3.open, true, "Variant depth 3 (0) must be open");

const var4 = var3.querySelectorAll(".k-tree-variant")[0];
assert.strictEqual(var4.open, false, "Variant depth 4 (1) must be collapsed");

// 4. Test renderPatternTree with cycles (recursive integer type: ?<<X0 0, X0 1, {} _>=X0 +, X0 ->)
const recursivePattern = [
  ["closed-union", [["+", 1], ["-", 1]]],
  ["closed-union", [["0", 1], ["1", 1], ["_", 2]]],
  ["closed-product", []]
];

const patTree = renderPatternTree(recursivePattern, 3);
assert.strictEqual(patTree.tagName, "DETAILS");
assert.strictEqual(patTree.open, true, "Root pattern node must be open");
assert(patTree.textContent.includes("recursive"), "Recursive cycle must be detected and marked 'recursive'");

// 5. Test createOutputEntryElement
const entryEl = createOutputEntryElement({
  value: variantVal,
  rawText: "{}|_|1|0|1|+ ?<<X0 0, X0 1, {} _>=X0 +, X0 ->\nint: 11",
  codecOutputs: ["int: 11"]
});

assert(entryEl.querySelector(".k-tree-view"), "Tree view container must exist");
assert(entryEl.querySelector(".k-raw-view"), "Raw view container must exist");
assert(entryEl.textContent.includes("int: 11"), "Codec output must be visible in container");

console.log("OK - All tree view unit tests passed.");
