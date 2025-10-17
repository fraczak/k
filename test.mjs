import k from "./index.mjs";

[
  [{"unit": {}}, "()"],
  [{"name": {"ala": {}}, "age": {"twentythree": {}}}, '{.name name, .age age}'],
  [
    {
      "year": {"twothousandtwo": {}},
      "age": {"nineteen": {}},
    },
    "{.year year, .age age}",
  ],
  [{"duplicate": {}}, "()"],
  [{"nesting": {}}, "()"],
  [{"test": {"parseunit": {}}}, "()"],
].map(function ([data, script]) {
  console.log(`k_expression = '${script}';`);
  console.log(`k.run(k_expression,data});`);
  console.log(`// RETURNS: ${JSON.stringify(k.run(script, data))}`);
  return console.log("");
});


let k_expression = `
  $ bool = < {} true, {} false >;
  true = {{} true} $bool;
  false = {{} false} $bool;
  
  list? = ?< {} nil, {X car, Y cdr} cons > = Y;
  nil = {{} nil} list?;
  nil? = list? .nil nil;
  car = list? .cons .car;
  list? { 
    < nil? true, false > nil_test,
    < car, {{} none} >  car 
  }
  `
  ;

let k_fn = k.compile(k_expression);

console.log(`var k_fn = k.compile('${k_expression}');`);

console.log("");

[
  {"None": {}},
  {"nil": {}},
  {
    "cons": {
      "car": {"unit": {}},
      "cdr": {
        "cons": {
          "car": {"unit": {}},
          "cdr": {"nil": {}}
        }
      }
    },
  },
  {
    "cons": {
      "car": {"on": {}},
      "cdr": {
        "cons": {
          "car": {"off": {}},
          "cdr": {"nil": {}}
        
        }
      }
    },
  },
].map(function (data) {
  console.log(`k_fn(${JSON.stringify(data)});`);
  console.log(`// RETURNS: ${JSON.stringify(k_fn(k.fromObject(data)))}`);
  return console.log("");
});
