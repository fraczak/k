
class Value {
  constructor(type) {
    this.type = type;
  }

  toString() {
    return `${this.constructor.name}(type: ${this.type})`;
  }
  toJSON() {
    return { type: this.type };
  }

}

class Bits extends Value {

  static literalRegex = /^(?:0b[01]*|0x[0-9a-fA-F]+|0o[0-7]+|\d+)([_](?:0b[01]+|0x[0-9a-fA-F]+|0o[0-7]+|\d+))*$/;

  static _parseSegment(segment) {
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
  
  static utf8ToBitString(str) {
    return Array.from(str)
      .map(char => char.charCodeAt(0).toString(2).padStart(8, '0'))
      .join('')
  }

  static segmentsToBitString(str) {
    return str.split('_')
      .map(Bits._parseSegment)
      .join('')
  }

  static bitStringToBits(bitString) {
    return new Bits(bitString.split('').map(b => parseInt(b, 2)));
  }

  static utf8ToBits(utf8String) {
    const bitString = Bits.utf8ToBitString(utf8String);
    return Bits.bitStringToBits(bitString);
  }
  
  static segmentsToBits(str) {
    if (!Bits.literalRegex.test(str)) {
      throw new Error("Invalid bit string format.");
    }
    const bitString = Bits.segmentsToBitString(str);
    return Bits.bitStringToBits(bitString);
  }

  constructor(bitArray) {
    super('@bits');

    if (!Array.isArray(bitArray) || !bitArray.every(b => b === 0 || b === 1)) {
      throw new Error("Bits constructor expects an array of 0s and 1s.");
    }
    this.bits = Object.freeze([...bitArray]); // Store an immutable copy
    
    // compute string representation (will be utf8 string if possible, or binary otherwise)
    const bitString = this.bits.join('');
    const byteArray = [];
    for (let i = 0; i < bitString.length; i += 8) {
      byteArray.push(parseInt(bitString.slice(i, i + 8), 2));
    }
    const utf8String = String.fromCharCode(...byteArray);
    this.utf8Flag = (bitString === Bits.utf8ToBitString(utf8String));
    if (this.utf8Flag) {
      this.string = utf8String;
    } else {
      const parts = [];
      for (let i = 0; i < bitString.length; i += 8) {
        parts.push(bitString.slice(i, i + 8));
      }
      // console.log(parts);
      this.string = `0b${parts.join('_0b')}`;
    }
    Object.freeze(this);
  }

  get length() {
    return this.bits.length;
  }

  toString() { 
    if (! this.utf8Flag) return this.string;
    return JSON.stringify(this.string);
  }

  toJSON() {
    if (this.utf8Flag) return this.string;
    return { "@bits": this.string };
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

  
class Vector extends Value {
  constructor(vector) {
    super('[]');
    if (!Array.isArray(vector)) {
      throw new Error("Vector constructor expects an array.");
    }
    this.vector = Object.freeze([...vector]);
    Object.freeze(this);
  }

  toString() {
    return `[${this.vector.map(i => i.toString()).join(',')}]`;
  }

  toJSON() {
    return this.vector;
  }
}

class Product extends Value {
  constructor(product) {
    super("{}");
    this.product = Object.freeze({ ...product });
    Object.freeze(this);
  }

  toString() {
    return `{${Object.entries(this.product).map(([k, v]) => `${v.toString()} ${JSON.stringify(k)}`).join(',')}}`;
  }
  toJSON() {
    return this.product
  }
}

export { Value, Bits, Vector, Product };
export default { Value, Bits, Vector, Product };