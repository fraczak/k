import assert from "node:assert/strict";
import k from "../index.mjs";
import { valueToK } from "../codecs/runtime/show-value.mjs";

for (const [data, source] of [
  [{ unit: {} }, "()"],
  [{ name: { ala: {} }, age: { twentythree: {} } }, "{.name name, .age age}"],
  [{ year: { twothousandtwo: {} }, age: { nineteen: {} } }, "{.year year, .age age}"],
  [{ test: { parseunit: {} } }, "()"]
]) {
  assert.equal(valueToK(k.run(source, data)), valueToK(k.fromObject(data)), source);
}

const list = k.compile(`
  true = {} |true;
  false = {} |false;
  list? = ?< {} nil, {X car, Y cdr} cons > = Y;
  nil = {}|nil list?;
  nil? = list? /nil nil;
  car = list? /cons .car;
  list? { <nil? true, false> nil_test, <car, {}|none> car }
`);
for (const [data, isNil, head] of [
  [{ None: {} }, "false", "none"],
  [{ nil: {} }, "true", "none"],
  [{ cons: { car: { unit: {} }, cdr: { cons: { car: { unit: {} }, cdr: { nil: {} } } } } }, "false", "unit"],
  [{ cons: { car: { on: {} }, cdr: { cons: { car: { off: {} }, cdr: { nil: {} } } } } }, "false", "on"]
]) {
  const { product } = list(k.fromObject(data));
  assert.equal(product.nil_test.tag, isNil);
  assert.equal(product.car.tag, head);
}
assert.equal(k.compile("{} |ok")(k.fromObject({})).tag, "ok");
console.log("runtime API: ok");
