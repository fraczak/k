import { Pattern } from './Pattern.mjs';

function setUnion(...sets) {
  const result = new Set();
  for (const s of sets) {
    for (const item of s) {
      result.add(item);
    }
  }
  return result;
}

function setEquals(s1, s2) {
  if (s1.size !== s2.size) return false;
  for (const item of s1) {
    if (!s2.has(item)) return false;
  }
  return true;
}

function setSubset(s1, s2) {
  for (const item of s1) {
    if (!s2.has(item)) return false;
  }
  return true;
}

export function unifyTwo(p1, p2, reason) {
  // Type patterns
  if (p1.isType() && p2.isType()) {
    if (p1.typeName !== p2.typeName) {
      throw new Error(`${reason}: Cannot unify different types: ${p1.typeName} and ${p2.typeName}`);
    }
    return p1.clone();
  }
  
  if (p1.isType()) {
    if (!setSubset(p2.fields, p1.fields)) {
      throw new Error(`${reason}: Type ${p1.typeName} doesn't have fields: ${[...p2.fields]}`);
    }
    return p1.clone();
  }
  
  if (p2.isType()) {
    return unifyTwo(p2, p1, reason);
  }
  
  const c1 = p1.getConstructor();
  const c2 = p2.getConstructor();
  
  // Open patterns
  if (p1.isOpen() && p2.isOpen()) {
    if (c1 === 'product' && c2 === 'union') {
      throw new Error(`${reason}: Cannot unify product with union`);
    }
    if (c1 === 'union' && c2 === 'product') {
      throw new Error(`${reason}: Cannot unify union with product`);
    }
    
    const constructor = c1 === 'unknown' ? c2 : c1;
    const type = `open-${constructor}`;
    return new Pattern(type, setUnion(p1.fields, p2.fields));
  }
  
  // Open + Closed
  if (p1.isOpen() && p2.isClosed()) {
    if (c1 === 'product' && c2 === 'union') {
      throw new Error(`${reason}: Cannot unify product with union`);
    }
    if (c1 === 'union' && c2 === 'product') {
      throw new Error(`${reason}: Cannot unify union with product`);
    }
    
    if (!setSubset(p1.fields, p2.fields)) {
      throw new Error(`${reason}: Open pattern fields not subset of closed: ${[...p1.fields]} ⊄ ${[...p2.fields]}`);
    }
    return p2.clone();
  }
  
  if (p1.isClosed() && p2.isOpen()) {
    return unifyTwo(p2, p1, reason);
  }
  
  // Closed + Closed
  if (p1.isClosed() && p2.isClosed()) {
    if (c1 === 'product' && c2 === 'union') {
      throw new Error(`${reason}: Cannot unify product with union`);
    }
    if (c1 === 'union' && c2 === 'product') {
      throw new Error(`${reason}: Cannot unify union with product`);
    }
    
    if (!setEquals(p1.fields, p2.fields)) {
      throw new Error(`${reason}: Closed patterns have different fields: ${[...p1.fields]} ≠ ${[...p2.fields]}`);
    }
    
    const constructor = c1 === 'unknown' ? c2 : c1;
    const type = `closed-${constructor}`;
    return new Pattern(type, p1.fields);
  }
  
  throw new Error(`${reason}: Unhandled unification case: ${p1.type} with ${p2.type}`);
}

export function unifyPatterns(patterns, reason) {
  if (patterns.length === 0) {
    return Pattern.openUnknown();
  }
  
  let result = patterns[0];
  for (let i = 1; i < patterns.length; i++) {
    result = unifyTwo(result, patterns[i], reason);
  }
  return result;
}
