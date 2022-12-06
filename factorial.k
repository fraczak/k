-- factorial.k
-- E.g.:
--    > echo "5" | ./k.sh -k factorial.k
--    {"x":5,"x!":120}

dec = [(),1] MINUS;
factorial = <
  [1,()] GT 1,
  [dec factorial, ()] TIMES
>;
{ x: (), "x!": factorial }
