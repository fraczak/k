dec = [$@int,-1] PLUS;
factorial = <
  $@int .1 1,
  [$@int,0] GT .0 [dec factorial, ()] TIMES
>;

{ $@int x, < factorial toJSON, "not defined" > "x!" }
