inc = [$@int,1] PLUS;

-- $ ffib = { @int target, @int x, @int "fib(x-1)", @int "fib(x)" }; 

ffib =
  ${ @int target, @int x, @int "fib(x-1)", @int "fib(x)" }
  _log!
  <
    {[.target,.x]GT.0 target ,
     .x inc x ,
     ."fib(x)" "fib(x-1)",
     [."fib(x)",."fib(x-1)"]PLUS "fib(x)"}
    ffib,
    
    {[.target,.x] EQ, ."fib(x)" result}
    .result
  >
$ @int;

fib = $@int {() target, 0 x, 0 "fib(x-1)", 1 "fib(x)"} ffib $@int;

5 fib
