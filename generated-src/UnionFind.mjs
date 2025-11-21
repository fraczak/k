// Union-Find data structure for pattern equivalence classes

export class UnionFind {
  constructor() {
    this.parent = [];
    this.data = [];
  }

  makeSet(value) {
    const id = this.data.length;
    this.data.push(value);
    this.parent.push(null);
    return id;
  }

  find(id) {
    if (id < 0 || id >= this.data.length) {
      throw new Error(`Invalid id: ${id}`);
    }
    
    let root = id;
    while (this.parent[root] !== null) {
      root = this.parent[root];
    }
    
    // Path compression
    let current = id;
    while (current !== root) {
      const next = this.parent[current];
      this.parent[current] = root;
      current = next;
    }
    
    return root;
  }

  union(parentId, childIds) {
    const parent = this.find(parentId);
    for (const childId of childIds) {
      const child = this.find(childId);
      if (child !== parent) {
        this.parent[child] = parent;
      }
    }
  }

  get(id) {
    return this.data[this.find(id)];
  }

  set(id, value) {
    this.data[this.find(id)] = value;
  }

  size() {
    return this.data.length;
  }
}
