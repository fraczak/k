const vscode = require("vscode");

const NAME_START = /[a-zA-Z0-9_+\-]/;
const NAME_PART = /[a-zA-Z0-9_?!+\-]/;
const OPEN_TO_CLOSE = new Map([
  ["{", "}"],
  ["<", ">"],
  ["(", ")"],
  ["[", "]"]
]);
const CLOSERS = new Set(OPEN_TO_CLOSE.values());

function lex(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }

    if (
      (char === "/" && next === "/") ||
      (char === "-" && next === "-") ||
      (char === "\\" && next === "\\") ||
      char === "#" ||
      char === "%"
    ) {
      const end = text.indexOf("\n", index + 1);
      index = end === -1 ? text.length : end + 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      const start = index++;
      while (index < text.length) {
        const current = text[index++];
        if (current === "\\") {
          index++;
        } else if (current === char) {
          break;
        }
      }
      tokens.push({ value: text.slice(start, index), start, end: index });
      continue;
    }

    if (
      char === "." &&
      next === "." &&
      text[index + 2] === "."
    ) {
      tokens.push({ value: "...", start: index, end: index + 3 });
      index += 3;
      continue;
    }

    if (NAME_START.test(char)) {
      const start = index++;
      while (index < text.length && NAME_PART.test(text[index])) index++;
      tokens.push({ value: text.slice(start, index), start, end: index });
      continue;
    }

    tokens.push({ value: char, start: index, end: index + 1 });
    index++;
  }

  return tokens;
}

function isName(token) {
  return token != null && NAME_START.test(token.value[0]);
}

function isString(token) {
  return (
    token != null &&
    (token.value[0] === "\"" || token.value[0] === "'")
  );
}

function isLabelToken(token) {
  return isName(token) || isString(token);
}

function findDefinitionEnd(tokens, startIndex) {
  const stack = [];

  for (let index = startIndex; index < tokens.length; index++) {
    const value = tokens[index].value;
    const closer = OPEN_TO_CLOSE.get(value);
    if (closer) {
      stack.push(closer);
    } else if (CLOSERS.has(value)) {
      if (value !== stack.at(-1)) return -1;
      stack.pop();
    } else if (value === ";" && stack.length === 0) {
      return index;
    }
  }

  return -1;
}

function findMatching(tokens, startIndex) {
  const firstCloser = OPEN_TO_CLOSE.get(tokens[startIndex]?.value);
  if (!firstCloser) return -1;

  const stack = [firstCloser];
  for (let index = startIndex + 1; index < tokens.length; index++) {
    const value = tokens[index].value;
    const closer = OPEN_TO_CLOSE.get(value);
    if (closer) {
      stack.push(closer);
    } else if (CLOSERS.has(value)) {
      if (value !== stack.at(-1)) return -1;
      stack.pop();
      if (stack.length === 0) return index;
    }
  }

  return -1;
}

function splitTopLevelCommas(tokens, startIndex, endIndex) {
  const segments = [];
  const stack = [];
  let segStart = startIndex;

  for (let index = startIndex; index < endIndex; index++) {
    const value = tokens[index].value;
    const closer = OPEN_TO_CLOSE.get(value);
    if (closer) {
      stack.push(closer);
    } else if (CLOSERS.has(value)) {
      if (value === stack.at(-1)) stack.pop();
    } else if (value === "," && stack.length === 0) {
      if (segStart < index) {
        segments.push({ start: segStart, end: index });
      }
      segStart = index + 1;
    }
  }

  if (segStart < endIndex) {
    segments.push({ start: segStart, end: endIndex });
  }

  return segments;
}

function parseCodeEnd(tokens, startIndex) {
  const token = tokens[startIndex];
  if (!token) return -1;

  if (isName(token)) return startIndex + 1;

  if (token.value === "@" && isName(tokens[startIndex + 1])) {
    return startIndex + 2;
  }

  if (token.value === "{" || token.value === "<") {
    const matching = findMatching(tokens, startIndex);
    return matching === -1 ? -1 : matching + 1;
  }

  return -1;
}

