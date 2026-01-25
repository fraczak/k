import { createHash } from "node:crypto";

const BASE56_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const BASE56_BASE = BigInt(BASE56_ALPHABET.length);
const SHA256_BASE56_LENGTH = 45;
function encodeBase56(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const mod = value % BASE56_BASE;
    encoded = BASE56_ALPHABET[Number(mod)] + encoded;
    value /= BASE56_BASE;
  }

  return encoded || BASE56_ALPHABET[0];
}

function hash(inputString, options = {}) {
  const { short = false, minLength = 7 } = options;
  let input = inputString;
  if (input.match(/^\$C0=.*;$/)) {
    input = input.slice(4, -1);
  }

  const digest = createHash("sha256").update(input).digest();
  const full = encodeBase56(digest);
  const padded = full.padStart(SHA256_BASE56_LENGTH, BASE56_ALPHABET[0]);
  const trimmed = padded.slice(1);
  const body = short ? trimmed.slice(0, Math.max(1, minLength)) : trimmed;
  return "@" + body;
}

export default hash;
export { hash };
