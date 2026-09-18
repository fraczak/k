export function createInterface() {
  return {
    on() { return this; },
    close() {},
    prompt() {},
    setPrompt() {},
    write() {}
  };
}

export default { createInterface };
