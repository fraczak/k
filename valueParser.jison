%{

import { unitCode } from "./codes.mjs";
import { patterns } from "./patterns.mjs";
import run from "./run.mjs";
import t from "./codes.mjs";

function evaluateAST(exp) {
  const ast = {
    exp, 
    defs: {
      rels:{}, 
      codes:{ [unitCode]: { code: "product", product: {} } }
    }
  };
  const annotated = annotate(ast);

  const [input,output] = annotated.rels.__main__.def.patterns.map( (pat) => 
    annotated.rels.__main__.typePatternGraph.get_pattern(pat)
  );
  return {value: run(annotated.rels.__main__.def, {}), output};
}

function annotate(ast) {
  const { defs, exp } = ast;
  
  //const { codes, representatives } = t.finalize(defs.codes);

  const representatives = t.register(defs.codes);
  const rels = {...defs.rels, "__main__": {def: exp}};

  const relAlias = patterns(representatives, rels);

 
  return {rels, representatives, relAlias};
}

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
"["                                            return 'LB';
"}"                                            return 'RC';
"]"                                            return 'RB';
","                                            return 'COMMA';
":"                                            return 'COL';
\"([^"\\]|\\(.|\n))*\"|\'([^'\\]|\\(.|\n))*\'  return 'STRING';
[a-zA-Z_][a-zA-Z0-9_?!]*                       return 'NAME';
<<EOF>>                                        return 'EOF';

/lex

%token NAME STRING
%token  LC LB RB RC COMMA COL
%token EOF

%start input_with_eof

%%

// name: NAME                              { $$ = getToken(yytext,yy,_$); };
str : STRING                            { $$ = getToken(yytext,yy,_$); $$.value = fromEscString($$.value);}
    | NAME                              { $$ = getToken(yytext,yy,_$); }
    ;
lc: LC                                  { $$ = getToken(yytext,yy,_$); };
lb: LB                                  { $$ = getToken(yytext,yy,_$); };
rc: RC                                  { $$ = getToken(yytext,yy,_$); };
rb: RB                                  { $$ = getToken(yytext,yy,_$); };
comma: COMMA                            { $$ = getToken(yytext,yy,_$); };
col: COL                                { $$ = getToken(yytext,yy,_$); };

input_with_eof: exp EOF               {
    return evaluateAST($1);
};

exp
    : lc labelled rc                    { $$ = {...$2, start: $1.start, end: $3.end}; }
    | lb list rb                        { $$ = {op: "vector", vector: $2, start: $1.start, end: $3.end}; }
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
    : exp_label
        { $$ = {op: "product", product: [$1]}; }
    | non_empty_labelled comma exp_label
        { $1.product = [].concat($1.product,$3); $$ = $1; }
    ;

exp_label
    : exp bits  { $$ = {label: $2.value, exp: $1}; }
    | exp str   { $$ = {label: $2.value, exp: $1}; }
    | str col exp { $$ = {label: $1.value, exp: $3}; }
    | bits col exp { $$ = {label: $1.value, exp: $3}; }
    ;

list
    : /*empty */             { $$ = []; }
    | non_empty_list         { $$ = $1; }
    ;

non_empty_list
    : exp                              { $$ = [$1]; }
    | non_empty_list comma exp  { $$ = [].concat($1,$3); }
    ;

%%