function parseFilterEnd(tokens, startIndex) {
  const token = tokens[startIndex];
  if (!token) return -1;

  let endIndex;
  if (token.value === "$") {
    endIndex = parseCodeEnd(tokens, startIndex + 1);
  } else if (
    token.value === "(" ||
    token.value === "{" ||
    token.value === "<"
  ) {
    const matching = findMatching(tokens, startIndex);
    endIndex = matching === -1 ? -1 : matching + 1;
  } else if (
    isName(token) ||
    (token.value === "@" && isName(tokens[startIndex + 1]))
  ) {
    const nameEnd =
      token.value === "@" ? startIndex + 2 : startIndex + 1;
    if (tokens[nameEnd]?.value === "[") {
      const matching = findMatching(tokens, nameEnd);
      endIndex = matching === -1 ? nameEnd + 1 : matching + 1;
    } else {
      endIndex = nameEnd;
    }
  } else {
    return -1;
  }

  if (
    endIndex !== -1 &&
    tokens[endIndex]?.value === "=" &&
    isName(tokens[endIndex + 1])
  ) {
    endIndex += 2;
  }

  return endIndex;
}

function walkLegacyCode(tokens, start, end, scopeId, ctx) {
  if (start >= end) return;
  const first = tokens[start];
  if (!first) return;

  if (isName(first)) {
    ctx.occurrences.push({
      kind: "type",
      name: first.value,
      scopeId: "global",
      start: first.start,
      end: first.end,
      isDefinition: false
    });
    return;
  }

  if (first.value === "@" && start + 1 < end && isName(tokens[start + 1])) {
    ctx.occurrences.push({
      kind: "type",
      name: "@" + tokens[start + 1].value,
      scopeId: "global",
      start: first.start,
      end: tokens[start + 1].end,
      isDefinition: false
    });
    return;
  }

  if (first.value === "{" || first.value === "<") {
    const close = findMatching(tokens, start);
    const innerEnd = close !== -1 && close < end ? close : end;
    for (const seg of splitTopLevelCommas(tokens, start + 1, innerEnd)) {
      if (tokens[seg.start]?.value === "...") continue;
      if (
        seg.end - seg.start >= 2 &&
        isLabelToken(tokens[seg.start]) &&
        tokens[seg.start + 1]?.value === ":"
      ) {
        walkLegacyCode(tokens, seg.start + 2, seg.end, scopeId, ctx);
      } else if (
        seg.end - seg.start >= 2 &&
        isLabelToken(tokens[seg.end - 1])
      ) {
        walkLegacyCode(tokens, seg.start, seg.end - 1, scopeId, ctx);
      } else {
        walkLegacyCode(tokens, seg.start, seg.end, scopeId, ctx);
      }
    }
  }
}

function walkFilter(tokens, start, end, scopeId, ctx, aliasForName = null) {
  if (start >= end) return;

  let filterEnd = end;
  if (
    end - start >= 3 &&
    tokens[end - 2]?.value === "=" &&
    isName(tokens[end - 1])
  ) {
    const knotTok = tokens[end - 1];
    const knotDef = {
      kind: "variable",
      name: knotTok.value,
      scopeId,
      start: knotTok.start,
      end: knotTok.end,
      statementStart: tokens[start].start,
      statementEnd: knotTok.end,
      isDefinition: true
    };
    ctx.definitions.push(knotDef);
    ctx.occurrences.push(knotDef);
    filterEnd = end - 2;
  }

  if (start >= filterEnd) return;
  const first = tokens[start];
  if (!first) return;

  if (first.value === "$") {
    walkLegacyCode(tokens, start + 1, filterEnd, scopeId, ctx);
    return;
  }

  if (first.value === "(") {
    const close = findMatching(tokens, start);
    const innerEnd = close !== -1 && close < filterEnd ? close : filterEnd;
    if (!(innerEnd === start + 2 && tokens[start + 1]?.value === "...")) {
      walkFilter(tokens, start + 1, innerEnd, scopeId, ctx);
    }
    return;
  }

  if (first.value === "<" || first.value === "{") {
    const close = findMatching(tokens, start);
    const innerEnd = close !== -1 && close < filterEnd ? close : filterEnd;
    for (const seg of splitTopLevelCommas(tokens, start + 1, innerEnd)) {
      if (tokens[seg.start]?.value === "...") continue;
      if (
        seg.end - seg.start >= 2 &&
        isLabelToken(tokens[seg.start]) &&
        tokens[seg.start + 1]?.value === ":"
      ) {
        walkFilter(tokens, seg.start + 2, seg.end, scopeId, ctx);
      } else if (
        seg.end - seg.start >= 2 &&
        isLabelToken(tokens[seg.end - 1])
      ) {
        walkFilter(tokens, seg.start, seg.end - 1, scopeId, ctx);
      } else {
        walkFilter(tokens, seg.start, seg.end, scopeId, ctx);
      }
    }
    return;
  }

  let nameEnd = -1;
  let patName = null;
  if (first.value === "@" && start + 1 < filterEnd && isName(tokens[start + 1])) {
    nameEnd = start + 2;
    patName = "@" + tokens[start + 1].value;
  } else if (isName(first)) {
    nameEnd = start + 1;
    patName = first.value;
  }

  if (nameEnd !== -1 && tokens[nameEnd]?.value === "[") {
    const occ = {
      kind: "pattern",
      name: patName,
      scopeId: "global",
      start: first.start,
      end: tokens[nameEnd - 1].end,
      isDefinition: false
    };
    if (aliasForName && patName.startsWith("@")) {
      occ.aliasName = aliasForName;
    }
    ctx.occurrences.push(occ);

    const closeBracket = findMatching(tokens, nameEnd);
    const argsEnd =
      closeBracket !== -1 && closeBracket < filterEnd ? closeBracket : filterEnd;
    for (const arg of splitTopLevelCommas(tokens, nameEnd + 1, argsEnd)) {
      walkFilter(tokens, arg.start, arg.end, scopeId, ctx);
    }
    return;
  }

  if (nameEnd !== -1) {
    if (patName.startsWith("@")) {
      ctx.occurrences.push({
        kind: "pattern",
        name: patName,
        scopeId: "global",
        start: first.start,
        end: tokens[nameEnd - 1].end,
        isDefinition: false
      });
    } else {
      ctx.occurrences.push({
        kind: "variable",
        name: patName,
        scopeId,
        start: first.start,
        end: first.end,
        isDefinition: false
      });
    }
  }
}

