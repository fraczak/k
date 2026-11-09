# --lib lib/bits.k --use inc:inc_bits

-- lib/list.k — Parametric linked lists (list[X])

---------------------------------------------------------------
-- §1. Base Pattern & Primitives (bits[])
---------------------------------------------------------------

bits[] = < {} _, B 0, B 1 > = B;
_      = {} |_ ?bits[];
0b     = |0 ?bits[];
c0     = _ 0b;

---------------------------------------------------------------
-- §2. Pattern & Primitive Constructors/Destructors
---------------------------------------------------------------

list[X] = < {} nil, { X car, L cdr } cons > = L;

-- Only the 5 atomic primitives mention ?list[X]
nil    = {} |nil ?list[X];
cons   = |cons ?list[X];
un_nil = ?list[X] /nil;
car    = ?list[X] /cons .car;
cdr    = ?list[X] /cons .cdr;

-- Nil guard on list[X]
nil?   = un_nil nil;

---------------------------------------------------------------
-- §3. List Operations
---------------------------------------------------------------

singleton = { () car, nil cdr } cons;

rev_append = <
  { .x un_nil if, .y then } .then,
  { .x cdr x, { .x car car, .y cdr } cons y } rev_append
>;

reverse = { () x, nil y } rev_append;
append  = { .x reverse x, .y y } rev_append;

length_loop = <
  { .x un_nil if, .acc then } .then,
  { .x cdr x, .acc inc_bits acc } length_loop
>;

list_length = { () x, c0 acc } length_loop;
