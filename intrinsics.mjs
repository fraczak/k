const intrinsicDefinitions = new Map([
  ["_log!", {
    type: "identity",
    targets: new Set(["js"]),
    js(arg) {
      console.error(`_log!: ${arg}`);
      return arg;
    }
  }]
]);

const jsIntrinsicFunctions = Object.freeze(Object.fromEntries(
  [...intrinsicDefinitions]
    .filter(([, intrinsic]) => typeof intrinsic.js === "function")
    .map(([name, intrinsic]) => [name, intrinsic.js])
));

function getIntrinsic(name) {
  return intrinsicDefinitions.get(name) || null;
}

function isIntrinsic(name) {
  return intrinsicDefinitions.has(name);
}

function isIdentityIntrinsic(name) {
  return getIntrinsic(name)?.type === "identity";
}

function unsupportedIntrinsic(target, name) {
  return new Error(`${target}: unsupported intrinsic '${name}'`);
}

export {
  intrinsicDefinitions,
  jsIntrinsicFunctions,
  getIntrinsic,
  isIntrinsic,
  isIdentityIntrinsic,
  unsupportedIntrinsic
};