function walkComp(tokens, start, end, scopeId, ctx, aliasForName = null) {
  let index = start;
  while (index < end) {
    const tok = tokens[index];
    if (!tok) break;

    if (tok.value === "?") {
      const filterEnd = parseFilterEnd(tokens, index + 1);
      if (filterEnd !== -1 && filterEnd <= end) {
        walkFilter(tokens, index + 1, filterEnd, scopeId, ctx);
        index = filterEnd;
      } else {
        index++;
      }
      continue;
    }

    if (tok.value === "$") {
      const codeEnd = parseCodeEnd(tokens, index + 1);
      if (codeEnd !== -1 && codeEnd <= end) {
        walkLegacyCode(tokens, index + 1, codeEnd, scopeId, ctx);
        index = codeEnd;
      } else {
        index++;
      }
      continue;
    }

    if (
      tok.value === "." ||
      tok.value === "/" ||
      tok.value === "|" ||
      tok.value === "\\"
    ) {
      index += index + 1 < end && isLabelToken(tokens[index + 1]) ? 2 : 1;
      continue;
    }

    if (tok.value === "(") {
      const closeParen = findMatching(tokens, index);
      if (closeParen !== -1 && closeParen < end) {
        if (closeParen > index + 1) {
          walkComp(tokens, index + 1, closeParen, scopeId, ctx);
        }
        index = closeParen + 1;
      } else {
        index++;
      }
      continue;
    }

    if (tok.value === "<") {
      const closeAngle = findMatching(tokens, index);
      if (closeAngle !== -1 && closeAngle < end) {
        for (const branch of splitTopLevelCommas(tokens, index + 1, closeAngle)) {
          walkComp(tokens, branch.start, branch.end, scopeId, ctx);
        }
        index = closeAngle + 1;
      } else {
        index++;
      }
      continue;
    }

    if (tok.value === "{") {
      const closeBrace = findMatching(tokens, index);
      if (closeBrace !== -1 && closeBrace < end) {
        for (const item of splitTopLevelCommas(tokens, index + 1, closeBrace)) {
          if (
            item.end - item.start >= 2 &&
            isLabelToken(tokens[item.start]) &&
            tokens[item.start + 1]?.value === ":"
          ) {
            walkComp(tokens, item.start + 2, item.end, scopeId, ctx);
          } else if (
            item.end - item.start >= 2 &&
            isLabelToken(tokens[item.end - 1])
          ) {
            walkComp(tokens, item.start, item.end - 1, scopeId, ctx);
          } else {
            walkComp(tokens, item.start, item.end, scopeId, ctx);
          }
        }
        index = closeBrace + 1;
      } else {
        index++;
      }
      continue;
    }

    if (tok.value === "@" && index + 1 < end && isName(tokens[index + 1])) {
      const occ = {
        kind: "relation",
        name: "@" + tokens[index + 1].value,
        scopeId: "global",
        start: tok.start,
        end: tokens[index + 1].end,
        isDefinition: false
      };
      if (aliasForName) occ.aliasName = aliasForName;
      ctx.occurrences.push(occ);
      index += 2;
      continue;
    }

    if (isName(tok)) {
      ctx.occurrences.push({
        kind: "relation",
        name: tok.value,
        scopeId: "global",
        start: tok.start,
        end: tok.end,
        isDefinition: false
      });
      index++;
      continue;
    }

    index++;
  }
}

