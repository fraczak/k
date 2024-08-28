car =  ?[X] .0;
cdr = ?[X] < SNOC.cdr, .0 [] >;
empty? = ?[X] <.0 'nope', 'yes'> .yes [] ?[X];


map_f = [toJSON,"+",toJSON ,"=", [(),()] PLUS toJSON] CONCAT;
map = <{car map_f car, cdr map cdr} CONS, []> ;


# reduce_f = <GT.0,.1>; -- maximum
reduce_f = ?{A acc, X elem} [.acc, .acc, .elem, -1] PLUS ?A;  
reduceR = <
  {.list car elem, {.list cdr list, .acc acc} reduceR acc} reduce_f, 
  .acc
>;

reduceL = < 
  {{.acc acc, .list car elem} reduce_f acc, .list cdr list} reduceL,
  .acc >;

length = < [1, cdr length] PLUS, 0 >;

main = {{() list, .0 acc} {reduceR right, reduceL left} reduce, map map, length length};

main

