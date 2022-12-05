%{

var s = require("./symbol-table");

%}

%lex

%%
[/][*]([*][^/]|[^*])*[*][/]                    /* c-comment */
("//"|"#"|"%"|"--")[^\n]*                      /* one line comment */
\s+                                            /* blanks */
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
\"[^\"\n]*\"|\'[^\'\n]*\'                      return 'STRING'
[a-zA-Z_][a-zA-Z0-9_]*                         return 'NAME';
0|[-]?[1-9][0-9]*                              return 'INT';
<<EOF>>                                        return 'EOF';

/lex

%token NAME STRING INT
%token LA LC LB LP RA RP RB RC EQ DOT COMMA SC COL
%token EOF

%start input_with_eof

%%

name: NAME                              { $$ = String(yytext); };
str: STRING                             { $$ = String(yytext).slice(1,-1); };
int: INT                                { $$ = parseInt(String(yytext)); };

input_with_eof: defs comp EOF               {
    result = {defs: $1, exp: $2};
    // console.log(JSON.stringify(result, "", 2));
    return result;
};

defs:                                   { $$ = {};}
    | defs name EQ comp SC              { $1[$2] = $4; $$ = $1;}
    ;

comp 
    : exp          { $$ = $1; }
    | comp exp     { $$ = s.comp($1, $2); }
    ;

exp
    : LC labelled RC                    { $$ = $2; }
    | LB list RB                        { $$ = {op: "vector", vector: $2}; }
    | LA list RA                        { $$ = {op: "union", union: $2}; }
    | name                              { $$ = {op: "ref", ref: $1}; }
    | LP RP                             { $$ = s.identity;  }
    | LP comp RP                        { $$ = $2;  }
    | str                               { $$ = {op: "str", str: $1}; }
    | int                               { $$ = {op: "int", int: $1}; }
    | DOT int                           { $$ = {op: "dot", dot: $2}; }
    | DOT str                           { $$ = {op: "dot", dot: $2}; }
    | DOT name                          { $$ = {op: "dot", dot: $2}; }
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
    | name COL comp { $$ = {label: $1, exp: $3}; }
    | str COL comp { $$ = {label: $1, exp: $3}; }
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