function finalizeScopeVariables(scopeId, ctx) {
  const scopeDefs = new Set(
    ctx.definitions
      .filter((d) => d.kind === "variable" && d.scopeId === scopeId)
      .map((d) => d.name)
  );
  const typeDefs = new Set(
    ctx.definitions
      .filter((d) => d.kind === "type")
      .map((d) => d.name)
  );

  for (const occ of ctx.occurrences) {
    if (occ.kind !== "variable" || occ.scopeId !== scopeId) continue;
    if (scopeDefs.has(occ.name)) continue;

    if (typeDefs.has(occ.name)) {
      occ.kind = "type";
      occ.scopeId = "global";
      continue;
    }

    occ.isDefinition = true;
    const implicitDef = {
      ...occ,
      statementStart: occ.start,
      statementEnd: occ.end
    };
    ctx.definitions.push(implicitDef);
    scopeDefs.add(occ.name);
  }
}

function analyzeDocument(text) {
  const tokens = lex(text);
  const ctx = {
    definitions: [],
    occurrences: []
  };

  let index = tokens[0]?.value === "~" ? 1 : 0;
  let defCounter = 0;

  while (index < tokens.length) {
    let nameEnd = -1;
    let symName = null;
    if (tokens[index]?.value === "@" && isName(tokens[index + 1])) {
      nameEnd = index + 2;
      symName = "@" + tokens[index + 1].value;
    } else if (isName(tokens[index])) {
      nameEnd = index + 1;
      symName = tokens[index].value;
    }

    let isPatternDefinition = false;
    let closeBracket = -1;
    let patternEqualsIndex = -1;
    if (nameEnd !== -1 && tokens[nameEnd]?.value === "[") {
      closeBracket = findMatching(tokens, nameEnd);
      if (
        closeBracket !== -1 &&
        tokens[closeBracket + 1]?.value === "="
      ) {
        isPatternDefinition = true;
        patternEqualsIndex = closeBracket + 1;
      }
    }

    const isTypeDefinition =
      tokens[index]?.value === "$" &&
      isName(tokens[index + 1]) &&
      tokens[index + 2]?.value === "=";
    const isRelationDefinition =
      !isPatternDefinition &&
      nameEnd !== -1 &&
      tokens[nameEnd]?.value === "=";

    if (
      !isTypeDefinition &&
      !isRelationDefinition &&
      !isPatternDefinition
    ) {
      break;
    }

    const equalsIndex = isPatternDefinition
      ? patternEqualsIndex
      : isTypeDefinition
        ? index + 2
        : nameEnd;
    const endIndex = findDefinitionEnd(tokens, equalsIndex + 1);
    if (endIndex === -1) break;

    const scopeId = `def:${defCounter++}`;
    const bodyStart = equalsIndex + 1;

    if (isPatternDefinition) {
      let canonicalTarget = null;
      if (
        tokens[bodyStart]?.value === "@" &&
        isName(tokens[bodyStart + 1]) &&
        tokens[bodyStart + 2]?.value === "[" &&
        findMatching(tokens, bodyStart + 2) === endIndex - 1
      ) {
        canonicalTarget = "@" + tokens[bodyStart + 1].value;
      }

      const def = {
        kind: "pattern",
        name: symName,
        scopeId: "global",
        start: tokens[index].start,
        end: tokens[nameEnd - 1].end,
        statementStart: tokens[index].start,
        statementEnd: tokens[endIndex].end,
        isDefinition: true,
        ...(canonicalTarget ? { canonicalTarget } : {})
      };
      ctx.definitions.push(def);
      ctx.occurrences.push(def);

      for (let pIndex = nameEnd + 1; pIndex < closeBracket; pIndex++) {
        const pTok = tokens[pIndex];
        if (isName(pTok)) {
          const paramDef = {
            kind: "variable",
            name: pTok.value,
            scopeId,
            start: pTok.start,
            end: pTok.end,
            statementStart: pTok.start,
            statementEnd: pTok.end,
            isDefinition: true
          };
          ctx.definitions.push(paramDef);
          ctx.occurrences.push(paramDef);
        }
      }

      walkFilter(
        tokens,
        bodyStart,
        endIndex,
        scopeId,
        ctx,
        canonicalTarget ? symName : null
      );
      finalizeScopeVariables(scopeId, ctx);
    } else if (isTypeDefinition) {
      const nameTok = tokens[index + 1];
      const def = {
        kind: "type",
        name: nameTok.value,
        scopeId: "global",
        start: nameTok.start,
        end: nameTok.end,
        statementStart: tokens[index].start,
        statementEnd: tokens[endIndex].end,
        isDefinition: true
      };
      ctx.definitions.push(def);
      ctx.occurrences.push(def);

      walkLegacyCode(tokens, bodyStart, endIndex, scopeId, ctx);
    } else if (isRelationDefinition) {
      let canonicalTarget = null;
      if (
        endIndex === bodyStart + 2 &&
        tokens[bodyStart]?.value === "@" &&
        isName(tokens[bodyStart + 1])
      ) {
        canonicalTarget = "@" + tokens[bodyStart + 1].value;
      }

      const def = {
        kind: "relation",
        name: symName,
        scopeId: "global",
        start: tokens[index].start,
        end: tokens[nameEnd - 1].end,
        statementStart: tokens[index].start,
        statementEnd: tokens[endIndex].end,
        isDefinition: true,
        ...(canonicalTarget ? { canonicalTarget } : {})
      };
      ctx.definitions.push(def);
      ctx.occurrences.push(def);

      walkComp(
        tokens,
        bodyStart,
        endIndex,
        scopeId,
        ctx,
        canonicalTarget ? symName : null
      );
      finalizeScopeVariables(scopeId, ctx);
    }

    index = endIndex + 1;
  }

  if (index < tokens.length) {
    const mainScope = "main";
    walkComp(tokens, index, tokens.length, mainScope, ctx);
    finalizeScopeVariables(mainScope, ctx);
  }

  ctx.occurrences.sort((a, b) => a.start - b.start || a.end - b.end);
  return ctx;
}

