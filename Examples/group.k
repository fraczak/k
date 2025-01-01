remove = 
  ?{X 0, [X] 1}
< 
    {.0 0, .1 SNOC 1} 
    { {.0 0,.1.cdr 1} remove r, .0 x, .1.car y } 
    < [.r, [.x,.y] EQ].0, {.y car, .r cdr} CONS >, 
    [[],[.0,.1.0] EQ] .0, 
    .1 
>
;

distinct = 
  ?[ X ]
< 
    SNOC {.car car, {.car 0, .cdr 1} remove distinct cdr} CONS, 
    () 
>
;

group = 
  ?[{X x, Y y}]
    { | .x ^ distinct x, () xy}
  ( 
      { .x | x, .xy xy } 
      { .x x, {.x 0, .xy | 1} {.1.y then, [.0,.1.x] EQ if}.then ^ y }
    ^
  )
;

[1,2,3] { | x, | y } ^ group

