-- Examples/byte.k: Byte and 7-bit ASCII representation

0 = {} | 0;
1 = {} | 1;

bit[] = < {} 0, {} 1 >;

byte[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6, bit[] 7
};

ascii[] = {
  bit[] 0, bit[] 1, bit[] 2, bit[] 3,
  bit[] 4, bit[] 5, bit[] 6
};

_ = { 1 6, 0 5, 1 4, 1 3, 1 2, 1 1, 1 0 };
map = <
  /ascii <
    { .6/1 6, .5/1 5, .4/1 4, .3/1 3, .2/1 2, .1/1 1, .0/1 0 } _,
    { { .6/0 6, .5/1 5 } if, () then } .then,
    { .6/1 if, () then } .then
  >,
  _
> | ascii;

list[X] = < {} nil, { X car, Y cdr } cons > = Y;

filter = ? list[X] <
  /cons { .car map car, .cdr filter cdr } | cons,
  () 
>;

filter
