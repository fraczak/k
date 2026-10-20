-- Examples/list.k: Generic linked list patterns and relations

list[X] = < {} nil, { X car, Y cdr } cons > = Y;
list? = ? list[X];

nil = {} | nil list?;
singleton = { () car, nil cdr } | cons list?;
cons = { .car car, .cdr cdr } | cons list?;
nil? = list? /nil nil;
car = list? /cons .car;
cdr = list? /cons .cdr;
