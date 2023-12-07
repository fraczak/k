remove = 
-- $[ int, [int] ]
< 
    [.0, .1 SNOC] 
    { [.0,.1.1] remove r, .0 x, .1.0 y } 
    < [.r, [.x,.y] EQ].0, [.y, .r] CONS >, 
    [[],[.0,.1.0] EQ] .0, 
    .1 
>
-- $[ int ]
;

distinct = 
-- $[ int ]
< 
    SNOC [.0, [.0,.1] remove distinct] CONS, 
    () 
>
-- $[ int ]
;

group = 
-- $[{int x, int y}]
    { | .x ^ distinct x, () xy}
    { .x | x, .xy xy } { .x x, [ .x, .xy | ] [.1.y, [.0,.1.x] EQ].0 ^ y } ^
-- $[{int x, [int] y}]
;

[1,2,3] { | x, | y } ^ group

