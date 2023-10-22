%{

import s from "./symbol-table.mjs";

function fromEscString(escString) {
  const isSingleQuoted = escString.startsWith("'");
  let str = escString.substring(1, escString.length - 1);
  if (isSingleQuoted) {
    str = str.replace(/\\'/g, "'");
  } else {
    str = str.replace(/\\"/g, '"');
  }
  str = str.replace(/\\\\/g, '\\');
  str = str.replace(/\\\//g, '/');
  str = str.replace(/\\b/g, '\b');
  str = str.replace(/\\f/g, '\f');
  str = str.replace(/\\n/g, '\n');
  str = str.replace(/\\r/g, '\r');
  str = str.replace(/\\t/g, '\t');
  str = str.replace(/\\u([\dA-F]{4})/gi, (match, p1) => String.fromCharCode(parseInt(p1, 16)));

  return str;
}

%}

%lex

%%
[/][*]([*][^/]|[^*])*[*][/]                    /* c-comment */
("//"|"#"|"%"|"--")[^\n]*                      /* one line comment */
\s+                                            /* blanks */
"<<"                                           return 'LAA';
"<"                                            return 'LA';
"{"                                            return 'LC';
"["                                            return 'LB';
"("                                            return 'LP';
">>"                                           return 'RAA';
">"                                            return 'RA';
"}"                                            return 'RC';
"]"                                            return 'RB';
")"                                            return 'RP';
"="                                            return 'EQ'; 
"."                                            return 'DOT';
","                                            return 'COMMA';
";"                                            return 'SC';
":"                                            return 'COL';
"$"                                            return 'DOLLAR'; 
"@"                                            return 'AT';
"|"                                            return 'PIPE';
\"([^"\\]|\\(.|\n))*\"|\'([^'\\]|\\(.|\n))*\'  return 'STRING';
[a-zA-Z_][a-zA-Z0-9_?!]*                       return 'NAME';
0|[-]?[1-9][0-9]*                              return 'INT';
<<EOF>>                                        return 'EOF';

/lex

%token NAME STRING INT
%token LAA LA LC LB LP RAA RA RP RB RC EQ DOT COMMA SC COL DOLLAR PIPE AT
%token EOF

%start input_with_eof

%%

name: NAME                              { $$ = String(yytext); };
str: STRING                             { $$ = fromEscString(String(yytext)); };
int: INT                                { $$ = parseInt(String(yytext)); };

input_with_eof: defs comp EOF               {
    const result = {defs: {rels: s.rels, codes: s.codes}, exp: $2};
    // console.log(JSON.stringify(result, "", 2));
    return result;
};

defs:                                   {  }
    | defs name EQ comp SC              { s.add_rel($2,$4); }
    | defs DOLLAR name EQ codeDef SC    { s.add_code($3,$5); }
    ;

code
    : name                              { $$ = {code: "ref", ref: $1}; }
    | codeDef                           { $$ = $1; }
    ;

codeDef
    : LC labelled_codes RC              { $$ = {code: "product", product: $2}; }
    | LB code RB                        { $$ = {code: "vector", vector: s.as_ref($2)}; }
    | LA labelled_codes RA              { $$ = {code: "union", union: $2}; }
    | LAA code RAA                      { $$ = {code: "set", set: s.as_ref($2)}; }
    ;

labelled_codes 
    :                                   { $$ = {} }
    | non_empty_labelled_codes          { $$ = $1.reduce((r, lc) => { 
                                                  r[lc.label] = s.as_ref(lc.code);
                                                  return r }
                                                , {}); }
    ;

non_empty_labelled_codes
    : code_label                        { $$ = [$1]; }
    | non_empty_labelled_codes COMMA code_label
                                        { $$ = [].concat($1,$3); }
    ;

code_label 
    : code name                         { $$ = {label: $2, code: $1}; }
    | code str                          { $$ = {label: $2, code: $1}; }
    | code int                          { $$ = {label: $2, code: $1}; }
    | name COL code                     { $$ = {label: $1, code: $3}; }
    | str COL code                      { $$ = {label: $1, code: $3}; }
    | int COL code                      { $$ = {label: $1, code: $3}; }
    ;

comp 
    : exp                               { $$ = $1; }
    | comp exp                          { $$ = s.comp($1, $2); }
    ;

exp
    : LC labelled RC                    { $$ = $2; }
    | LB list RB                        { $$ = {op: "vector", vector: $2}; }
    | LA list RA                        { $$ = s.union($2); }
    | LAA list RAA                       { $$ = {op: "set", set: $2}; }
    | name                              { $$ = {op: "ref", ref: $1}; }
    | LP RP                             { $$ = s.identity;  }
    | LP comp RP                        { $$ = $2;  }
    | str                               { $$ = {op: "str", str: $1}; }
    | int                               { $$ = {op: "int", int: $1}; }
    | DOT int                           { $$ = {op: "dot", dot: $2}; }
    | DOT str                           { $$ = {op: "dot", dot: $2}; }
    | DOT name                          { $$ = {op: "dot", dot: $2}; }
    | DOLLAR code                       { $$ = {op: "code", code: s.as_ref($2)}; }
    | PIPE                              { $$ = {op: "pipe"}; }
    | AT                                { $$ = {op: "aggregate"}; }
    ;

labelled
    :                                   { $$ = {op: "product", product: []}; }
    | non_empty_labelled                { $$ = $1; }
    ;

non_empty_labelled
    : comp_label
        { $$ = {op: "product", product: [$1]}; }
    | non_empty_labelled COMMA comp_label
        { $1.product = [].concat($1.product,$3); $$ = $1; }
    ;

comp_label
    : comp name  { $$ = {label: $2, exp: $1}; }
    | comp str   { $$ = {label: $2, exp: $1}; }
    | comp int   { $$ = {label: $2, exp: $1}; }
    | name COL comp { $$ = {label: $1, exp: $3}; }
    | str COL comp { $$ = {label: $1, exp: $3}; }
    | int COL comp { $$ = {label: $1, exp: $3}; }
    ;

list
    : /*empty */             { $$ = []; }
    | non_empty_list         { $$ = $1; }
    ;

non_empty_list
    : comp                              { $$ = [$1]; }
    | non_empty_list COMMA comp  { $$ = [].concat($1,$3); }
    ;

%%
