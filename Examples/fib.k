pos? = [$int, 0] GT .0;
dec = [$int, -1] PLUS;
fib_aux =
  <
    { .n pos? dec n,
      ."fib(n),fib(n-1),..." {[.0,.1] PLUS 0, () 1} CONS "fib(n),fib(n-1),..."
    } fib_aux,
    ."fib(n),fib(n-1),..."
  >
;

fib = {$int n, [1,0] "fib(n),fib(n-1),..."}
  fib_aux _log! .0;

----------------------

fib
