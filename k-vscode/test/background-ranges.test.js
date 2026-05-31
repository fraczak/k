const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { collectBackgroundRanges } = require("../extension");

function slices(text, ranges) {
  return ranges.map(({ start, end }) => text.slice(start, end));
}

const source = [
  "$ pair = { leaf left, leaf right };",
  "pick = $pair ?{<$leaf some, ...>=X branch, ...} .branch;",
  "-- ?<ignored tag>",
  "/* $ignored */",
  "$pair pick"
].join("\n");

const ranges = collectBackgroundRanges(source);
const type = slices(source, ranges.type);
const filter = slices(source, ranges.filter);

assert.deepStrictEqual(type, [
  "$ pair = { leaf left, leaf right };",
  "$pair",
  "$leaf",
  "$pair"
]);
assert.deepStrictEqual(filter, ["?{<$leaf some, ...>=X branch, ...}"]);

const nested = "add = ?{ $nat x, ... } = X <{.x pred x, .y succ y} ? X add, .y> ;";
const nestedRanges = collectBackgroundRanges(nested);

assert.deepStrictEqual(slices(nested, nestedRanges.filter), [
  "?{ $nat x, ... } = X",
  "? X"
]);
assert.deepStrictEqual(slices(nested, nestedRanges.type), ["$nat"]);
assert.deepStrictEqual(nestedRanges.filter, [
  { start: 6, end: 26 },
  { start: 51, end: 54 }
]);
assert.deepStrictEqual(nestedRanges.type, [{ start: 9, end: 13 }]);

console.log("background range scanner tests passed");
