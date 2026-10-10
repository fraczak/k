0 = {} | 0 ;
0? = { / 0 if, () then} .then;
succ = | +1 ;
pred = / +1 ;
add = ?{ < {} 0, N +1 > = N x, ... } = X <{.x pred x, .y succ y} ?X add, .y> ;
mult = ?{ < {} 0, M +1 > = M x, ... } <
    {{.x pred x, .y y} mult x, .y y} add,
    0
> ;

succ {()x,()y} add
