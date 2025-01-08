cdr = SNOC .cdr;
remove = 
  ?{X value, [X] list}
< 
    { {.value value, .list cdr list} remove result, .value value, .list .0 car } 
      < {[.value,.car] EQ if, .result then} .then, {.car car, .result cdr} CONS >, 
    [.value, .list.0] EQ [], 
    .list 
>
;

distinct = 
  ?[ X ]
< 
    SNOC {.car car, {.car value, .cdr list} remove distinct cdr} CONS, 
    () 
>
;

group = 
  ?[{X x, Y y}] _log!
    { | .x ^ distinct x, () xy}
  ( 
      { .x | x, .xy xy } 
      { .x x, {.x 0, .xy | 1} {.1.y then, [.0,.1.x] EQ if}.then ^ y }
    ^
  )
;


[1,2,3] { | x, | y } ^ group

