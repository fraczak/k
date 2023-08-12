car = .0;
cdr = < SNOC.1, .0 [] >;
empty? = $[{}] <.0 'nope', 'yes'> .yes [];


map_f = [(),"+",(),"=",[(),()]PLUS] CONCAT;
map = <[car map_f, cdr map] CONS, []> ;


reduce_f = <GT.0,.1>; -- maximum 
reduce = <
  [.list car, {.list cdr list, .acc acc} reduce] reduce_f, 
  .acc
>;

{{() list, .0 acc} reduce reduce, map map}

