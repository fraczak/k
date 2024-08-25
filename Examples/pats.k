xy = .x y;
y = .y;
$ya = < {} y, {} a >;
$yb = < {} y, {} b >;
$one = {ya x, {} ya};
$two = {yb x, {} yb};
$input = {one one, two two};


// {
//     "one":{"x":{"y":{}},"ya":{}}, 
//     "two":{"x":{"y":{}},"yb":{}}
// }
$input {.one xy one, .two xy two}
