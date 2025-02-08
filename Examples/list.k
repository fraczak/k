list? = ?< {} nil, {X car, Y cdr} cons > = Y;
nil = {{} nil} list?;
singleton = {{() car, nil cdr} cons} list?;
cons = {{.car car, .cdr cdr} cons} list?;
nil? = list? .nil nil;
car = list? .cons .car;
cdr = list? .cons .cdr;
