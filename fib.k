fib_aux =
  <
    { [.n, 1] GT [.0,-1] PLUS n,
      ."[fib(n),fib(n-1)" [[.0,.1] PLUS, .0] "[fib(n),fib(n-1)"
    } fib_aux,
    ."[fib(n),fib(n-1)"
  >
;

fib = {() n, [1,1] "[fib(n),fib(n-1)"}
  fib_aux .0;

----------------------

fib
