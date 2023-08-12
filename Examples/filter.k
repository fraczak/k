$elemType = < int a, int b, int c >;
$list = < {} nil, { elemType car, list cdr} list >;

filter_f = [.c,()].1;
filter = <
    .list <
        {{.car filter_f car, .cdr filter cdr} list},
        .cdr filter
    >,
    {.nil nil}
> ;

filter


