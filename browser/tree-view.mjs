import { isProduct, isVariant } from "../Value.mjs";
import { propertyListToFilter, valueToK } from "../codecs/runtime/show-value.mjs";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function previewProductFields(val, maxItems = 3) {
  if (!isProduct(val)) return "";
  const keys = Object.keys(val.product);
  if (keys.length === 0) return "{}";
  const previewKeys = keys.slice(0, maxItems).map((k) => `.${k}`);
  if (keys.length > maxItems) previewKeys.push("...");
  return previewKeys.join(", ");
}

function previewValue(val, maxItems = 4) {
  if (val === null || val === undefined) return String(val);
  if (isProduct(val)) {
    const keys = Object.keys(val.product);
    if (keys.length === 0) return "{}";
    const previewKeys = keys.slice(0, maxItems).map((k) => `.${k}`);
    if (keys.length > maxItems) previewKeys.push("...");
    return `{ ${previewKeys.join(", ")} }`;
  }
  if (isVariant(val)) {
    const tags = [];
    let curr = val;
    while (isVariant(curr) && tags.length < maxItems) {
      tags.push(curr.tag);
      curr = curr.value;
    }
    if (isVariant(curr)) tags.push("...");
    return `| ${tags.join(" | ")}`;
  }
  return String(val);
}

export function renderValueNode(val, currentDepth = 1, depthLimit = 3) {
  if (val === null || val === undefined) {
    const el = document.createElement("span");
    el.className = "k-tree-leaf k-val-nil";
    el.textContent = String(val);
    return el;
  }

  if (isProduct(val)) {
    const keys = Object.keys(val.product);
    if (keys.length === 0) {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-val-empty";
      el.textContent = "{}";
      return el;
    }

    const details = document.createElement("details");
    details.className = "k-tree-node k-tree-product";
    const isOpen = currentDepth <= depthLimit;
    details.open = isOpen;

    const summary = document.createElement("summary");
    summary.className = "k-tree-summary";

    const arrow = document.createElement("span");
    arrow.className = "k-tree-arrow";
    arrow.textContent = "▶";
    summary.appendChild(arrow);

    const openBrace = document.createElement("span");
    openBrace.className = "k-val-brace";
    openBrace.textContent = "{";
    summary.appendChild(openBrace);

    const badge = document.createElement("span");
    badge.className = "k-tree-badge";
    badge.textContent = `${keys.length} ${keys.length === 1 ? "field" : "fields"}`;
    summary.appendChild(badge);

    const preview = document.createElement("span");
    preview.className = "k-val-preview";
    preview.textContent = previewProductFields(val, 3);
    summary.appendChild(preview);

    const closeBrace = document.createElement("span");
    closeBrace.className = "k-val-brace";
    closeBrace.textContent = "}";
    summary.appendChild(closeBrace);

    details.appendChild(summary);

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "k-tree-children";
    details.appendChild(childrenContainer);

    let populated = false;
    const populateChildren = () => {
      if (populated) return;
      populated = true;
      for (const k of keys) {
        const row = document.createElement("div");
        row.className = "k-tree-row";

        const keySpan = document.createElement("span");
        keySpan.className = "k-tree-field-key";
        keySpan.textContent = `.${k}:`;
        row.appendChild(keySpan);

        const childContainer = document.createElement("div");
        childContainer.className = "k-tree-child-val";
        childContainer.appendChild(
          renderValueNode(val.product[k], isOpen ? currentDepth + 1 : 1, depthLimit)
        );
        row.appendChild(childContainer);

        childrenContainer.appendChild(row);
      }
    };

    if (isOpen) {
      populateChildren();
    } else {
      details.addEventListener("toggle", () => {
        if (details.open) {
          populateChildren();
        }
      });
    }

    return details;
  }

  if (isVariant(val)) {
    const isTerminal = isProduct(val.value) && Object.keys(val.value.product).length === 0;
    if (isTerminal) {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-tree-variant-leaf";
      el.innerHTML = `<span class="k-val-pipe">|</span> <span class="k-val-tag">${escapeHtml(val.tag)}</span>`;
      return el;
    }

    const details = document.createElement("details");
    details.className = "k-tree-node k-tree-variant";
    const isOpen = currentDepth <= depthLimit;
    details.open = isOpen;

    const summary = document.createElement("summary");
    summary.className = "k-tree-summary";

    const arrow = document.createElement("span");
    arrow.className = "k-tree-arrow";
    arrow.textContent = "▶";
    summary.appendChild(arrow);

    const pipeSpan = document.createElement("span");
    pipeSpan.className = "k-val-pipe";
    pipeSpan.textContent = "|";
    summary.appendChild(pipeSpan);

    const tagSpan = document.createElement("span");
    tagSpan.className = "k-val-tag";
    tagSpan.textContent = val.tag;
    summary.appendChild(tagSpan);

    if (isVariant(val.value)) {
      let chainCount = 0;
      let curr = val.value;
      while (isVariant(curr)) {
        chainCount++;
        curr = curr.value;
      }
      const badge = document.createElement("span");
      badge.className = "k-tree-badge";
      badge.textContent = `+${chainCount} tags`;
      summary.appendChild(badge);
    }

    const preview = document.createElement("span");
    preview.className = "k-val-preview";
    preview.textContent = previewValue(val.value, 3);
    summary.appendChild(preview);

    details.appendChild(summary);

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "k-tree-children";
    details.appendChild(childrenContainer);

    let populated = false;
    const populateChild = () => {
      if (populated) return;
      populated = true;
      const row = document.createElement("div");
      row.className = "k-tree-row";
      const childContainer = document.createElement("div");
      childContainer.className = "k-tree-child-val";
      childContainer.appendChild(
        renderValueNode(val.value, isOpen ? currentDepth + 1 : 1, depthLimit)
      );
      row.appendChild(childContainer);
      childrenContainer.appendChild(row);
    };

    if (isOpen) {
      populateChild();
    } else {
      details.addEventListener("toggle", () => {
        if (details.open) {
          populateChild();
        }
      });
    }

    return details;
  }

  const el = document.createElement("span");
  el.className = "k-tree-leaf k-val-primitive";
  el.textContent = String(val);
  return el;
}

