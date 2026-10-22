-- Examples/buda.k: Relational list algorithms using named patterns
-- Uses arbitrary-precision integers from Examples/arithmetics.k.

bits[] = < {} _, B 0, B 1 > = B;
int[] = < bits[] "+", bits[] "-" >;

list[X] = < {} nil, { X car, Y cdr } cons > = Y;
list? = ? list[X];

nths_args[X] = { int[] n, list[X] list };
reverse_state[X] = { list[X] reversed, list[X] list };
split_state[X] = { list[X] odd, list[X] even, list[X] list };
split_result[X] = { list[X] odd, list[X] even };

nil = {} | nil list?;
cons = { .car car, .cdr cdr } | cons list?;
car = list? /cons .car;
cdr = list? /cons .cdr;

nths = ? nths_args[X]
  < 
    { .n pos? dec n, .list cdr list } nths,
    { .n zero_int? if, .list car then } .then
  >;

reverse = ? list[X]
  { nil reversed, () list } _reverse;
  
_reverse = ? reverse_state[X]
  <   
    {
      { .list car car, .reversed cdr } cons reversed,
      .list cdr list
    } _reverse,
    .reversed
  >
;

split = ? list[X]
  { nil odd, nil even, reverse list } _split
;

_split = ? split_state[X]
  < 
    { 
      { .list car car, .odd cdr } cons odd,
      .even even,
      .list cdr list
    } split_,

    { .odd odd, .even even }
  >
;

split_ = ? split_state[X]
  < 
    { 
      .odd odd,
      { .list car car, .even cdr } cons even,
      .list cdr list
    } _split,
    { .odd odd, .even even }
  >
;

()
