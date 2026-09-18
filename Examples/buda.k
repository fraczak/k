// we will use arithmetics.k

nths = ?{$int n, LIST list} 
  < 
    {.n pos? dec n, .list cdr list } nths,
    {.n zero_int? if, .list list? car then} .then
  >;

reverse = ? LIST  list?
  {nil ? LIST reversed, () list } _reverse;
  
_reverse = ?{ LIST reversed, LIST list} 
  <   
    {{.list car car, .reversed cdr} cons reversed, .list cdr list } _reverse,
    .reversed
  >
;

split = ? LIST 
  { nil ? LIST odd, nil ? LIST even, reverse list } _split
;

_split = ? { LIST odd, LIST even, LIST list }
  < 
    { 
        {.list car car, .odd cdr} cons odd,
        .even even,
        .list cdr list
    } split_,

    {.odd odd, .even even}
  >
;

split_ = ? { LIST odd, LIST even, LIST list }
  < 
    { 
        .odd odd,
        {.list car car, .even cdr} cons even,
        .list cdr list
    } _split,
    {.odd odd, .even even}
  >
;
