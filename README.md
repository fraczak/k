# k-language 

Another JSON transformation notation.  A `k`-expression
(script) defines a __partial function__, i.e., a function which, in
general, is not defined for every input. `k`-expressions can be
combined to build other `k`-expressions in three ways:

1. composition, e.g.:
   
        (E1 E2 E3 ...)
	
	Apart from empty composition, `()`, which defines _identity_, the paranthesis can be omitted.

2. product, e.g., vector or structure:

        [ E1, E2, E3, ... ]
        { E1 "e1", E2 "e2", E3 "e3", ... }

  Now, structure can also be written similarly to JSON, ie., 
  
		{ e1: E1, e2: E2, e3: E3, ... }

3. union (merge), e.g.:

        < E1, E2, E3, ... >
		
Elementary partial functions are: 

1.  _projection_, i.e., extracting the value of a given field or
	index. Examples:
	
		.x
		."field name"
		.4
	
	The function is defined only if its argument is a structure with
	the field (or a vector with the index).
   
2. _constants_, literals for Strings, Booleans, and
   Integers. Examples:
   
		"a string"
		'another "String"'
		123
		false
		null
	
3.  There is a number of built-in functions: `GT`, `EQ`, `PLUS`,
	`TIMES`, `MINUS`, `DIV`, `CONCAT`, `toJSON`, `fromJSON`, `CONS`, `SNOC`. For example
	
		[1, 2, 3] PLUS       --> integer constant function 6
		[4, 4] TIMES toJSON  --> string constant function "16"
		[3, 2] GT            --> vector constant function [3, 2]
		[3, 4] GT            --> is not defined!
		
	A more interesting example could be:
	
		< [.0, .1] GT, [.1, .0] GT > .0
		
	which selects the bigger of two first integers of a vector argument, i.e.,
	
		[3,8] < [.0, .1] GT, [.1, .0] GT > .0    --> 8

## User defined functions

`k`-expression can be prefixed by function definitions. E.g.: 

	dec = [(),1] MINUS;
	factorial = <
	  [1,()] GT 1,
	  [dec factorial, ()] TIMES
	>;
	{ () x, factorial "x!" }

## Value encodings (also called _types_ or _codes_)

There are three predefined value encodings: `int`, `string`, and `bool`. The language
supports `code`-expressions:

* product, e.g., `{int x, int y, bool flag}` (in JSON-like syntax `{x: int, y: int, flag: bool}`)
* disjoint union, e.g., `<{} true, {} false>` (in JSON-like syntax `<true: {}, false: {}>`)
* vector, e.g., `[ int ]` (all elements of the vector use the same encoding)

One can define recursive codes. E.g.:

	$ tree = <string leaf, {tree left, tree right} tree>;

or, the same in JSON-like notation:

	$ tree = <leaf: string, tree: {left: tree, right: tree}>;

Each _code_ definition starts with a `$`.
The above example defines new code called _tree_.

The code can be then used in a `k`-expression as a filter. A `code`-expression
within `k`-expression is again prefixed by `$`.

	$tree = <string leaf, {tree left, tree right} tree>;
	inc = [(),1] PLUS;
	height = $ tree <
		.leaf 0,
		.tree [.left height, .right height] <GT .0, .1> inc
	> $ int;
	height


## Command line script

There is a wrapper, `./node_modules/.bin/k` , which makes it easy to
run the language from command line.

    $ ./node_modules/.bin/k
	... errors ...
	Usage: ./node_modules/.bin/k ( k-expr | -k k-file) [ -1 ] [ json-file ]
	       E.g., cat '{"a": 10}' | ./node_modules/.bin/k '[(),()]'

### Examples

1. One `k`-expression with one `json`-object:

		$ echo '{"x": 12, "y": 13}' | ./k.coffee '{ <.x, "no x"> x, () input}' 
		{"x":12,"input":{"x":12,"y":13}}
	
2. By providing only `k`-expression, the script will compile the
   `k`-expression and apply the generated function to the `stdin`, line by line:

		$ ./k.coffee '<["x=",.x," & y=",.y],["only x=",.x],["only y=",.y],["no x nor y"]>{CONCAT "x&y"}' 
		
		{"y": 123, "x": 432,"others": "..."}  --> {"x&y":"x=432 & y=123"} 
		{"x":987}                             --> {"x&y":"only x=987"} 
		{"z":123}                             --> {"x&y":"no x nor y"}
		^D - to interrupt

3. If the `k`-expression is long, it can be put in a file, e.g.:

		$ cat test.k
		 ---------  comments start by #, --, or // ----------------------------------
		 <                          -- merge of 4 partial functions...
		   ["x=", .x, " & y=", .y], -- produces a vector of 4 values, if fields 'x' and 'y' are present
		   ["only x=", .x],         -- produces a pair '["only x=", "value-of-x"]', for input like {"x":"value-of-x"}
									-- it is defined only if field 'x' is present
		   ["only y=", .y],
		   ["no x nor y"]           -- defined for all input, returns always the same one element vector
		 > 
		 -- one of the string vectors is passed to the following partial function, 
		 -- which produces a record (map) with one field "x&y", whose value is the
		 -- result of concatenating elements of the passed in vector
		 { CONCAT "x&y" } 
		 ------------------------------------------------------------------------------
		 
	We can use it by:
	
		$ ./k.coffee -k test.k
	
	If we want to read `json` objects from a file, e.g., `my-objects.json`, we do
	
		$ ./k.coffee -k test.k my-objects.json
		{"x&y":"x=432 & y=123"} 
		{"x&y":"onlyx=987"} 
		{"x&y":"no x nor y"}
	
	where:
	
		$ cat my-objects.json 
		 ####################################################
		 # empty lines and lines starting with # are ignored
		 {"y": 123, "x": 432,"others": "..."}
		 {"x":987}
		 {"z":123}
		 ####################################################
		
# Using from `javascript`
    
    var k = require("k");

    var k_expression;

    k_expression = '()';
    k.run(t_expression,"ANYTHING...");
    // RETURNS: "ANYTHING..."

    k_expression = '{"ala" name, 23 age}';
    k.run(k_expression,"ANYTHING...");
    // RETURNS: {"name":"ala","age":23}

    k_expression = '[.year, .age]';
    k.run(k_expression,{"year":2002,"age":19});
    // RETURNS: [2002,19]

    k_expression = '[(), ()]';
    k.run(k_expression,"duplicate me");
    // RETURNS: ["duplicate me","duplicate me"]

    k_expression = '[[[()]]]';
    k.run(k_expression,"nesting");
    // RETURNS: [[["nesting"]]]

    k_expression = '[[()]] {() nested, .0.0 val}';
    k.run(k_expression,"nesting and accessing")
    // RETURNS: {"nested":[["nesting and accessing"]],"val":"nesting and accessing"}

    k_expression = '0000';
    k.run(k_expression,{"test":"parse integer"});
    // RETURNS: 0

    k_expression = '[.y,.x] PLUS';
    k.run(k_expression,{"x":3,"y":4});
    // RETURNS: 7

    k_expression = '{.name nom, <[.age, 18] GT .0, [.age, 12] GT "ado", "enfant"> age}';

    var k_fn = k.compile(k_expression);

    k_fn({"age":23,"name":"Emily"});
    // RETURNS: {"nom":"Emily","age":23}

    k_fn({"age":16,"name":"Katrina"});
    // RETURNS: {"nom":"Katrina","age":"ado"}

    k_fn({"age":2,"name":"Mark"})
    // RETURNS: {"nom":"Mark","age":"enfant"}