function findOccurrenceAtOffset(analysis, offset) {
  for (const occ of analysis.occurrences) {
    if (occ.start <= offset && offset < occ.end) {
      return occ;
    }
  }
  for (const occ of analysis.occurrences) {
    if (occ.start <= offset && offset <= occ.end) {
      return occ;
    }
  }
  return null;
}

function findDefinitionsForOccurrence(analysis, occ) {
  if (!occ) return [];
  return analysis.definitions.filter(
    (def) =>
      def.kind === occ.kind &&
      def.name === occ.name &&
      def.scopeId === occ.scopeId
  );
}

function findDefinitionsForOffset(text, offset) {
  const analysis = analyzeDocument(text);
  const occ = findOccurrenceAtOffset(analysis, offset);
  return findDefinitionsForOccurrence(analysis, occ);
}

function findReferencesForOccurrence(
  analysis,
  occ,
  { includeDeclaration = true } = {}
) {
  if (!occ) return [];
  return analysis.occurrences.filter(
    (item) =>
      item.kind === occ.kind &&
      item.name === occ.name &&
      item.scopeId === occ.scopeId &&
      (includeDeclaration || !item.isDefinition)
  );
}

function findReferencesForOffset(
  text,
  offset,
  { includeDeclaration = true } = {}
) {
  const analysis = analyzeDocument(text);
  const occ = findOccurrenceAtOffset(analysis, offset);
  return findReferencesForOccurrence(analysis, occ, { includeDeclaration });
}

