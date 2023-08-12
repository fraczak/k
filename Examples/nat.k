$nat = < {} 0, nat 1 >;
$pair = {nat x, nat y};

zero = {{} 0} $nat;
succ = $nat {() 1} $nat;
add = $pair <
  {.x.0 _, .y y} .y,
  {.x.1 x, .y y} add succ
>;

one = zero succ;
two = one succ;
three = two succ;
four = three succ;

toStr = $nat <
  .0 "0",
  .1 <
    .0 "1",
    .1 <
      .0 "2",
      .1 <
        .0 "3",
        .1 <
          .0 "4",
          .1 < 
            .0 "5",
            .1 <
              .0 "6",
              .1 <
                .0 "7",
                .1 <
                  .0 "8",
                  .1 <
                    .0 "9",
                    .1 ["10 + ", toStr] CONCAT
                  >
                >
              >
            >
          >
        >
      >
    >
  >
>;

add toStr
      