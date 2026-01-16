# Divergence detection (sketch)

We can detect divergence when there is a cycle of definitions:

```
X1 = D1;
X2 = D2;
...
Xn = Dn;
```

such that for each i, `Xi` is in `HEAD(Di-1)` (with indices modulo n).

Define `HEAD` as the set of direct first ref calls:

```
HEAD(ref(X)) = {X}
HEAD(?F E) = HEAD(E)
HEAD($T E) = HEAD(E)
HEAD((E1 E2 ...)) = HEAD(E1)
HEAD({ E1 f1, E2 f2, ... }) = HEAD(E1) union HEAD(E2) union ...
HEAD(<E1, E2, ...>) = {}   -- heads of a union is empty set
HEAD(/ tag) = HEAD(. lab) = HEAD(| tag) = {}
```
