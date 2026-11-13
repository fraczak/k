const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  analyzeDocument,
  findDefinitionsForOffset,
  findReferencesForOffset,
  findWorkspaceDefinitions,
  findWorkspaceReferences
} = require("../extension");

function nthOffset(text, needle, n = 0) {
  let index = -1;
  for (let i = 0; i <= n; i++) {
    index = text.indexOf(needle, index + 1);
    assert.notStrictEqual(
      index,
      -1,
      `Could not find occurrence ${n} of "${needle}"`
    );
  }
  return index;
}

// 1. Relation vs labels/tags and Pattern vs Relation disambiguation
{
  const src = [
    "yes_no[] = <{} yes, {} no>;",
    "yes = {}|yes ? yes_no[];",
    "no  = {}|no ? yes_no[];",
    "swap_yes_no = ? yes_no[] < /yes no, yes >;",
    "int[] = < yes_no[] \"+\", yes_no[] \"-\" >;",
    "int = ?int[] { .yes int, yes: swap_yes_no };"
  ].join("\n");

  // Relation 'yes': defined on line 2, used once on line 4 (after '/yes no, ').
  // Must NOT match variant label 'yes' on line 1, '|yes' on line 2, '/yes' on line 4,
  // '.yes' on line 6, or field label 'yes:' on line 6.
  const yesUsageOffset = nthOffset(src, ", yes >") + 2;
  const yesDefs = findDefinitionsForOffset(src, yesUsageOffset);
  assert.strictEqual(yesDefs.length, 1);
  assert.strictEqual(yesDefs[0].kind, "relation");
  assert.strictEqual(yesDefs[0].name, "yes");
  assert.strictEqual(yesDefs[0].start, nthOffset(src, "yes ="));

  const yesRefsAll = findReferencesForOffset(src, yesUsageOffset, {
    includeDeclaration: true
  });
  assert.deepStrictEqual(
    yesRefsAll.map((r) => ({ start: r.start, isDef: r.isDefinition })),
    [
      { start: nthOffset(src, "yes ="), isDef: true },
      { start: yesUsageOffset, isDef: false }
    ]
  );

  const yesRefsUsagesOnly = findReferencesForOffset(src, yesDefs[0].start, {
    includeDeclaration: false
  });
  assert.strictEqual(yesRefsUsagesOnly.length, 1);
  assert.strictEqual(yesRefsUsagesOnly[0].start, yesUsageOffset);

  // Clicking on '/yes' or '|yes' or '<{} yes' must not resolve to a symbol
  assert.deepStrictEqual(
    findDefinitionsForOffset(src, nthOffset(src, "/yes") + 1),
    []
  );
  assert.deepStrictEqual(
    findDefinitionsForOffset(src, nthOffset(src, "|yes") + 1),
    []
  );
  assert.deepStrictEqual(
    findDefinitionsForOffset(src, nthOffset(src, "{} yes") + 3),
    []
  );

  // Disambiguating pattern `int[]` (line 5) vs relation `int` (line 6)
  const patIntUsage = nthOffset(src, "?int[]") + 1;
  const patIntDefs = findDefinitionsForOffset(src, patIntUsage);
  assert.strictEqual(patIntDefs.length, 1);
  assert.strictEqual(patIntDefs[0].kind, "pattern");
  assert.strictEqual(patIntDefs[0].start, nthOffset(src, "int[] ="));

  const relIntDefOffset = nthOffset(src, "int = ?int[]");
  const relIntRefs = findReferencesForOffset(src, relIntDefOffset, {
    includeDeclaration: true
  });
  // Notice `{ .yes int, ... }` has `int` as the product field label, NOT a relation call!
  assert.strictEqual(relIntRefs.length, 1);
  assert.strictEqual(relIntRefs[0].start, relIntDefOffset);
}

// 2. Pattern parameters and filter/knot variables (strictly definition-scoped)
{
  const src = [
    "bits[] = < {} _, B 0, B 1 > = B;",
    "list[X] = < {} nil, { X car, Y cdr } cons > = Y;",
    "add = ?{ bits[] x, bits[] y } = X < { .x x, .y y } ?X add, .y >;"
  ].join("\n");

  // Knot variable B in bits[]: usage in `B 0` jumps to `= B`
  const bUsage1 = nthOffset(src, "B 0");
  const bDefOffset = nthOffset(src, "= B;") + 2;
  const bDefs = findDefinitionsForOffset(src, bUsage1);
  assert.strictEqual(bDefs.length, 1);
  assert.strictEqual(bDefs[0].kind, "variable");
  assert.strictEqual(bDefs[0].start, bDefOffset);

  const bRefs = findReferencesForOffset(src, bUsage1, {
    includeDeclaration: true
  });
  assert.strictEqual(bRefs.length, 3); // B in `B 0`, B in `B 1`, B in `= B`

  // Pattern parameter X in list[X] must NOT collide with knot variable X in `add`
  const paramXDef = nthOffset(src, "[X]") + 1;
  const paramXUsage = nthOffset(src, "X car");
  const xDefsFromList = findDefinitionsForOffset(src, paramXUsage);
  assert.strictEqual(xDefsFromList.length, 1);
  assert.strictEqual(xDefsFromList[0].start, paramXDef);

  const xRefsInList = findReferencesForOffset(src, paramXUsage, {
    includeDeclaration: true
  });
  assert.deepStrictEqual(
    xRefsInList.map((r) => r.start),
    [paramXDef, paramXUsage]
  );

  // Knot variable X in `add`: `?X` jumps to `= X` in `add`
  const knotXDef = nthOffset(src, "= X <") + 2;
  const knotXUsage = nthOffset(src, "?X add") + 1;
  const xDefsFromAdd = findDefinitionsForOffset(src, knotXUsage);
  assert.strictEqual(xDefsFromAdd.length, 1);
  assert.strictEqual(xDefsFromAdd[0].start, knotXDef);

  const xRefsInAdd = findReferencesForOffset(src, knotXUsage, {
    includeDeclaration: true
  });
  assert.deepStrictEqual(
    xRefsInAdd.map((r) => r.start),
    [knotXDef, knotXUsage]
  );
}

