
const literalRegex = /^(?:0b[01]*|0x[0-9a-fA-F]+|0o[0-7]+|\d+)([_](?:0b[01]+|0x[0-9a-fA-F]+|0o[0-7]+|\d+))*$/;

function parseSegment(segment) {
    if (segment.startsWith('0b')) {
        return segment.substring(2);
    } else if (segment.startsWith('0x')) {
        return Array.from(segment.substring(2))
        .map(x => 
            parseInt(x,16).toString(2).padStart(4,'0'))
        .join('');
    } else if (segment.startsWith('0o')) {
        return Array.from(segment.substring(2))
        .map(x => 
            parseInt(x,8).toString(2).padStart(3,'0'))
        .join('');
    } else { // Decimal
        return BigInt(segment).toString(2);
    }
}


function parse(inputStr) {
    if (!literalRegex.test(inputStr)) {
        throw new Error(`Invalid input: ${inputStr}`);
    }
    const finalBitString = inputStr.split('_')
    .map(parseSegment)
    .join('');

    return finalBitString.split('').map(b => parseInt(b, 10));
}

class Bits {

    constructor(bitArray) {
        if (!Array.isArray(bitArray) || !bitArray.every(b => b === 0 || b === 1)) {
            throw new Error("Bits constructor expects an array of 0s and 1s.");
        }
        this.bits = Object.freeze([...bitArray]); // Store an immutable copy
    }

    get length() {
        return this.bits.length;
    }
    toString() {
        return `0b${this.bits.join('')}`;
    }

    toJSON() {
        return this.toString();
    }

    eatPrefix(prefixBits) {
        
        if (prefixBits.length > this.length) {
            return; // Prefix is longer, so it can't be a prefix
        }

        for (let i = 0; i < prefixBits.length; i++) {
            if (this.bits[i] !== prefixBits.bits[i]) {
                return; // Prefix does not match
            }
        }

        // Prefix matches, return a new Bits object with the remainder
        const remainingBitArray = this.bits.slice(prefixBits.length);
        return new Bits(remainingBitArray);
    }

    prepend(prefixBits) {
        if (!(prefixBits instanceof Bits)) {
            throw new Error("Prefix must be an instance of Bits.");
        }
        const newBitArray = [...prefixBits.bits, ...this.bits];
        return new Bits(newBitArray);
    }
}

/*
try {
    let bits;
    
    // Example: 0x414243 (hex)
    bits = parse("0x414243");
    console.log(`"0x414243" -> ${bits.join('')}`);
    // Expected: 010000010100001001000011

    // Example: 0o20241103 (octal)
    bits = parse("0o20241103");
    console.log(`"0o20241103" -> ${bits.join('')}`);
    // Expected: 010000010100001001000011

    // Example: 65 (decimal)
    bits = parse("65");
    console.log(`"65" -> ${bits.join('')}`);
    // Expected: 01000001 (1 byte)

    // Example: 0 (decimal)
    bits = parse("0");
    console.log(`"0" -> ${bits.join('')}`);
    // Expected: 00000000 (1 byte)

    // Example: 256 (decimal)
    bits = parse("256");
    console.log(`"256" -> ${bits.join('')}`);
    // Expected: 0000000100000000 (2 bytes)

    // Example: 0b101 (binary)
    bits = parse("0b101");
    console.log(`"0b101" -> ${bits.join('')}`);
    // Expected: 101 (no byte alignment for explicit binary)

    // Example: Concatenated sequence
    bits = parse("0x41_66_0b01000011");
    console.log(`"0x41_66_0b01000011" -> ${bits.join('')}`);
    // Expected: 01000001010000100100001101000100

    // Example: Empty string literal
    bits = parse("0b");
    console.log(`"0b" -> [${bits.join(',')}] (length: ${bits.length})`);
    // Expected: [] (length: 0)

} catch (e) {
    console.error(`Unexpected error: ${e}`);
}

function isValidLiteral(inputStr) {
  return literalRegex.test(inputStr);
}

// Examples:
console.log(`"0b101" is valid: ${isValidLiteral("0b101")}`); // true
console.log(`"0xAF" is valid: ${isValidLiteral("0xAF")}`);   // true
console.log(`"123" is valid: ${isValidLiteral("123")}`);     // true
console.log(`"'hello'" is valid: ${isValidLiteral("'hello'")}`); // true
console.log(`"\"world\"" is valid: ${isValidLiteral("\"world\"")}`); // true
console.log(`"invalid" is valid: ${isValidLiteral("invalid")}`); // false
console.log(`"0b123" is valid: ${isValidLiteral("0b123")}`);   // false (binary can only contain 0 or 1)
console.log(`"0xFG" is valid: ${isValidLiteral("0xFG")}`);     // false (hex can only contain 0-9, a-f, A-F)

*/

// Export the parser class for use in other modules
export { Bits, parse, literalRegex };
export default { Bits, parse, literalRegex };