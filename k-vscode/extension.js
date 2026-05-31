const vscode = require("vscode");

const NAME_START = /[a-zA-Z0-9_+\-]/;
const NAME_PART = /[a-zA-Z0-9_?!+\-]/;
const OPEN_TO_CLOSE = new Map([
  ["{", "}"],
  ["<", ">"],
  ["(", ")"]
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
  } else if (token.value === "(" || token.value === "{" || token.value === "<") {
    const matching = findMatching(tokens, startIndex);
    endIndex = matching === -1 ? -1 : matching + 1;
  } else if (isName(token)) {
    endIndex = startIndex + 1;
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

function collectBackgroundRanges(text) {
  const tokens = lex(text);
  const type = [];
  const filter = [];

  let index = tokens[0]?.value === "~" ? 1 : 0;
  while (index < tokens.length) {
    const isTypeDefinition =
      tokens[index]?.value === "$" &&
      isName(tokens[index + 1]) &&
      tokens[index + 2]?.value === "=";
    const isRelationDefinition =
      isName(tokens[index]) &&
      tokens[index + 1]?.value === "=";

    if (!isTypeDefinition && !isRelationDefinition) break;

    const equalsIndex = index + (isTypeDefinition ? 2 : 1);
    const endIndex = findDefinitionEnd(tokens, equalsIndex + 1);
    if (endIndex === -1) break;

    if (isTypeDefinition) {
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
  collectBackgroundRanges,
  deactivate
};