function findWorkspaceDefinitions(documents, activeUri, offset) {
  const activeText = documents.get(activeUri);
  if (typeof activeText !== "string") return [];

  const activeAnalysis = analyzeDocument(activeText);
  const occ = findOccurrenceAtOffset(activeAnalysis, offset);
  if (!occ) return [];

  const sameFileDefs = findDefinitionsForOccurrence(activeAnalysis, occ);

  let targetHash = null;
  if (occ.name.startsWith("@")) {
    targetHash = occ.name;
  } else if (occ.isDefinition) {
    const matchingDef = sameFileDefs.find((d) => d.canonicalTarget);
    if (matchingDef) targetHash = matchingDef.canonicalTarget;
  }

  if (!targetHash) {
    return sameFileDefs.map((def) => ({ uri: activeUri, ...def }));
  }

  const parsedDocs = new Map([[activeUri, activeAnalysis]]);
  for (const [uri, text] of documents.entries()) {
    if (!parsedDocs.has(uri)) {
      parsedDocs.set(uri, analyzeDocument(text));
    }
  }

  const candidateNames = new Set();
  if (occ.aliasName) candidateNames.add(occ.aliasName);
  for (const analysis of parsedDocs.values()) {
    for (const def of analysis.definitions) {
      if (def.kind === occ.kind && def.canonicalTarget === targetHash) {
        candidateNames.add(def.name);
      }
    }
  }

  const externalDefs = [];
  for (const [uri, analysis] of parsedDocs.entries()) {
    if (uri === activeUri) continue;
    for (const def of analysis.definitions) {
      if (def.kind !== occ.kind) continue;
      if (def.name === targetHash) {
        externalDefs.push({ uri, ...def });
      } else if (!def.canonicalTarget && candidateNames.has(def.name)) {
        externalDefs.push({ uri, ...def });
      }
    }
  }

  if (externalDefs.length > 0) return externalDefs;
  return sameFileDefs.map((def) => ({ uri: activeUri, ...def }));
}

