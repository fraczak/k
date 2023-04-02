import k from "./index.mjs";
import functors from "functors";
const { map, compose, delay, product } = functors;
const id = delay(x=>x);


product( [
  ["ANYTHING...", "()"],
  ["ANYTHING...", '{"ala" name, 23 age}'],
  [{year: 2002,age: 19,},"[.year, .age]",],
  ["duplicate me", "[(), ()]"],
  ["nesting", "[[[()]]]"],
  ["nesting and accessing", "[[()]] {() nested, .0.0 val}"],
  [{ test: "parse integer",}, "0000",],
  [{x: 3,y: 4,},"[.y,.x] PLUS",],
].map(([data, script]) => 
    compose(delay(()=>[[data,script],"token"]), product(id,k.compile(script)))
  )) ("token", (err, res) => 
  res.map( (dd) => {
    const [[data, script], res] = dd;
    console.log(`k_expression = '${script}';`);
    console.log(`k.run(k_expression,${JSON.stringify(data)});`);
    console.log(`// RETURNS: ${JSON.stringify(res)}`);
    console.log("");
}));

let k_expression =
  '{.name nom, <[.age, 18] GT .0, [.age, 12] GT "ado", "enfant"> age}';

let k_fn = k.compile(k_expression);

console.log(`var k_fn = k.compile('${k_expression}');`);

console.log("");

map( product(id,k_fn) )([
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
], (err, res)  =>
  res.map( ([data, res]) => {
    console.log(`k_fn(${JSON.stringify(data)});`);
    console.log(`// RETURNS: ${JSON.stringify(res)}`);
}));

k_expression = "$t = < i: int, t: [ t ] > ; <$t, $int>";

k_fn = k.compile(k_expression);

console.log(`var k_fn = k.compile('${k_expression}');`);

console.log("");

map ( compose(delay(x => [x, x]), product(id, k_fn))) (
[
  1,
  {i: 1,},
  [{ i: 2}, { i: 3}, { t: []}],  
  {t: [{  i: 2}, { i: 3}, { t: []}]}
], (err, res) => 
  res.map( ([data, res]) => {
    console.log(`k_fn(${JSON.stringify(data)});`);
    console.log(`// RETURNS: ${JSON.stringify(res)}`);
}));

k_expression = "$ < < [ int ] ints, [ bool ] bools > list, string None>";

k_fn = k.compile(k_expression);

console.log(`var k_fn = k.compile('${k_expression}');`);

console.log("");

map ( product(id, k_fn)) ([
  {None: "None",},
  {list: {ints: [],},},
  {list: {ints: [1, 2, 3],},},
  {list: {bools: [true, false],},},
  {list: {bools: [true, 0],},},
], (err, res) =>
  res.map( ([data, res]) => {
  console.log(`k_fn(${JSON.stringify(data)});`);
  console.log(`// RETURNS: ${JSON.stringify(res)}`);
}));
