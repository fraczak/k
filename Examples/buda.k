-- Examples/buda.k: Relational list algorithms using named patterns
-- Uses arbitrary-precision integers from Examples/arithmetics.k.

bits[] = < {} _, B 0, B 1 > = B;
int[] = < bits[] "+", bits[] "-" >;

list[X] = < {} nil, { X car, Y cdr } cons > = Y;
list? = ? list[X];

nil = {} | nil list?;
cons = { .car car, .cdr cdr } | cons list?;
car = list? /cons .car;
cdr = list? /cons .cdr;

nths = ?{ int[] n, list[X] list } 
  < 
    { .n pos? dec n, .list cdr list } nths,
    { .n zero_int? if, .list car then } .then
  >;

reverse = ? list[X]
  { nil reversed, () list } _reverse;
  
_reverse = ?{ list[X] reversed, list[X] list } 
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

_split = ?{ list[X] odd, list[X] even, list[X] list }
  < 
    { 
      { .list car car, .odd cdr } cons odd,
      .even even,
      .list cdr list
    } split_,

    { .odd odd, .even even }
  >
;

split_ = ?{ list[X] odd, list[X] even, list[X] list }
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
