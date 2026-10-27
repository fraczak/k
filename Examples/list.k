-- Examples/list.k: Generic linked list patterns and relations

list[X] = < {} nil, { X car, Y cdr } cons > = Y;

nil = {} | nil ? list[(...)];
singleton = { () car, nil cdr } | cons ? list[(...)];
cons = { .car car, .cdr cdr } | cons ? list[(...)];
nil? = ? list[(...)] /nil nil;
car = ? list[X] /cons .car ?X;
cdr = ? list[(...)] /cons .cdr;
