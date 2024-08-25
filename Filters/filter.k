f1 = ?{T x, [T] y};
f2 = ?{[R] x, R y};

swap = f1 f2 {.x y, .y x};


{[] x, [[[[]]]] y} swap

-- shoud_work