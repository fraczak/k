import { createHash } from "node:crypto";

function hash(inputString, options = {}) {
    const { short = false, minLength = 7 } = options;
    let input = inputString;
    if (input.match(/^\$C0=.*;$/))
        input = input.slice(4, -1);

    const full = createHash("sha256").update(input).digest("hex");
    const body = short ? full.slice(0, Math.max(1, minLength)) : full;
    return "@" + body;
}

export default hash;
export { hash };
