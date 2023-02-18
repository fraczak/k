dec = [(),1] MINUS;
factorial = <
  [(),1] EQ 1,
  [(),0] GT .0 [dec factorial, ()] TIMES
>;

{ () x, < factorial, "not defined" > "x!" }
