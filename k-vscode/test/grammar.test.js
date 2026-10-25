const assert = require("assert");
const fs = require("fs");
const path = require("path");

const grammarPath = path.join(__dirname, "../syntaxes/k.tmLanguage.json");
const grammar = JSON.parse(fs.readFileSync(grammarPath, "utf8"));

// 1. Test pattern definition regex and captures
const patDef = grammar.repository["pattern-definition"];
const patDefRegex = new RegExp(patDef.begin);

// 0-arity pattern definition
const bitsDef = "bits[] = < {} _, B 0, B 1 > = B;";
const bitsMatch = bitsDef.match(patDefRegex);
assert.ok(bitsMatch, "bits[] = ... should match pattern-definition");
assert.strictEqual(bitsMatch[1], "bits");
assert.strictEqual(bitsMatch[2], "[");
assert.strictEqual(bitsMatch[3], "");
assert.strictEqual(bitsMatch[4], "]");
assert.strictEqual(bitsMatch[5], "=");
assert.strictEqual(
  patDef.beginCaptures["1"].name,
  "entity.name.type.pattern.k"
);
assert.strictEqual(
  patDef.beginCaptures["2"].name,
  "entity.name.type.pattern.k"
);
assert.strictEqual(
  patDef.beginCaptures["4"].name,
  "entity.name.type.pattern.k"
);

// Parameterized pattern definition
const listDef = "list[X] = < {} nil, { X car, Y cdr } cons > = Y;";
const listMatch = listDef.match(patDefRegex);
assert.ok(listMatch, "list[X] = ... should match pattern-definition");
assert.strictEqual(listMatch[1], "list");
assert.strictEqual(listMatch[2], "[");
assert.strictEqual(listMatch[3], "X");
assert.strictEqual(listMatch[4], "]");
assert.strictEqual(listMatch[5], "=");
assert.strictEqual(
  patDef.beginCaptures["3"].name,
  "variable.parameter.pattern.k"
);

// 2. Test canonical pattern definition regex and captures
const canonDef = grammar.repository["canonical-pattern-definition"];
const canonDefRegex = new RegExp(canonDef.begin);
const cDef = "@hash[X0, X1] = { X0 a, X1 b };";
const cMatch = cDef.match(canonDefRegex);
assert.ok(cMatch, "@hash[...] = should match canonical-pattern-def");
assert.strictEqual(cMatch[1], "@");
assert.strictEqual(cMatch[2], "hash");
assert.strictEqual(cMatch[3], "[");
assert.strictEqual(cMatch[4], "X0, X1");
assert.strictEqual(cMatch[5], "]");
assert.strictEqual(cMatch[6], "=");
assert.strictEqual(
  canonDef.beginCaptures["1"].name,
  "punctuation.definition.canonical.k"
);
assert.strictEqual(
  canonDef.beginCaptures["2"].name,
  "entity.name.type.canonical.k"
);
assert.strictEqual(
  canonDef.beginCaptures["3"].name,
  "entity.name.type.canonical.k"
);
assert.strictEqual(
  canonDef.beginCaptures["5"].name,
  "entity.name.type.canonical.k"
);

// 3. Test pattern-apply-named begin/end regex and captures
const patApply = grammar.repository["pattern-apply-named"];
const patApplyBeginRegex = new RegExp(patApply.begin);
const appMatch = "bits[]".match(patApplyBeginRegex);
assert.ok(appMatch, "bits[ should match pattern-apply-named begin");
assert.strictEqual(appMatch[1], "bits");
assert.strictEqual(appMatch[2], "[");
assert.strictEqual(
  patApply.beginCaptures["1"].name,
  "support.type.pattern.k"
);
assert.strictEqual(
  patApply.beginCaptures["2"].name,
  "support.type.pattern.k"
);
assert.strictEqual(
  patApply.endCaptures["1"].name,
  "support.type.pattern.k"
);

// 4. Test pattern-apply-canonical begin/end regex and captures
const canonApply = grammar.repository["pattern-apply-canonical"];
const canonApplyBeginRegex = new RegExp(canonApply.begin);
const caMatch = "@hash[]".match(canonApplyBeginRegex);
assert.ok(caMatch, "@hash[ should match pattern-apply-canonical begin");
assert.strictEqual(caMatch[1], "@");
assert.strictEqual(caMatch[2], "hash");
assert.strictEqual(caMatch[3], "[");
assert.strictEqual(
  canonApply.beginCaptures["1"].name,
  "punctuation.definition.canonical.k"
);
assert.strictEqual(
  canonApply.beginCaptures["2"].name,
  "support.type.canonical.k"
);
assert.strictEqual(
  canonApply.beginCaptures["3"].name,
  "support.type.canonical.k"
);
assert.strictEqual(
  canonApply.endCaptures["1"].name,
  "support.type.canonical.k"
);

// 5. Test filter-expression for ? pattern[...]
const filterExp = grammar.repository["filter-expression"];
const canonFilterRule = filterExp.patterns.find(
  p => p.begin && p.begin.includes("(@)")
);
assert.ok(canonFilterRule, "filter-expression should have ? @hash[ rule");
const cfMatch = "? @hash[X]".match(new RegExp(canonFilterRule.begin));
assert.ok(cfMatch, "? @hash[ should match filter canonical rule");
assert.strictEqual(cfMatch[1], "?");
assert.strictEqual(cfMatch[2], "@");
assert.strictEqual(cfMatch[3], "hash");
assert.strictEqual(cfMatch[4], "[");
assert.strictEqual(
  canonFilterRule.beginCaptures["3"].name,
  "support.type.canonical.k"
);
assert.strictEqual(
  canonFilterRule.beginCaptures["4"].name,
  "support.type.canonical.k"
);
assert.strictEqual(
  canonFilterRule.endCaptures["1"].name,
  "support.type.canonical.k"
);

const patFilterRule = filterExp.patterns.find(
  p => p.begin && !p.begin.includes("(@)") && p.begin.includes("(\\[)")
);
assert.ok(patFilterRule, "filter-expression should have ? pattern[ rule");
const pfMatch = "? list[X]".match(new RegExp(patFilterRule.begin));
assert.ok(pfMatch, "? list[ should match filter-expression pattern rule");
assert.strictEqual(pfMatch[1], "?");
assert.strictEqual(pfMatch[2], "list");
assert.strictEqual(pfMatch[3], "[");
assert.strictEqual(
  patFilterRule.beginCaptures["2"].name,
  "support.type.pattern.k"
);
assert.strictEqual(
  patFilterRule.beginCaptures["3"].name,
  "support.type.pattern.k"
);
assert.strictEqual(
  patFilterRule.endCaptures["1"].name,
  "support.type.pattern.k"
);

console.log("grammar regex and capture tests passed");
