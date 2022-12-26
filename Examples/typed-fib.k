inc = [(),1] PLUS;
fib2 =
$ { int target, int x, int "fib(x)", int "fib(x-1)" }
  _log!
  <
    {[.target,.x]GT.0 target ,
     .x inc x ,
     [."fib(x)",."fib(x-1)"]PLUS "fib(x)" ,
     ."fib(x)" "fib(x-1)" }
    fib2,
    
    {[.target,.x] EQ, ."fib(x)" result}
    .result
  >
$ int;

{() target, 0 x, 1 "fib(x)", 0 "fib(x-1)"} fib2
 
    