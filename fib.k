fib1 = <
  { [.count, 1] GT [.0,-1] PLUS count,
    .fib [[.0,.1] PLUS, ()] CONS fib
  } fib1,
  .fib .0
>;

fib = {() count, [1,1] fib} fib1;

fib
