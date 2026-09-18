export function assert(val, msg) {
  if (!val) throw new Error(msg || "Assertion failed");
}

assert.equal = function(a, b, msg) {
  if (a != b) throw new Error(msg || `${a} != ${b}`);
};

assert.strictEqual = function(a, b, msg) {
  if (a !== b) throw new Error(msg || `${a} !== ${b}`);
};

assert.deepEqual = function(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || "Deep equality assertion failed");
};

assert.ok = assert;

export default assert;
