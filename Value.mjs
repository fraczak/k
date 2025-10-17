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

class Variant extends Value {
  constructor(tag, value) {
    super("<>");
    this.tag = tag;
    this.value = value;
    Object.freeze(this);
  }

  toString() {
    return `{${JSON.stringify(this.tag)}:${this.value.toString()}}`;
  }

  toJSON() {
    return {[this.tag]: this.value.toJSON()};
  }
}
export { Value, Product, Variant };
export default { Value, Product, Variant };