export function renderPatternTree(propertyList, depthLimit = 3) {
  if (!propertyList || propertyList.length === 0) {
    const el = document.createElement("span");
    el.className = "k-tree-leaf k-pat-empty";
    el.textContent = "(...)";
    return el;
  }

  const refCount = new Array(propertyList.length).fill(0);
  for (const [, edges] of propertyList) {
    for (const [, target] of edges) {
      if (target >= 0 && target < propertyList.length) {
        refCount[target]++;
      }
    }
  }
  refCount[0]++;

  const varNames = new Map();
  let varCounter = 0;
  for (let i = 0; i < propertyList.length; i++) {
    if (refCount[i] > 1) {
      varNames.set(i, `X${varCounter++}`);
    }
  }

  const definedNodes = new Set();

  function renderNode(nodeId, currentDepth, maxDepth, ancestors = new Set()) {
    if (nodeId == null || nodeId < 0 || nodeId >= propertyList.length) {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-pat-empty";
      el.textContent = "(...)";
      return el;
    }

    const hasVar = varNames.has(nodeId);
    const varName = hasVar ? varNames.get(nodeId) : null;

    // Cycle detection
    if (ancestors.has(nodeId)) {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-pat-cycle";
      el.innerHTML = `<span class="k-pat-var">${escapeHtml(varName || `X${nodeId}`)}</span> <span class="k-tree-badge k-badge-cycle">recursive</span>`;
      return el;
    }

    // Already defined on an earlier branch
    if (hasVar && definedNodes.has(nodeId)) {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-pat-ref";
      el.innerHTML = `<span class="k-pat-var">${escapeHtml(varName)}</span>`;
      return el;
    }

    if (hasVar) {
      definedNodes.add(nodeId);
    }

    const newAncestors = new Set(ancestors);
    newAncestors.add(nodeId);

    const [kind, edges] = propertyList[nodeId];

    if (kind === "any") {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-pat-any";
      el.textContent = hasVar ? varName : "(...)";
      return el;
    }

    const isProductPat = kind.endsWith("product");
    const isOpenPat = kind.startsWith("open-");
    const openChar = isProductPat ? "{" : "<";
    const closeChar = isProductPat ? "}" : ">";
    const itemLabel = isProductPat ? "field" : "variant";

    if (edges.length === 0 && !isOpenPat) {
      const el = document.createElement("span");
      el.className = "k-tree-leaf k-pat-empty";
      const varSuffix = hasVar ? `=${varName}` : "";
      el.innerHTML = `<span class="k-pat-brace">${openChar}${closeChar}</span>${varSuffix ? `<span class="k-pat-vardef">${varSuffix}</span>` : ""}`;
      return el;
    }

    const details = document.createElement("details");
    details.className = `k-tree-node ${isProductPat ? "k-pat-product" : "k-pat-union"}`;
    const isOpen = currentDepth <= maxDepth;
    details.open = isOpen;

    const summary = document.createElement("summary");
    summary.className = "k-tree-summary";

    const arrow = document.createElement("span");
    arrow.className = "k-tree-arrow";
    arrow.textContent = "▶";
    summary.appendChild(arrow);

    const openSpan = document.createElement("span");
    openSpan.className = isProductPat ? "k-pat-brace" : "k-pat-union";
    openSpan.textContent = openChar;
    summary.appendChild(openSpan);

    const badge = document.createElement("span");
    badge.className = "k-tree-badge";
    badge.textContent = `${edges.length} ${edges.length === 1 ? itemLabel : itemLabel + "s"}${isOpenPat ? ", ..." : ""}`;
    summary.appendChild(badge);

    if (hasVar) {
      const varDefSpan = document.createElement("span");
      varDefSpan.className = "k-pat-vardef";
      varDefSpan.textContent = `=${varName}`;
      summary.appendChild(varDefSpan);
    }

    const closeSpan = document.createElement("span");
    closeSpan.className = isProductPat ? "k-pat-brace" : "k-pat-union";
    closeSpan.textContent = closeChar;
    summary.appendChild(closeSpan);

    details.appendChild(summary);

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "k-tree-children";
    details.appendChild(childrenContainer);

    let populated = false;
    const populateChildren = () => {
      if (populated) return;
      populated = true;
      for (const [label, target] of edges) {
        const row = document.createElement("div");
        row.className = "k-tree-row";

        const labelSpan = document.createElement("span");
        if (isProductPat) {
          labelSpan.className = "k-pat-field-key";
          labelSpan.textContent = `.${label}:`;
        } else {
          labelSpan.className = "k-pat-tag";
          labelSpan.innerHTML = `<span class="k-val-pipe">|</span> ${escapeHtml(label)}`;
        }
        row.appendChild(labelSpan);

        const childContainer = document.createElement("div");
        childContainer.className = "k-tree-child-pat";
        childContainer.appendChild(
          renderNode(target, isOpen ? currentDepth + 1 : 1, maxDepth, newAncestors)
        );
        row.appendChild(childContainer);

        childrenContainer.appendChild(row);
      }

      if (isOpenPat) {
        const row = document.createElement("div");
        row.className = "k-tree-row";
        const ellipsis = document.createElement("span");
        ellipsis.className = "k-pat-ellipsis";
        ellipsis.textContent = "...";
        row.appendChild(ellipsis);
        childrenContainer.appendChild(row);
      }
    };

    if (isOpen) {
      populateChildren();
    } else {
      details.addEventListener("toggle", () => {
        if (details.open) {
          populateChildren();
        }
      });
    }

    return details;
  }

  return renderNode(0, 1, depthLimit);
}

