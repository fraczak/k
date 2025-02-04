list? = ?< {} nil, {X car, Y cdr} cons > = Y;
nil = {{} nil} list?;
singleton = {{() car, nil cdr} cons} list?;
cons = {{.car car, .cdr cdr} cons} list?;
nil? = list? .nil nil;
car = list? .cons .car;
cdr = list? .cons .cdr;

inverse_ = ?{X x, X y} < { .x cdr x, { .x car car, .y cdr } cons y } inverse_, .y >;
inverse = { () x, nil y } inverse_;

tick? = list? ?<...,{{} car, X cdr} cons>; -- list of units

$ ticks = < {} nil, {{} car, ticks cdr} cons >;
inc = $ ticks {{} car, () cdr} cons;
one = nil inc;
two = one inc;
dec = $ ticks cdr;

list = <{.e car, {.e e, .n dec n} list cdr} cons, nil>;