// 3. Cross-file canonical @hash and alias resolution
{
  const ieeeText = [
    "exp11[] = { bit[] b0 };",
    "float64[] = { exp11[] exponent };",
    "ws = ?list[unicode[]] < /nil |nil >;",
    "local_helper = ws;"
  ].join("\n");

  const djsonText = [
    "exponent[] = @F2KGfE24DhFGChv6pVAb4pkC9YWvt5izpnnwFDTLfG2h[];",
    "number[] = @AR4sFGMwXgjj5p7dhi8sJKDWNbrXxLefQUCBRNm5fP6t[];",
    "ws = @abqd6Yt8cFacQDRL7yFrAyEnnv4uChaedDzUDXNrXVNF;",
    "local_helper = ws ?number[];"
  ].join("\n");

  const ieeeArithText = [
    "exp11[] = @F2KGfE24DhFGChv6pVAb4pkC9YWvt5izpnnwFDTLfG2h[];",
    "float64[] = @AR4sFGMwXgjj5p7dhi8sJKDWNbrXxLefQUCBRNm5fP6t[];"
  ].join("\n");

  const docs = new Map([
    ["file:///ieee.k", ieeeText],
    ["file:///djson.k", djsonText],
    ["file:///ieee-arithmetics.k", ieeeArithText]
  ]);

  // 3a. Clicking on `ws` usage in djson.k jumps to local alias `ws = @abqd...` in djson.k
  const djsonWsUsage = nthOffset(djsonText, "= ws ?number") + 2;
  const defsFromUsage = findWorkspaceDefinitions(
    docs,
    "file:///djson.k",
    djsonWsUsage
  );
  assert.strictEqual(defsFromUsage.length, 1);
  assert.strictEqual(defsFromUsage[0].uri, "file:///djson.k");
  assert.strictEqual(defsFromUsage[0].start, nthOffset(djsonText, "ws = @"));

  // 3b. Clicking on `@abqd...` or on the LHS `ws` of the alias in djson.k jumps to `ws` in ieee.k!
  const djsonWsHashOffset = nthOffset(djsonText, "@abqd6Yt8cFac") + 3;
  const defsFromHash = findWorkspaceDefinitions(
    docs,
    "file:///djson.k",
    djsonWsHashOffset
  );
  assert.strictEqual(defsFromHash.length, 1);
  assert.strictEqual(defsFromHash[0].uri, "file:///ieee.k");
  assert.strictEqual(defsFromHash[0].start, nthOffset(ieeeText, "ws = ?list"));

  const defsFromAliasLhs = findWorkspaceDefinitions(
    docs,
    "file:///djson.k",
    nthOffset(djsonText, "ws = @")
  );
  assert.strictEqual(defsFromAliasLhs.length, 1);
  assert.strictEqual(defsFromAliasLhs[0].uri, "file:///ieee.k");
  assert.strictEqual(
    defsFromAliasLhs[0].start,
    nthOffset(ieeeText, "ws = ?list")
  );

  // 3c. Renamed pattern alias `number[] = @AR4s...[]` in djson.k resolves to `float64[]` in ieee.k
  // via transitive alias name matching with ieee-arithmetics.k!
  const numberAliasOffset = nthOffset(djsonText, "number[] =");
  const numberTargetDefs = findWorkspaceDefinitions(
    docs,
    "file:///djson.k",
    numberAliasOffset
  );
  assert.strictEqual(numberTargetDefs.length, 1);
  assert.strictEqual(numberTargetDefs[0].uri, "file:///ieee.k");
  assert.strictEqual(
    numberTargetDefs[0].start,
    nthOffset(ieeeText, "float64[] =")
  );

  // 3d. Cross-file Find All References on `ws` finds occurrences in both ieee.k and djson.k
  const wsWorkspaceRefs = findWorkspaceReferences(
    docs,
    "file:///ieee.k",
    nthOffset(ieeeText, "ws = ?list"),
    { includeDeclaration: true }
  );
  const uris = new Set(wsWorkspaceRefs.map((r) => r.uri));
  assert.ok(uris.has("file:///ieee.k"));
  assert.ok(uris.has("file:///djson.k"));
  assert.strictEqual(wsWorkspaceRefs.length, 5); // 2 in ieee.k + 3 in djson.k (def, @hash, usage)

  // 3e. Non-aliased `local_helper` in djson.k does NOT leak into `local_helper` in ieee.k
  const localHelperRefs = findWorkspaceReferences(
    docs,
    "file:///djson.k",
    nthOffset(djsonText, "local_helper ="),
    { includeDeclaration: true }
  );
  assert.strictEqual(localHelperRefs.length, 1);
  assert.strictEqual(localHelperRefs[0].uri, "file:///djson.k");
}

