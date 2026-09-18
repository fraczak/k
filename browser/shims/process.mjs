export const argv = ["browser"];
export const env = {};

export function exit(code = 0) {
  console.warn(`process.exit(${code}) called in browser`);
}

export const stdin = {
  on() {},
  resume() {},
  pause() {}
};

export const stdout = {
  write(chunk) {
    console.log(chunk);
  }
};

export const hrtime = function() {
  const now = performance.now();
  const sec = Math.floor(now / 1000);
  const nsec = Math.floor((now % 1000) * 1e6);
  return [sec, nsec];
};
hrtime.bigint = function() {
  return BigInt(Math.round(performance.now() * 1e6));
};

export const processShim = {
  argv,
  env,
  exit,
  stdin,
  stdout,
  hrtime,
  versions: { wabt_browser: "1.0" }
};

if (typeof globalThis !== "undefined" && (!globalThis.process || !globalThis.process.hrtime)) {
  globalThis.process = processShim;
}

export default processShim;
