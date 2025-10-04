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
    return `{${Object.entries(this.product).map(([k, v]) => `${JSON.stringify(k)}:${v.toString()}`).join(',')}}`;
  }

  toJSON() {
    return this.product
  }
}

export { Value, Vector, Product };
export default { Value, Vector, Product };