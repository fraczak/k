function unsupported(name) {
  throw new Error(`node:child_process.${name} is not available in the browser`);
}

export function execFileSync() {
  unsupported("execFileSync");
}

export function spawnSync() {
  unsupported("spawnSync");
}

export function spawn() {
  unsupported("spawn");
}

export function execSync() {
  unsupported("execSync");
}

export default {
  execFileSync,
  spawnSync,
  spawn,
  execSync
};
