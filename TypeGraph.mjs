export class TypePatternForest {
  constructor() {
    this.nodes = [];
    this.parent = [];
  }

  // Find the root of the set containing `x`
  find(x) {
    if (this.nodes[x] == undefined) 
      throw new Error(`Node of id='${x}' not found in the forest`);
    let result = x;
    let parent = this.parent[result];
    while (parent != undefined) {
      parent = this.parent[result = parent];
      if (parent == result) {
        console.log("Can happen a loop in the forest? It shouldn't!");
        break;
      }
        
    }
    return result;
  }

  addChildren(parentId, childrenIds) {
    const parent = this.find(parentId);
    childrenIds.forEach(childId => {
      const child = this.find(childId);
      if (this.nodes[child].pattern != 'type')
        this.parent[child] = parent;
    });
  }

  addNewNode(flatTypePattern, children = []) {
    const that = this;
    const id = this.nodes.length;
    // const node = {...flatTypePattern, _id: id};
    const node = {...flatTypePattern}
    that.nodes.push(node);
    Array.from(new Set(children.map(that.find.bind(that))))
    .forEach(rep => {that.parent[rep] = id});
    return id;
  }
}
