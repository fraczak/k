car = .0;
cdr = < SNOC.1, .0 [] >;
empty? = $[{}] <.0 'nope', 'yes'> .yes [];


map_f = [(),"+",(),"=",[(),()]PLUS] CONCAT;
map = <[car map_f, cdr map] CONS, []> ;


# reduce_f = <GT.0,.1>; -- maximum
reduce_f = [.0, [.1, -1] TIMES] PLUS; -- substraction 
reduceR = <
  [.list car, {.list cdr list, .acc acc} reduceR] reduce_f, 
  .acc
>;

reduceL = < 
  {[.acc, .list car] reduce_f acc, .list cdr list} reduceL,
  .acc >;

length = < [1, cdr length] PLUS, 0 >;

main = {{() list, .0 acc} {reduceR right, reduceL left} reduce, map map, length length};

main

