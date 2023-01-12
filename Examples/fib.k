pos? = [(), 0] GT .0;
dec = [(), -1] PLUS;
fib_aux =
  <
    { .n pos? dec n,
      ."fib(n),fib(n-1),..." [[.0,.1] PLUS, ()] CONS "fib(n),fib(n-1),..."
    } fib_aux,
    ."fib(n),fib(n-1),..."
  >
;

fib = {() n, [1,0] "fib(n),fib(n-1),..."}
  fib_aux _log! .0;

----------------------

fib
