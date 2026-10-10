0 = {}|0;
1 = {}|1;

_ = {1 6, 0 5, 1 4, 1 3, 1 2, 1 1, 1 0};
map = <
  /ascii <
    {.6/1 6, .5/1 5, .4/1 4, .3/1 3, .2/1 2, .1/1 1, .0/1 0 } _,
    {{.6/0 6, .5/1 5} if, () then} .then,
    {.6/1 if, () then} .then
  >,
  _
> | ascii;

filter = ?< {} nil, { (...) car, S cdr } cons > = S <
  /cons {.car map car, .cdr filter cdr} | cons,
  () 
>;

filter