function findWorkspaceReferences(
  documents,
  activeUri,
  offset,
  { includeDeclaration = true } = {}
) {
  const activeText = documents.get(activeUri);
  if (typeof activeText !== "string") return [];

  const activeAnalysis = analyzeDocument(activeText);
  const occ = findOccurrenceAtOffset(activeAnalysis, offset);
  if (!occ) return [];

  const localRefs = findReferencesForOccurrence(activeAnalysis, occ, {
    includeDeclaration
  }).map((ref) => ({ uri: activeUri, ...ref }));

  if (occ.scopeId !== "global") {
    return localRefs;
  }

  const parsedDocs = new Map([[activeUri, activeAnalysis]]);
  for (const [uri, text] of documents.entries()) {
    if (!parsedDocs.has(uri)) {
      parsedDocs.set(uri, analyzeDocument(text));
    }
  }

  const targetHashes = new Set();
  if (occ.name.startsWith("@")) {
    targetHashes.add(occ.name);
  } else {
    const activeDefs = findDefinitionsForOccurrence(activeAnalysis, occ);
    for (const def of activeDefs) {
      if (def.canonicalTarget) {
        targetHashes.add(def.canonicalTarget);
      }
    }
    if (targetHashes.size === 0 && activeDefs.some((d) => !d.canonicalTarget)) {
      for (const [uri, analysis] of parsedDocs.entries()) {
        if (uri === activeUri) continue;
        for (const def of analysis.definitions) {
          if (
            def.kind === occ.kind &&
            def.name === occ.name &&
            def.canonicalTarget
          ) {
            targetHashes.add(def.canonicalTarget);
          }
        }
      }
    }
  }

  if (targetHashes.size === 0) {
    return localRefs;
  }

  const candidateConcreteNames = new Set();
  for (const analysis of parsedDocs.values()) {
    for (const def of analysis.definitions) {
      if (def.kind === occ.kind && targetHashes.has(def.canonicalTarget)) {
        candidateConcreteNames.add(def.name);
      }
    }
  }

  const results = [];
  const seen = new Set();
  const pushUnique = (uri, item) => {
    if (!includeDeclaration && item.isDefinition) return;
    const key = `${uri}:${item.start}:${item.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ uri, ...item });
  };

  for (const ref of localRefs) {
    pushUnique(ref.uri, ref);
  }

  for (const [uri, analysis] of parsedDocs.entries()) {
    const aliasedNamesInDoc = new Set();
    for (const def of analysis.definitions) {
      if (def.kind !== occ.kind) continue;
      if (targetHashes.has(def.canonicalTarget)) {
        aliasedNamesInDoc.add(def.name);
      } else if (
        !def.canonicalTarget &&
        candidateConcreteNames.has(def.name)
      ) {
        aliasedNamesInDoc.add(def.name);
      }
    }

    for (const item of analysis.occurrences) {
      if (item.kind !== occ.kind || item.scopeId !== "global") continue;
      if (
        targetHashes.has(item.name) ||
        aliasedNamesInDoc.has(item.name)
      ) {
        pushUnique(uri, item);
      }
    }
  }

  return results;
}

function collectBackgroundRanges(text) {
  const tokens = lex(text);
  const type = [];
  const filter = [];

  let index = tokens[0]?.value === "~" ? 1 : 0;
  while (index < tokens.length) {
    let nameEnd = -1;
    if (tokens[index]?.value === "@" && isName(tokens[index + 1])) {
      nameEnd = index + 2;
    } else if (isName(tokens[index])) {
      nameEnd = index + 1;
    }

    let isPatternDefinition = false;
    let patternEqualsIndex = -1;
    if (nameEnd !== -1 && tokens[nameEnd]?.value === "[") {
      const closeBracket = findMatching(tokens, nameEnd);
      if (
        closeBracket !== -1 &&
        tokens[closeBracket + 1]?.value === "="
      ) {
        isPatternDefinition = true;
        patternEqualsIndex = closeBracket + 1;
      }
    }

    const isTypeDefinition =
      tokens[index]?.value === "$" &&
      isName(tokens[index + 1]) &&
      tokens[index + 2]?.value === "=";
    const isRelationDefinition =
      !isPatternDefinition &&
      isName(tokens[index]) &&
      tokens[index + 1]?.value === "=";

    if (
      !isTypeDefinition &&
      !isRelationDefinition &&
      !isPatternDefinition
    ) {
      break;
    }

    const equalsIndex = isPatternDefinition
      ? patternEqualsIndex
      : index + (isTypeDefinition ? 2 : 1);
    const endIndex = findDefinitionEnd(tokens, equalsIndex + 1);
    if (endIndex === -1) break;

    if (isTypeDefinition || isPatternDefinition) {
      type.push({
        start: tokens[index].start,
        end: tokens[endIndex].end
      });
    }
    index = endIndex + 1;
  }

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    if (tokens[tokenIndex].value === "?") {
      const endIndex = parseFilterEnd(tokens, tokenIndex + 1);
      if (endIndex !== -1) {
        filter.push({
          start: tokens[tokenIndex].start,
          end: tokens[endIndex - 1].end
        });
      }
      continue;
    }

    if (tokens[tokenIndex].value !== "$") continue;

    const isDefinition =
      isName(tokens[tokenIndex + 1]) &&
      tokens[tokenIndex + 2]?.value === "=";
    if (isDefinition) continue;

    const endIndex = parseCodeEnd(tokens, tokenIndex + 1);
    if (endIndex !== -1) {
      type.push({
        start: tokens[tokenIndex].start,
        end: tokens[endIndex - 1].end
      });
    }
  }

  return { type, filter };
}

function toVscodeRanges(document, ranges) {
  return ranges.map(({ start, end }) => new vscode.Range(
    document.positionAt(start),
    document.positionAt(end)
  ));
}

async function loadWorkspaceKDocuments(activeDocument) {
  const documents = new Map();
  const activeKey = activeDocument.uri.toString();
  documents.set(activeKey, activeDocument.getText());
  const docByUri = new Map([[activeKey, activeDocument]]);

  for (const openDoc of vscode.workspace.textDocuments || []) {
    if (openDoc.languageId === "k" || openDoc.uri.fsPath?.endsWith(".k")) {
      const key = openDoc.uri.toString();
      documents.set(key, openDoc.getText());
      docByUri.set(key, openDoc);
    }
  }

  if (typeof vscode.workspace.findFiles === "function") {
    const uris = await vscode.workspace.findFiles(
      "**/*.k",
      "**/node_modules/**"
    );
    for (const uri of uris) {
      const key = uri.toString();
      if (documents.has(key)) continue;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        documents.set(key, doc.getText());
        docByUri.set(key, doc);
      } catch (_) {
        // Ignore unreadable files
      }
    }
  }

  return { documents, docByUri, activeKey };
}

function toLocation(doc, item) {
  const range = new vscode.Range(
    doc.positionAt(item.start),
    doc.positionAt(item.end)
  );
  return new vscode.Location(doc.uri, range);
}

function activate(context) {
  const filterDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(58, 45, 32, 0.82)"
  });
  const typeDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(38, 53, 39, 0.92)"
  });

  context.subscriptions.push(filterDecoration, typeDecoration);

  function updateEditor(editor) {
    if (editor.document.languageId !== "k") return;

    const ranges = collectBackgroundRanges(editor.document.getText());
    editor.setDecorations(
      filterDecoration,
      toVscodeRanges(editor.document, ranges.filter)
    );
    editor.setDecorations(
      typeDecoration,
      toVscodeRanges(editor.document, ranges.type)
    );
  }

  function updateVisibleEditors() {
    for (const editor of vscode.window.visibleTextEditors) updateEditor(editor);
  }

  const selector = { language: "k" };

  if (vscode.languages) {
    if (typeof vscode.languages.registerDefinitionProvider === "function") {
      context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(selector, {
          async provideDefinition(document, position) {
            const offset = document.offsetAt(position);
            const text = document.getText();
            const analysis = analyzeDocument(text);
            const occ = findOccurrenceAtOffset(analysis, offset);
            if (!occ) return null;

            const sameFileDefs = findDefinitionsForOccurrence(analysis, occ);
            const needsCrossFile =
              occ.name.startsWith("@") ||
              sameFileDefs.length === 0 ||
              (occ.isDefinition && sameFileDefs.some((d) => d.canonicalTarget));

            if (!needsCrossFile) {
              return sameFileDefs.map((def) => toLocation(document, def));
            }

            const { documents, docByUri, activeKey } =
              await loadWorkspaceKDocuments(document);
            const defs = findWorkspaceDefinitions(documents, activeKey, offset);
            return defs
              .map((def) => {
                const doc = docByUri.get(def.uri);
                return doc ? toLocation(doc, def) : null;
              })
              .filter(Boolean);
          }
        })
      );
    }

    if (typeof vscode.languages.registerReferenceProvider === "function") {
      context.subscriptions.push(
        vscode.languages.registerReferenceProvider(selector, {
          async provideReferences(document, position, referenceContext) {
            const offset = document.offsetAt(position);
            const includeDeclaration = Boolean(
              referenceContext?.includeDeclaration
            );
            const text = document.getText();
            const analysis = analyzeDocument(text);
            const occ = findOccurrenceAtOffset(analysis, offset);
            if (!occ) return [];

            if (occ.scopeId !== "global") {
              const refs = findReferencesForOccurrence(analysis, occ, {
                includeDeclaration
              });
              return refs.map((ref) => toLocation(document, ref));
            }

            const { documents, docByUri, activeKey } =
              await loadWorkspaceKDocuments(document);
            const refs = findWorkspaceReferences(documents, activeKey, offset, {
              includeDeclaration
            });
            return refs
              .map((ref) => {
                const doc = docByUri.get(ref.uri);
                return doc ? toLocation(doc, ref) : null;
              })
              .filter(Boolean);
          }
        })
      );
    }

    if (
      typeof vscode.languages.registerDocumentHighlightProvider === "function"
    ) {
      context.subscriptions.push(
        vscode.languages.registerDocumentHighlightProvider(selector, {
          provideDocumentHighlights(document, position) {
            const offset = document.offsetAt(position);
            const refs = findReferencesForOffset(document.getText(), offset, {
              includeDeclaration: true
            });
            const writeKind = vscode.DocumentHighlightKind?.Write ?? 2;
            const readKind = vscode.DocumentHighlightKind?.Read ?? 1;
            return refs.map(
              (ref) =>
                new vscode.DocumentHighlight(
                  new vscode.Range(
                    document.positionAt(ref.start),
                    document.positionAt(ref.end)
                  ),
                  ref.isDefinition ? writeKind : readKind
                )
            );
          }
        })
      );
    }

    if (
      typeof vscode.languages.registerDocumentSymbolProvider === "function"
    ) {
      context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(selector, {
          provideDocumentSymbols(document) {
            const analysis = analyzeDocument(document.getText());
            const symbols = [];
            for (const def of analysis.definitions) {
              if (def.scopeId !== "global") continue;
              const kind =
                def.kind === "pattern"
                  ? (vscode.SymbolKind?.Interface ?? 10)
                  : def.kind === "type"
                    ? (vscode.SymbolKind?.TypeParameter ?? 25)
                    : (vscode.SymbolKind?.Function ?? 11);
              const label =
                def.kind === "pattern" ? `${def.name}[]` : def.name;
              const range = new vscode.Range(
                document.positionAt(def.statementStart ?? def.start),
                document.positionAt(def.statementEnd ?? def.end)
              );
              const selectionRange = new vscode.Range(
                document.positionAt(def.start),
                document.positionAt(def.end)
              );
              symbols.push(
                new vscode.DocumentSymbol(
                  label,
                  def.canonicalTarget || "",
                  kind,
                  range,
                  selectionRange
                )
              );
            }
            return symbols;
          }
        })
      );
    }
  }

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(updateVisibleEditors),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) updateEditor(editor);
      }
    })
  );

  updateVisibleEditors();
}

function deactivate() {}

module.exports = {
  activate,
  analyzeDocument,
  collectBackgroundRanges,
  deactivate,
  findDefinitionsForOffset,
  findOccurrenceAtOffset,
  findReferencesForOffset,
  findWorkspaceDefinitions,
  findWorkspaceReferences
};
