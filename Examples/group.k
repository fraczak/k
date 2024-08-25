remove = 
-- ${int 0, [int] 1}
< 
    {.0 0, .1 SNOC 1} 
    { {.0 0,.1.cdr 1} remove r, .0 x, .1.car y } 
    < [.r, [.x,.y] EQ].0, {.y car, .r cdr} CONS >, 
    [[],[.0,.1.0] EQ] .0, 
    .1 
>
-- $[ int ]
;

distinct = 
-- $[ int ]
< 
    SNOC {.car car, {.car 0, .cdr 1} remove distinct cdr} CONS, 
    () 
>
-- $[ int ]
;

group = 
-- $[{int x, int y}]
    { | .x ^ distinct x, () xy}
-- ${[int] x, [{int x, int y}] xy}
  ( 
      { .x | x, .xy xy } 
    -- ${int x, [{int x, int y}] xy}
      { .x x, {.x 0, .xy | 1} {.1.y then, [.0,.1.x] EQ if}.then ^ y }
    ^
  )
  -- $[{int x, [int] y}]
;

[1,2,3] { | x, | y } ^ group

