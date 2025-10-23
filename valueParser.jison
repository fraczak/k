%{

import { Product, Variant } from "./Value.mjs";

//--------------------------

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
"{"                                            return 'LC';
"}"                                            return 'RC';
"["                                            return 'LB';
"]"                                            return 'RB';
","                                            return 'COMMA';
":"                                            return 'COL';
\"([^"\\]|\\(.|\n))*\"|\'([^'\\]|\\(.|\n))*\'  return 'STRING';
[a-zA-Z0-9_][a-zA-Z0-9_?!]*                    return 'NAME';
<<EOF>>                                        return 'EOF';

/lex

%token NAME STRING
%token  LC RC LB RB COMMA COL
%token EOF

%start input_with_eof

%%

str : STRING                            { $$ = getToken(yytext,yy,_$); $$.value = fromEscString($$.value);}
    | NAME                              { $$ = getToken(yytext,yy,_$); }
    ;
lc: LC                                  { $$ = getToken(yytext,yy,_$); };
rc: RC                                  { $$ = getToken(yytext,yy,_$); };
lb: LB                                  { $$ = getToken(yytext,yy,_$); };
rb: RB                                  { $$ = getToken(yytext,yy,_$); };
comma: COMMA                            { $$ = getToken(yytext,yy,_$); };
col: COL                                { $$ = getToken(yytext,yy,_$); };

input_with_eof
    : exp EOF   {
                  // console.log(`Parsed: ${$1.value.toString()}`);
                  return $1.value;
                }
    ;

exp
    : lc labelled rc                    { $$ = {value: $2.value, start: $1.start, end: $3.end}; }
    | lb exps rb                        { $$ = {value: $2.value, start: $1.start, end: $3.end}; }
    | str            { $$ = {value: new Variant($1.value, new Product({})), start: $1.start, end: $1.end}; }
    | name           { $$ = {value: new Variant($1.value, new Product({})), start: $1.start, end: $1.end}; }
    ;

exps
    : /* empty */                       { $$ = {value: new Product({})}; }
    | non_empty_exps                    {
                                          if ($1.list.length === 1) {
                                            $$ = {value: new Variant('0', $1.list[0].value)};
                                          } else {
                                            const product = {};
                                            $1.list.forEach( (e, i) => product[i] = e.value );
                                            $$ = {value: new Product(product)};
                                          };
                                        }
    ;

non_empty_exps
    : exp      { $$ = {list: [$1]} ; }
    | non_empty_exps comma exp
        { $$ = {list: [].concat($1.list,$3)}; }
    ;

labelled
    : /* empty */                       { $$ = {value: new Product({})}; }
    | non_empty_labelled                {
                                          if ($1.list.length === 1) {
                                            $$ = {value: new Variant($1.list[0].label, $1.list[0].value)};
                                          } else {
                                            const product = {};
                                            for (const {label, value} of $1.list) {
                                              if (product.hasOwnProperty(label))
                                                anError(@0,`Duplicate label '${label}'.`);
                                              product[label] = value;
                                            }
                                            $$ = {value: new Product(product)};
                                          };
                                        }
    ;

non_empty_labelled
    : exp_label
        { $$ = {list: [$1]} ; }
    | non_empty_labelled comma exp_label
        { $$ = {list: [].concat($1.list,$3)}; }
    ;

exp_label
    : exp str   { $$ = {label: $2.value, value: $1.value}; }
    | str col exp { $$ = {label: $1.value, value: $3.value}; }
    | bits col exp { $$ = {label: $1.value, value: $3.value}; }
    ;

%%
