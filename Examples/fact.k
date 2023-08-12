dec = [$int,1] MINUS;
factorial = <
  $int.1 1,
  [$int,0] GT .0 [dec factorial, ()] TIMES
>;

{ $int x, < factorial, "not defined" > "x!" }
