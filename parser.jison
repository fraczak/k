%{

import { SymbolTable, comp, union, identity } from "./symbol-table.mjs";
let s = new SymbolTable();

function anError(pos,msg) {
    throw new Error(`Parse Error (lines ${pos.first_line}:${pos.first_column}...${pos.last_line}:${pos.last_column}): ${msg}`);
}

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
[/][*]([^*]*[*]+[^*/])*[^*]*[*]+[/]             /* c-comment */
("//"|"#"|"%"|"--"|"\\")[^\n]*                  /* one line comment */
\s+                                             /* blanks */
"<"                                            return 'LA';
"{"                                            return 'LC';
"("                                            return 'LP';
">"                                            return 'RA';
"}"                                            return 'RC';
")"                                            return 'RP';
"="                                            return 'EQ'; 
"..."                                          return 'DOTS';
"."                                            return 'DOT';
","                                            return 'COMMA';
";"                                            return 'SC';
":"                                            return 'COL';
"$"                                            return 'DOLLAR'; 
"?"                                            return 'QMARK';
"@"                                            return 'AT';
\"([^"\\]|\\(.|\n))*\"|\'([^'\\]|\\(.|\n))*\'  return 'STRING';
[a-zA-Z0-9_][a-zA-Z0-9_?!]*                    return 'NAME';

"~"                                            return 'INCREMENTAL';
<<EOF>>                                        return 'EOF';

/lex

%token NAME STRING
%token LA LC LP RA RP RC EQ DOT COMMA SC COL DOLLAR AT QMARK DOTS
%token INCREMENTAL
%token EOF

%start input_with_eof

%%

str : STRING                            { $$ = getToken(yytext,yy,_$); $$.value = fromEscString($$.value);};
name: NAME                              { $$ = getToken(yytext,yy,_$); };
la: LA                                  { $$ = getToken(yytext,yy,_$); };
lc: LC                                  { $$ = getToken(yytext,yy,_$); };
lp: LP                                  { $$ = getToken(yytext,yy,_$); };
ra: RA                                  { $$ = getToken(yytext,yy,_$); };
rc: RC                                  { $$ = getToken(yytext,yy,_$); };
rp: RP                                  { $$ = getToken(yytext,yy,_$); };
eq: EQ                                  { $$ = getToken(yytext,yy,_$); };
dots: DOTS                              { $$ = getToken(yytext,yy,_$); };
dot: DOT                                { $$ = getToken(yytext,yy,_$); };
comma: COMMA                            { $$ = getToken(yytext,yy,_$); };
sc: SC                                  { $$ = getToken(yytext,yy,_$); };
col: COL                                { $$ = getToken(yytext,yy,_$); };
dollar: DOLLAR                          { $$ = getToken(yytext,yy,_$); };
qmark: QMARK                            { $$ = getToken(yytext,yy,_$); };
incremental: INCREMENTAL                { $$ = getToken(yytext,yy,_$); };

input_with_eof: initialize_symbol_table defs comp EOF               {
    const result = {defs: {rels: s.rels, codes: s.codes}, exp: $3};
    // console.log(JSON.stringify(result, "", 2));
    // process.exit(0);
    return result;
};

initialize_symbol_table
    :                                   { s = new SymbolTable();}
    | incremental                       {  }
    ;

defs:                                   {  }
    | defs name eq comp sc              { s.add_rel($2.value,$4); }
    | defs dollar name eq codeDef SC    { s.add_code($3.value,$5); }
    ;

code
    : name                              { $$ = { code: "ref", ref: $1.value, start: $1.start, end: $1.end}; }
    | AT name                           { $$ = { code: "ref", ref: "@" + $2.value, start: $1.start, end: $2.end}; }
    | codeDef                           { $$ = $1; }
    ;

codeDef
    : lc labelled_codes rc              { if (Object.keys($2).length == 1)
                                            $$ = { code: "union", union: $2, start: $1.start, end: $3.end };
                                          else
                                            $$ = { code: "product", product: $2, start: $1.start, end: $3.end }; }
    | la labelled_codes ra              { $$ = { code: "union", union: $2, start: $1.start, end: $3.end }; }
    ;

