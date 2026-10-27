-- Examples/nat.k: Peano natural numbers arithmetic

nat[] = < {} 0, N +1 > = N;

0 = {} | 0 ?nat[];
0? = ?nat[] { /0 if, () then } .then;
succ = | +1 ?nat[];
pred = / +1 ?nat[];

nat_pair[] = { nat[] x, nat[] y };

add = ? nat_pair[] <{.x pred x, .y succ y} add, .y>;
mult = ? nat_pair[] <
  {{.x pred x, .y y} mult x, .y y} add,
  0
>;

succ {()x, ()y} add
