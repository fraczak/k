%{

import s from "./symbol-table.mjs";

function getToken(yytext,yy,lstack) {
    const yylloc = yy.lexer.yylloc;
    const loc = lstack[lstack.length - 1]; //  { first_line: 5, last_line: 5, first_column: 2, last_column: 3 };
    const start = {line: loc.first_line, column: loc.first_column + 1};
    const end = {line: start.line, column: start.column + yytext.length};
    const result = {start,end,value: String(yytext)};
    // console.log(result);
    return result;
}

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
[/][*]([*][^/]|[^*])*[*][/]                     /* c-comment */
("//"|"#"|"%"|"--")[^\n]*                       /* one line comment */
\s+                                             /* blanks */
"<"                                            return 'LA';
"{"                                            return 'LC';
"["                                            return 'LB';
"("                                            return 'LP';
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
\"([^"\\]|\\(.|\n))*\"|\'([^'\\]|\\(.|\n))*\'  return 'STRING';
[a-zA-Z_][a-zA-Z0-9_?!]*                       return 'NAME';
0|[-]?[1-9][0-9]*                              return 'INT';
<<EOF>>                                        return 'EOF';

/lex

%token NAME STRING INT
%token LA LC LB LP RA RP RB RC EQ DOT COMMA SC COL DOLLAR
%token EOF

%start input_with_eof

%%

name: NAME                              { $$ = getToken(yytext,yy,_$); };
str: STRING                             { $$ = getToken(yytext,yy,_$); $$.value = fromEscString($$.value);};
int: INT                                { $$ = getToken(yytext,yy,_$); $$.value = parseInt($$.value); };
la: LA                                  { $$ = getToken(yytext,yy,_$); };
lc: LC                                  { $$ = getToken(yytext,yy,_$); };
lb: LB                                  { $$ = getToken(yytext,yy,_$); };
lp: LP                                  { $$ = getToken(yytext,yy,_$); };
ra: RA                                  { $$ = getToken(yytext,yy,_$); };
rc: RC                                  { $$ = getToken(yytext,yy,_$); };
rb: RB                                  { $$ = getToken(yytext,yy,_$); };
rp: RP                                  { $$ = getToken(yytext,yy,_$); };
eq: EQ                                  { $$ = getToken(yytext,yy,_$); };
dot: DOT                                { $$ = getToken(yytext,yy,_$); };
comma: COMMA                            { $$ = getToken(yytext,yy,_$); };
sc: SC                                  { $$ = getToken(yytext,yy,_$); };
col: COL                                { $$ = getToken(yytext,yy,_$); };
dollar: DOLLAR                          { $$ = getToken(yytext,yy,_$); };


input_with_eof: defs comp EOF               {
    const result = {defs: {rels: s.rels, codes: s.codes}, exp: $2};
    // console.log(JSON.stringify(result, "", 2));
    return result;
};

defs:                                   {  }
    | defs name eq comp sc              { s.add_rel($2.value,$4); }
    | defs dollar name eq codeDef SC    { s.add_code($3.value,$5); }
    ;

code
    : name                              { $$ = { code: "ref", ref: $1.value, start: $1.start, end: $1.end}; }
    | codeDef                           { $$ = $1; }
    ;

codeDef
    : lc labelled_codes rc              { $$ = { code: "product", product: $2, start: $1.start, end: $3.end }; }
    | lb code rb                        { $$ = { code: "vector", vector: s.as_ref($2), start: $1.start, end: $3.end }; }
    | la labelled_codes ra              { $$ = { code: "union", union: $2, start: $1.start, end: $3.end }; }
    ;

labelled_codes 
    :                                   { $$ = {}; }
    | non_empty_labelled_codes          { $$ = $1.reduce((r, lc) => { 
                                                  r[lc.label] = s.as_ref(lc.code);
                                                  return r }
                                                , {}); }
    ;

non_empty_labelled_codes
    : code_label                        { $$ = [$1]; }
    | non_empty_labelled_codes comma code_label
                                        { $$ = [].concat($1,$3); }
    ;

code_label 
    : code name                         { $$ = {label: $2.value, code: $1}; }
    | code str                          { $$ = {label: $2.value, code: $1}; }
    | code int                          { $$ = {label: $2.value, code: $1}; }
    | name col code                     { $$ = {label: $1.value, code: $3}; }
    | str col code                      { $$ = {label: $1.value, code: $3}; }
    | int col code                      { $$ = {label: $1.value, code: $3}; }
    ;

comp 
    : exp                               { $$ = $1; }
    | comp exp                          { $$ = {...s.comp($1, $2), start: $1.start, end:$2.end}; }
    ;

exp
    : lc labelled rc                    { $$ = {...$2, start: $1.start, end: $3.end}; }
    | lb list rb                        { $$ = {op: "vector", vector: $2, start: $1.start, end: $3.end}; }
    | la list ra                        { $$ = {...s.union($2), start: $1.start, end: $3.end}; }
    | name                              { $$ = {op: "ref", ref: $1.value, start: $1.start, end: $1.end}; }
    | lp rp                             { $$ = {...s.identity, start: $1.start, end: $2.end};  }
    | lp comp rp                        { $$ = {...$2, start: $1.start, end: $3.end };  }
    | str                               { $$ = {op: "str", str: $1.value, start: $1.start, end: $1.end }; }
    | int                               { $$ = {op: "int", int: $1.value, start: $1.start, end: $1.end }; }
    | dot int                           { $$ = {op: "dot", dot: $2.value, start: $1.start, end: $2.end }; }
    | dot str                           { $$ = {op: "dot", dot: $2.value, start: $1.start, end: $2.end }; }
    | dot name                          { $$ = {op: "dot", dot: $2.value, start: $1.start, end: $2.end }; }
    | dollar code                       { $$ = {op: "code", code: s.as_ref($2), start: $1.start, end: $2.end}; }
    ;

labelled
    :                                   { $$ = {op: "product", product: []}; }
    | non_empty_labelled                { $$ = $1; }
    ;

non_empty_labelled
    : comp_label
        { $$ = {op: "product", product: [$1]}; }
    | non_empty_labelled comma comp_label
        { $1.product = [].concat($1.product,$3); $$ = $1; }
    ;

comp_label
    : comp name  { $$ = {label: $2.value, exp: $1}; }
    | comp str   { $$ = {label: $2.value, exp: $1}; }
    | comp int   { $$ = {label: $2.value, exp: $1}; }
    | name col comp { $$ = {label: $1.value, exp: $3}; }
    | str col comp { $$ = {label: $1.value, exp: $3}; }
    | int col comp { $$ = {label: $1.value, exp: $3}; }
    ;

list
    : /*empty */             { $$ = []; }
    | non_empty_list         { $$ = $1; }
    ;

non_empty_list
    : comp                              { $$ = [$1]; }
    | non_empty_list comma comp  { $$ = [].concat($1,$3); }
    ;

%%
