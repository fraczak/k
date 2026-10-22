-- Examples/nat.k: Peano natural numbers arithmetic

0 = {} | 0;
0? = { /0 if, () then } .then;
succ = | +1;
pred = / +1;

nat[] = < {} 0, N +1 > = N;
nat? = ? nat[];
nat_pair[] = { nat[] x, nat[] y };

add = ? nat_pair[] <{.x pred x, .y succ y} add, .y>;
mult = ? nat_pair[] <
  {{.x pred x, .y y} mult x, .y y} add,
  0
>;

succ {()x, ()y} add
