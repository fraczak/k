inc = [(),1] PLUS;
fib =
$ { int target, int x, int "fib(x-1)", int "fib(x)" }
  _log!
  <
    {[.target,.x]GT.0 target ,
     .x inc x ,
     ."fib(x)" "fib(x-1)",
     [."fib(x)",."fib(x-1)"]PLUS "fib(x)"}
    fib,
    
    {[.target,.x] EQ, ."fib(x)" result}
    .result
  >
$ int;

{() target, 0 x, 0 "fib(x-1)", 1 "fib(x)"} fib
