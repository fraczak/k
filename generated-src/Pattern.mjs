// Pattern representation for type constraints

export class Pattern {
  constructor(type, fields = []) {
    this.type = type; // 'open-unknown' | 'open-product' | 'open-union' | 'closed-unknown' | 'closed-product' | 'closed-union' | 'type'
    this.fields = new Set(fields);
    this.typeName = null; // for type === 'type'
  }

  static openUnknown(fields = []) {
    return new Pattern('open-unknown', fields);
  }

  static openProduct(fields = []) {
    return new Pattern('open-product', fields);
  }

  static openUnion(fields = []) {
    return new Pattern('open-union', fields);
  }

  static closedUnknown(fields = []) {
    return new Pattern('closed-unknown', fields);
  }

  static closedProduct(fields = []) {
    return new Pattern('closed-product', fields);
  }

  static closedUnion(fields = []) {
    return new Pattern('closed-union', fields);
  }

  static type(name) {
    const p = new Pattern('type');
    p.typeName = name;
    return p;
  }

  isOpen() {
    return this.type.startsWith('open-');
  }

  isClosed() {
    return this.type.startsWith('closed-');
  }

  isType() {
    return this.type === 'type';
  }

  getConstructor() {
    if (this.type.includes('unknown')) return 'unknown';
    if (this.type.includes('product')) return 'product';
    if (this.type.includes('union')) return 'union';
    return null;
  }

  clone() {
    const p = new Pattern(this.type, Array.from(this.fields));
    p.typeName = this.typeName;
    return p;
  }
}
