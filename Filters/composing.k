remap = ?T {.x y} ?T ?<X z, ...>; 
swap =  ?T {.x y, .y x} ?T;

$t = <int x, int y>;

$t2 = <int x, int y, int z>;

-- {12 x} $t remap $t
-- {[1,2] x} remap
-- {"ala" x, 3 y} swap 

{
    {12 x} $t2 remap $t2 remap,
    {"ala" x, "ola" y} swap 
}