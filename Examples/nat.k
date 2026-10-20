-- Examples/nat.k: Peano natural numbers arithmetic

0 = {} | 0;
0? = { /0 if, () then } .then;
succ = | +1;
pred = / +1;

nat[] = < {} 0, N +1 > = N;
nat? = ? nat[];

add = ?{ nat[] = N x, ... } = X <{.x pred x, .y succ y} ?X add, .y>;
mult = ?{ nat[] = M x, ... } <
  {{.x pred x, .y y} mult x, .y y} add,
  0
>;

succ {()x, ()y} add
