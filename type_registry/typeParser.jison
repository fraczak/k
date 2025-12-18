%{

let defs = {};
let genCount = 0;
let genNameId;
const GEN = ":";

function genName() {
  return `${GEN}${genCount++}`;
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
\s+                                            /* blanks */
"<"                                            return 'LA';
">"                                            return 'RA';
"{"                                            return 'LC';
"}"                                            return 'RC';
"="                                            return 'EQ';
","                                            return 'COMMA';
";"                                            return 'SC';
"@"                                            return 'AT';
"$"                                            return 'DOLLAR';
\"([^"\\]|\\(.|\n))*\"|\'([^'\\]|\\(.|\n))*\'  return 'STRING';
[a-zA-Z0-9_+-][a-zA-Z0-9_?!+-]*                return 'NAME';
<<EOF>>                                        return 'EOF';
.                                              return 'INVALID';

/lex

%token NAME STRING
%token LA RA LC RC EQ COMMA SC AT DOLLAR
%token EOF

%start expressions

%%

expressions
    : initialize_defs definitions EOF
        { return defs; }
    ;

initialize_defs
    : /* empty */
        { defs = {}; genCount = 0; }
    ;

definitions
    : definition
    | definitions definition
    ;

definition
    : DOLLAR name EQ LA field_list RA SC
        { defs[$2] = { code: 'union', union: $5 }; }
    | DOLLAR name EQ LC field_list RC SC
        { defs[$2] = { code: 'product', product: $5 }; }
    ;

type_expr
    : LA field_list RA
        { 
          genNameId = genName();
          defs[genNameId] = { code: 'union', union: $2 }; 
          $$ = genNameId;
        }
    | LC field_list RC
        { 
          genNameId = genName();
          defs[genNameId] = { code: 'product', product: $2 }; 
          $$ = genNameId;
        }
    | ref
        { $$ = $1; }
    ;

ref
    : name
        { $$ = $1; }
    | AT name
        { $$ = '@' + $2; }
    ;

field_list
    : /* empty */
        { $$ = {}; }
    | field
        { $$ = {}; $$[$1.label] = $1.type; }
    | field_list COMMA field
        { $$ = $1; $$[$3.label] = $3.type; }
    ;

field
    : type_expr label
        { $$ = { type: $1, label: $2 }; }
    ;

label
    : name
        { $$ = $1; }
    | str
        { $$ = $1; }
    ;

name: NAME { $$ = yytext; };
str: STRING { $$ = fromEscString(yytext); };

%%