labelled_codes 
    :                                   { $$ = {}; }
    | non_empty_labelled_codes          { $$ = $1.reduce((r, lc) => { 
                                            if (r[lc.label])
                                                anError(@0,`Duplicate label '${lc.label}'.`);
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
    | name col code                     { $$ = {label: $1.value, code: $3}; }
    | str col code                      { $$ = {label: $1.value, code: $3}; }
    ;

filter_
    : dollar code                 { $$ = { type: "code", code: s.as_ref($2), start: $1.start, end: $2.end}; }
    | lp labelled_filters      rp { if ( !$2.open && (Object.keys($2.fields).length == 1))
                                      $$ = { type: "union", open: $2.open, fields: $2.fields, start: $1.start, end: $3.end};
                                    else 
                                      $$ = { type: null, open: $2.open, fields: $2.fields, start: $1.start, end: $3.end}; }
    | la labelled_filters      ra { $$ = { type: "union", open: $2.open, fields: $2.fields, start: $1.start, end: $3.end}; }
    | lc labelled_filters      rc { if ( !$2.open && (Object.keys($2.fields).length == 1))
                                      $$ = { type: "union", open: $2.open, fields: $2.fields, start: $1.start, end: $3.end};
                                    else 
                                      $$ = { type: "product", open: $2.open, fields: $2.fields, start: $1.start, end: $3.end}; }
    ;

filter
    : filter_                      { $$ = $1; }
    | filter_ EQ name              { $$ = { name: $3.value, ...$1, start: $1.start, end: $3.end }; }
    | name                         { $$ = { type: 'name', name: $1.value, open: true, start: $1.start, end: $1.end}; }
    ;
labelled_filters
    :                                   { $$ = { fields: {}}; }
    | non_empty_labelled_filters        { $$ = $1.reduce((r, lc) => {
                                                  if (lc.dots) {
                                                    r.open = true;
                                                  } else {
                                                    if (r.fields[lc.label])
                                                      anError(@0,`Duplicate label '${lc.label}'.`);
                                                    r.fields[lc.label] = lc.filter;
                                                  }
                                                  return r }
                                                , { fields: {} }); }
    ;

non_empty_labelled_filters
    : filter_label                      { $$ = [$1]; }
    | non_empty_labelled_filters comma filter_label
                                        { $$ = [].concat($1,$3); }
    ;

filter_label
    : dots                              { $$ = {dots: true }; }
    | filter name                       { $$ = {label: $2.value, filter: $1}; }
    | filter str                        { $$ = {label: $2.value, filter: $1}; }
    | name col filter                   { $$ = {label: $1.value, filter: $3}; }
    | str col filter                    { $$ = {label: $1.value, filter: $3}; }
    ;

comp 
    : exp                               { $$ = $1; }
    | comp exp                          { $$ = {...comp($1, $2), start: $1.start, end:$2.end}; }
    ;

exp
    : lc labelled rc                    { $$ = {...$2, start: $1.start, end: $3.end}; }
    | la list ra                        { $$ = {...union($2), start: $1.start, end: $3.end}; }
    | AT name                           { $$ = {op: "ref", ref: "@" + $2.value, start: $1.start, end: $2.end}; }
    | lp rp                             { $$ = {...identity, start: $1.start, end: $2.end};  }
    | lp comp rp                        { $$ = {...$2, start: $1.start, end: $3.end };  }
    | name                              { $$ = {op: "ref", ref: $1.value, start: $1.start, end: $1.end}; }
    | dot name                          { $$ = {op: "dot", dot: $2.value, start: $1.start, end: $2.end }; }
    | dot str                           { $$ = {op: "dot", dot: $2.value, start: $1.start, end: $2.end }; }
    | dollar code                       { $$ = {op: "code", code: s.as_ref($2), start: $1.start, end: $2.end}; }
    | qmark filter                      { $$ = {op: "filter", filter: $2, start: $1.start, end:$2.end}; }
    ;

labelled
    :                                   { $$ = {op: "product", product: []}; }
    | non_empty_labelled                { $1.product.reduce( (labels, {label}) =>
                                            { if (labels[label]) 
                                                anError(@0,`Duplicate label '${label}'.`)
                                              labels[label] = true;
                                              return labels; }, {});
                                          $$ = $1; }
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
    | name col comp { $$ = {label: $1.value, exp: $3}; }
    | str col comp { $$ = {label: $1.value, exp: $3}; }
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
