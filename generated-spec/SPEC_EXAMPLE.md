# Type Derivation - Worked Example

## Example Program

```k
$ pair = { nat x, nat y };
$ swap = { .y a, .x b };
```

## Step-by-Step Derivation

### Function: swap

**Expression:** `{ .y a, .x b }`

#### Step 1: Initialize Patterns

```
product({ .y a, .x b })     [p0, p1]
  .y                        [p2, p3]
  .x                        [p4, p5]
```

All patterns start as `(...)`.

#### Step 2: Apply Local Rules

**For `.y`:**
```
p2 = (...) with edge y → p3
```

**For `.x`:**
```
p4 = (...) with edge x → p5
```

**For product:**
```
unify(p0, p2, p4)  // all inputs equal
p1 = {} with edges: a → p3, b → p5
```

#### Step 3: After Unification

```
p0 = p2 = p4 = (...) with edges: x → p5, y → p3
p1 = {} with edges: a → p3, b → p5
p3 = (...)
p5 = (...)
```

**Type signature:**
```
swap : (...){x: α, y: β} → {}{a: β, b: α}
```

Or more readably:
```
swap : {x: α, y: β, ...} → {a: β, b: α}
```

### Function: swap with type constraint

**Expression:** `pair swap`

#### Step 1: Initialize

```
comp(pair, swap)     [p6, p7]
  pair               [p8, p9]
  swap               [p10, p11]
```

#### Step 2: Clone swap's patterns

From previous derivation:
```
swap: [p0, p1] where
  p0 = (...){x: p5, y: p3}
  p1 = {}{a: p3, b: p5}
```

Clone into current graph:
```
p10' = (...){x: p5', y: p3'}
p11' = {}{a: p3', b: p5'}
```

#### Step 3: Apply composition rule

```
unify(p6, p8)      // in(comp) = in(pair)
unify(p9, p10')    // out(pair) = in(swap)
unify(p11', p7)    // out(swap) = out(comp)
```

#### Step 4: Unify with pair type

```
pair = Type("pair") where pair = {nat x, nat y}
```

So:
```
p8 = p9 = Type("pair")
```

This forces:
```
p10' = Type("pair") = (...){x: p5', y: p3'}
```

Which means:
```
p5' = Type("nat")
p3' = Type("nat")
```

Therefore:
```
p11' = {}{a: Type("nat"), b: Type("nat")}
```

#### Final Type

```
pair swap : Type("pair") → {a: nat, b: nat}
```

## Example: Recursive Function

```k
$ nat = < {} zero, nat succ >;
$ add = < {{} zero} .x, {add .x} succ >;
```

### Function: add

**Expression:** `< {{} zero} .x, {add .x} succ >`

#### Iteration 1

**Initialize:**
```
union(...)           [p0, p1]
  product(...)       [p2, p3]
    identity         [p4, p4]
  product(...)       [p5, p6]
    comp(...)        [p7, p8]
      ref(add)       [p9, p10]
      .x             [p11, p12]
```

**Apply rules:**
```
// Union
unify(p0, p2, p5)
unify(p1, p3, p6)

// First branch: {{} zero} .x
p2 = p4 = (...)
p3 = <...>{zero: p4}

// Second branch: {add .x} succ
p5 = p7 = p11 = (...){x: p12}
p6 = <...>{succ: p8}

// Composition: add .x
unify(p7, p9)
unify(p10, p11)
unify(p8, p12)
```

**After iteration 1:**
```
p0 = (...){x: p12}
p1 = <...>{zero: (...), succ: p12}
p9 = (...){x: p12}
p10 = (...){x: p12}
```

#### Iteration 2

**Clone add's current type:**
```
add: [p0, p1] = [(...){x: p12}, <...>{zero: (...), succ: p12}]
```

**Unify with reference:**
```
unify(p9, p0)  // already equal
unify(p10, p1)
```

This gives:
```
p10 = <...>{zero: (...), succ: p12}
p11 = (...){x: p12}
p8 = p12
```

**After iteration 2:**
```
p0 = (...){x: <...>{zero: (...), succ: ...}}
p1 = <...>{zero: (...), succ: <...>{zero: (...), succ: ...}}
```

#### Convergence

After a few iterations, patterns stabilize to:
```
add : (...){x: nat} → nat
```

Where `nat = <{} zero, nat succ>`.

## Key Observations

1. **Open patterns** allow flexibility (e.g., `{x: α, ...}` accepts any record with at least field x)
2. **Unification** propagates constraints through the graph
3. **Cloning** handles function references without modifying original types
4. **Iteration** resolves recursive dependencies
5. **Compression** identifies equivalent patterns and converts to named types
