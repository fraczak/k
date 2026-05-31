$ nat = < {} 0, nat +1 >;
0 = {} | 0 ;
0? = $ nat { / 0 if, () then} .then;
succ = | +1 $ nat ;
pred = $nat / +1 ;
add = ?{ $nat x, ... } = X <{.x pred x, .y succ y} ?X add, .y> ;
mult = <
    {{.x pred x, .y y} mult x, .y y} add,
    0
> ;

succ {()x,()y} add
