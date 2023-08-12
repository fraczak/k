-- factorial.k
-- E.g.:
--    > echo "5" | ./k.sh -k factorial.k
--    {"x":5,"x!":120}

dec = [$int,-1] PLUS;
zero? = $int.0 0;
factorial = <
  zero? 1, 
  [dec factorial, ()] TIMES
>;
{ () x, factorial "x!" }