export function createOutputEntryElement({
  value,
  rawText,
  codecOutputs = [],
  timingText = null
}) {
  const container = document.createElement("div");
  container.className = "entry-line line-output k-entry-container";

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "k-output-toolbar";

  // Mode buttons group
  const modeGroup = document.createElement("div");
  modeGroup.className = "k-mode-group";

  const treeBtn = document.createElement("button");
  treeBtn.type = "button";
  treeBtn.className = "k-btn-mode active";
  treeBtn.innerHTML = `<span class="k-mode-icon">🌲</span> Tree`;
  treeBtn.title = "View structured Value & Pattern trees";

  const rawBtn = document.createElement("button");
  rawBtn.type = "button";
  rawBtn.className = "k-btn-mode";
  rawBtn.innerHTML = `<span class="k-mode-icon">📄</span> Raw`;
  rawBtn.title = "View raw K expression & pattern text";

  modeGroup.appendChild(treeBtn);
  modeGroup.appendChild(rawBtn);
  toolbar.appendChild(modeGroup);

  // Tree Action buttons group (Expand / Collapse / Copy)
  const actionGroup = document.createElement("div");
  actionGroup.className = "k-action-group";

  const expandAllBtn = document.createElement("button");
  expandAllBtn.type = "button";
  expandAllBtn.className = "k-btn-action";
  expandAllBtn.innerHTML = `⊞ Expand`;
  expandAllBtn.title = "Expand tree nodes";

  const collapseAllBtn = document.createElement("button");
  collapseAllBtn.type = "button";
  collapseAllBtn.className = "k-btn-action";
  collapseAllBtn.innerHTML = `⊟ Collapse`;
  collapseAllBtn.title = "Reset trees to top 3 levels";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "k-btn-action";
  copyBtn.innerHTML = `📋 Copy`;
  copyBtn.title = "Copy raw output to clipboard";
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(rawText);
    copyBtn.innerHTML = `✓ Copied`;
    setTimeout(() => {
      copyBtn.innerHTML = `📋 Copy`;
    }, 1500);
  };

  actionGroup.appendChild(expandAllBtn);
  actionGroup.appendChild(collapseAllBtn);
  actionGroup.appendChild(copyBtn);
  toolbar.appendChild(actionGroup);

  container.appendChild(toolbar);

  // 1. Tree View Wrapper
  const treeWrapper = document.createElement("div");
  treeWrapper.className = "k-tree-view";

  // Value Section
  const valSection = document.createElement("details");
  valSection.className = "k-tree-section k-tree-value-section";
  valSection.open = true;

  const valSummary = document.createElement("summary");
  valSummary.className = "k-tree-section-summary";
  valSummary.innerHTML = `<span class="k-tree-arrow">▶</span> <span class="k-section-title">🌲 Value</span> <span class="k-section-preview">${escapeHtml(valueToK(value))}</span>`;
  valSection.appendChild(valSummary);

  const valBody = document.createElement("div");
  valBody.className = "k-tree-section-body";
  valBody.appendChild(renderValueNode(value, 1, 3));
  valSection.appendChild(valBody);
  treeWrapper.appendChild(valSection);

  // Pattern Section (if pattern present)
  let patBody = null;
  if (value && value.pattern) {
    const patSection = document.createElement("details");
    patSection.className = "k-tree-section k-tree-pat-section";
    patSection.open = true;

    const patSummary = document.createElement("summary");
    patSummary.className = "k-tree-section-summary";
    const patPreview = propertyListToFilter(value.pattern);
    patSummary.innerHTML = `<span class="k-tree-arrow">▶</span> <span class="k-section-title">🌿 Pattern</span> <span class="k-section-preview">?${escapeHtml(patPreview)}</span>`;
    patSection.appendChild(patSummary);

    patBody = document.createElement("div");
    patBody.className = "k-tree-section-body";
    patBody.appendChild(renderPatternTree(value.pattern, 3));
    patSection.appendChild(patBody);
    treeWrapper.appendChild(patSection);
  }

  // Codecs Section (if any codec outputs)
  if (codecOutputs.length > 0) {
    const codecsBox = document.createElement("div");
    codecsBox.className = "k-codecs-box";
    for (const c of codecOutputs) {
      const cRow = document.createElement("div");
      cRow.className = "k-codec-row";
      cRow.textContent = c;
      codecsBox.appendChild(cRow);
    }
    treeWrapper.appendChild(codecsBox);
  }

  // Timing (if any)
  if (timingText) {
    const timingRow = document.createElement("div");
    timingRow.className = "k-timing-row";
    timingRow.textContent = timingText;
    treeWrapper.appendChild(timingRow);
  }

  container.appendChild(treeWrapper);

  // 2. Raw Text View Wrapper
  const rawWrapper = document.createElement("div");
  rawWrapper.className = "k-raw-view";
  rawWrapper.style.display = "none";

  const rawPre = document.createElement("pre");
  rawPre.className = "k-raw-pre";
  rawPre.textContent = rawText;
  rawWrapper.appendChild(rawPre);

  container.appendChild(rawWrapper);

  // Mode switching logic
  treeBtn.onclick = () => {
    treeBtn.classList.add("active");
    rawBtn.classList.remove("active");
    treeWrapper.style.display = "";
    rawWrapper.style.display = "none";
    expandAllBtn.style.display = "";
    collapseAllBtn.style.display = "";
  };

  rawBtn.onclick = () => {
    rawBtn.classList.add("active");
    treeBtn.classList.remove("active");
    treeWrapper.style.display = "none";
    rawWrapper.style.display = "";
    expandAllBtn.style.display = "none";
    collapseAllBtn.style.display = "none";
  };

  // Expand All / Collapse All logic
  expandAllBtn.onclick = () => {
    const allDetails = treeWrapper.querySelectorAll("details");
    allDetails.forEach((d) => {
      d.open = true;
      d.dispatchEvent(new Event("toggle"));
    });
    // Repeat once to expand lazily populated children
    setTimeout(() => {
      const moreDetails = treeWrapper.querySelectorAll("details:not([open])");
      moreDetails.forEach((d) => {
        d.open = true;
        d.dispatchEvent(new Event("toggle"));
      });
    }, 10);
  };

  collapseAllBtn.onclick = () => {
    valBody.innerHTML = "";
    valBody.appendChild(renderValueNode(value, 1, 3));
    if (value && value.pattern && patBody) {
      patBody.innerHTML = "";
      patBody.appendChild(renderPatternTree(value.pattern, 3));
    }
  };

  return container;
}