// 4. Smoke-test analyzer on real lib/*.k files
{
  const ieeePath = path.join(__dirname, "../../lib/ieee.k");
  const djsonPath = path.join(__dirname, "../../lib/djson.k");
  if (fs.existsSync(ieeePath) && fs.existsSync(djsonPath)) {
    const ieeeSrc = fs.readFileSync(ieeePath, "utf8");
    const djsonSrc = fs.readFileSync(djsonPath, "utf8");
    const ieeeAnalysis = analyzeDocument(ieeeSrc);
    const djsonAnalysis = analyzeDocument(djsonSrc);

    assert.ok(
      ieeeAnalysis.definitions.some(
        (d) => d.kind === "pattern" && d.name === "float64"
      )
    );
    assert.ok(
      ieeeAnalysis.definitions.some(
        (d) => d.kind === "relation" && d.name === "ratio_to_float64"
      )
    );
    assert.ok(
      djsonAnalysis.definitions.some(
        (d) => d.kind === "pattern" && d.name === "djson"
      )
    );
    assert.ok(
      djsonAnalysis.definitions.some(
        (d) => d.kind === "relation" && d.name === "parse_json"
      )
    );
  }
}

// 5. Test VS Code provider registration via activate(context)
(async () => {
  const registered = {};
  const mockVscode = {
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    },
    DocumentHighlight: class DocumentHighlight {
      constructor(range, kind) {
        this.range = range;
        this.kind = kind;
      }
    },
    DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
    DocumentSymbol: class DocumentSymbol {
      constructor(name, detail, kind, range, selectionRange) {
        this.name = name;
        this.detail = detail;
        this.kind = kind;
        this.range = range;
        this.selectionRange = selectionRange;
      }
    },
    SymbolKind: { Interface: 10, Function: 11, TypeParameter: 25 },
    window: {
      visibleTextEditors: [],
      createTextEditorDecorationType: () => ({ dispose() {} }),
      onDidChangeVisibleTextEditors: () => ({ dispose() {} })
    },
    workspace: {
      textDocuments: [],
      onDidChangeTextDocument: () => ({ dispose() {} }),
      findFiles: async () => []
    },
    languages: {
      registerDefinitionProvider(_sel, provider) {
        registered.definition = provider;
        return { dispose() {} };
      },
      registerReferenceProvider(_sel, provider) {
        registered.reference = provider;
        return { dispose() {} };
      },
      registerDocumentHighlightProvider(_sel, provider) {
        registered.highlight = provider;
        return { dispose() {} };
      },
      registerDocumentSymbolProvider(_sel, provider) {
        registered.symbol = provider;
        return { dispose() {} };
      }
    }
  };

  delete require.cache[require.resolve("../extension")];
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return mockVscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  const ext = require("../extension");
  const context = { subscriptions: [] };
  ext.activate(context);

  assert.ok(registered.definition, "DefinitionProvider should be registered");
  assert.ok(registered.reference, "ReferenceProvider should be registered");
  assert.ok(
    registered.highlight,
    "DocumentHighlightProvider should be registered"
  );
  assert.ok(registered.symbol, "DocumentSymbolProvider should be registered");

  const docText = "bit[] = < {} 0, {} 1 >;\nid = ?bit[];";
  const mockDoc = {
    languageId: "k",
    uri: { toString: () => "file:///test.k" },
    getText: () => docText,
    offsetAt: (pos) => pos,
    positionAt: (off) => off
  };
  mockVscode.workspace.textDocuments = [mockDoc];

  const defLocs = await registered.definition.provideDefinition(
    mockDoc,
    docText.indexOf("?bit[]") + 1
  );
  assert.strictEqual(defLocs.length, 1);
  assert.strictEqual(defLocs[0].range.start, 0);
  assert.strictEqual(defLocs[0].range.end, 3);

  const refLocs = await registered.reference.provideReferences(mockDoc, 0, {
    includeDeclaration: true
  });
  assert.strictEqual(refLocs.length, 2);

  const highlights = registered.highlight.provideDocumentHighlights(mockDoc, 0);
  assert.strictEqual(highlights.length, 2);
  assert.strictEqual(highlights[0].kind, 2); // Write
  assert.strictEqual(highlights[1].kind, 1); // Read

  const symbols = registered.symbol.provideDocumentSymbols(mockDoc);
  assert.deepStrictEqual(
    symbols.map((s) => s.name),
    ["bit[]", "id"]
  );

  console.log("navigation (definition & references) tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
