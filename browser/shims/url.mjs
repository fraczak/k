export function fileURLToPath(url) {
  return String(url).replace(/^file:\/\//, "");
}

export function pathToFileURL(filepath) {
  return new URL(`file://${filepath}`);
}

export default {
  fileURLToPath,
  pathToFileURL
};
