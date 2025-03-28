import k from "./index.mjs";

[
  ["ANYTHING...", "()"],
  ["ANYTHING...", '{"ala" name, 23 age}'],
  [
    {
      year: 2002,
      age: 19,
    },
    "[.year, .age]",
  ],
  ["duplicate me", "[(), ()]"],
  ["nesting", "[[[()]]]"],
  ["nesting and accessing", "[[()]] {() nested, .0.0 val}"],
  [
    {
      test: "parse integer",
    },
    "0000",
  ],
  [
    {
      x: 3,
      y: 4,
    },
    "[.y,.x] PLUS",
  ],
].map(function ([data, script]) {
  console.log(`k_expression = '${script}';`);
  console.log(`k.run(k_expression,${JSON.stringify(data)});`);
  console.log(`// RETURNS: ${JSON.stringify(k.run(script, data))}`);
  return console.log("");
});

let k_expression =
  '{.name nom, <[.age, 18] GT "old", [.age, 12] GT "ado", "enfant"> age}';

let k_fn = k.compile(k_expression);

console.log(`var k_fn = k.compile('${k_expression}');`);

console.log("");

[
  {
    age: 23,
    name: "Emily",
  },
  {
    age: 16,
    name: "Katrina",
  },
  {
    age: 2,
    name: "Mark",
  },
].map(function (data) {
  console.log(`k_fn(${JSON.stringify(data)});`);
  console.log(`// RETURNS: ${JSON.stringify(k_fn(data))}`);
  return console.log("");
});


k_expression = "$ < < [ @int ] ints, [ @bool ] bools > list, @string None>";

k_fn = k.compile(k_expression);

console.log(`var k_fn = k.compile('${k_expression}');`);

console.log("");

[
  {
    None: "None",
  },
  {
    list: {
      ints: [],
    },
  },
  {
    list: {
      ints: [1, 2, 3],
    },
  },
  {
    list: {
      bools: [true, false],
    },
  },
  {
    list: {
      bools: [true, 0],
    },
  },
].map(function (data) {
  console.log(`k_fn(${JSON.stringify(data)});`);
  console.log(`// RETURNS: ${JSON.stringify(k_fn(data))}`);
  return console.log("");
});
