$ nat = < {} zero, nat succ >;
zero = { {} zero } $nat;
zero? = $nat .zero zero;
succ = { $nat succ };
add = ${nat x, nat y} <
    {.x.succ x, .y succ y} add,
    .y
> $nat;
mult = ${nat x, nat y} <
    <.x zero?, .y zero?> zero,
    {{.x.succ x, .y y} mult x, .y y} add
> $nat;

zero?

