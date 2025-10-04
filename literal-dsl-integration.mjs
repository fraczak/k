// Literal Notation DSL Integration for K Language
// This file shows how to extend the k language parser and compiler to support literal notation DSL

import { SymbolTable } from "./symbol-table.mjs";

// Enhanced lexer with dynamic literal support
class DynamicLexer {
  constructor() {
    this.literalDefinitions = new Map();
    this.compiledPatterns = [];
  }

  // Register a new literal definition
  addLiteralDefinition(typeName, definition) {
    this.literalDefinitions.set(typeName, definition);
    this.recompilePatterns();
  }

  // Recompile all literal patterns into lexer rules
  recompilePatterns() {
    this.compiledPatterns = [];
    
    for (const [typeName, def] of this.literalDefinitions) {
      def.patterns.forEach((pattern, index) => {
        this.compiledPatterns.push({
          pattern: new RegExp(pattern),
          typeName,
          parserIndex: index,
          priority: this.calculatePriority(pattern)
        });
      });
    }

    // Sort by priority (more specific patterns first)
    this.compiledPatterns.sort((a, b) => b.priority - a.priority);
  }

  // Calculate pattern priority (longer, more specific patterns have higher priority)
  calculatePriority(pattern) {
    let priority = pattern.length;
    
    // Boost priority for more specific patterns
    if (pattern.includes('^') && pattern.includes('$')) priority += 100;
    if (pattern.includes('\\d+')) priority += 10;
    if (pattern.includes('[')) priority += 5;
    
    return priority;
  }

  // Try to match input against literal patterns
  matchLiteral(input, position) {
    const remaining = input.slice(position);
    
    for (const compiled of this.compiledPatterns) {
      const match = remaining.match(compiled.pattern);
      if (match && match.index === 0) {
        return {
          type: 'LITERAL',
          value: match[0],
          typeName: compiled.typeName,
          parserIndex: compiled.parserIndex,
          length: match[0].length
        };
      }
    }
    
    return null;
  }
}

// Enhanced parser grammar (extends parser.jison)
const literalGrammarExtension = `
// Add to lexer rules
literal_def: AT NAME code pattern_list parser_list formatter SC
  {
    const def = {
      typeName: $2.value,
      targetCode: $3,
      patterns: $4,
      parsers: $5,
      formatter: $6
    };
    
    // Register with dynamic lexer
    yy.lexer.addLiteralDefinition(def.typeName, def);
    
    // Add to symbol table
    s.addLiteralDefinition(def);
    
    $$ = def;
  }
;

// Add to expression rules  
exp: LITERAL
  {
    const literalDef = yy.lexer.getLiteralDefinition($1.typeName);
    const parser = literalDef.parsers[$1.parserIndex];
    
    $$ = {
      op: "literal",
      literalType: $1.typeName,
      literalValue: $1.value,
      parser: parser,
      start: $1.start,
      end: $1.end
    };
  }
;

pattern_list
  : string_literal { $$ = [$1]; }
  | pattern_list comma string_literal { $$ = [...$1, $3]; }
  ;

parser_list  
  : comp { $$ = [$1]; }
  | parser_list comma comp { $$ = [...$1, $3]; }
  ;
`;

// Enhanced symbol table with literal support
class EnhancedSymbolTable extends SymbolTable {
  constructor() {
    super();
    this.literalDefinitions = new Map();
  }

  addLiteralDefinition(def) {
    this.literalDefinitions.set(def.typeName, def);
  }

  getLiteralDefinition(typeName) {
    return this.literalDefinitions.get(typeName);
  }

  getAllLiteralDefinitions() {
    return Array.from(this.literalDefinitions.values());
  }
}

// Enhanced compiler with literal support
class LiteralAwareCompiler {
  constructor() {
    this.symbolTable = new EnhancedSymbolTable();
    this.literalParsers = new Map();
  }

  // Compile a literal expression
  compileLiteral(literalNode) {
    const def = this.symbolTable.getLiteralDefinition(literalNode.literalType);
    if (!def) {
      throw new Error(`Unknown literal type: ${literalNode.literalType}`);
    }

    const parserIndex = this.findParserIndex(literalNode.literalValue, def.patterns);
    const parser = def.parsers[parserIndex];
    
    // Generate code that applies the parser to the literal value
    return {
      type: 'literal_application',
      parser: this.compileExpression(parser),
      value: literalNode.literalValue,
      targetType: def.targetCode
    };
  }

  findParserIndex(value, patterns) {
    for (let i = 0; i < patterns.length; i++) {
      const regex = new RegExp(patterns[i]);
      if (regex.test(value)) {
        return i;
      }
    }
    throw new Error(`No matching pattern found for literal value: ${value}`);
  }

  // Enhanced expression compilation
  compileExpression(expr) {
    switch (expr.op) {
      case 'literal':
        return this.compileLiteral(expr);
      
      case 'ref':
        // Check if this is a literal definition
        const literalDef = this.symbolTable.getLiteralDefinition(expr.ref);
        if (literalDef) {
          return this.compileLiteralType(literalDef);
        }
        return super.compileExpression(expr);
      
      default:
        return super.compileExpression(expr);
    }
  }
}

// Runtime support for literals
class LiteralRuntime {
  constructor() {
    this.cache = new Map();
  }

  // Parse a literal value using the appropriate parser
  parseLiteral(value, parser, targetType) {
    const cacheKey = `${value}:${targetType}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Apply the parser function to the string value
    const stringValue = this.createStringValue(value);
    const result = parser(stringValue);
    
    this.cache.set(cacheKey, result);
    return result;
  }

  createStringValue(str) {
    // Convert JavaScript string to k language @string representation
    return {
      type: '@string',
      value: str
    };
  }

  // Format a value back to its literal representation
  formatLiteral(value, formatter) {
    return formatter(value);
  }
}

// Integration example: Enhanced k language runner
class EnhancedKRunner {
  constructor() {
    this.compiler = new LiteralAwareCompiler();
    this.runtime = new LiteralRuntime();
    this.lexer = new DynamicLexer();
  }

  // Load literal definitions from a k program
  loadLiteralDefinitions(program) {
    const ast = this.parse(program);
    
    // Extract literal definitions
    for (const def of ast.defs.literals || []) {
      this.lexer.addLiteralDefinition(def.typeName, def);
      this.compiler.symbolTable.addLiteralDefinition(def);
    }
  }

  // Enhanced parsing with literal support
  parse(input) {
    // Use enhanced parser with literal support
    return parseWithLiterals(input, {
      lexer: this.lexer,
      symbolTable: this.compiler.symbolTable
    });
  }

  // Run a k expression with literal support
  run(expression, data) {
    // Load any literal definitions first
    this.loadLiteralDefinitions(expression);
    
    // Compile with literal support
    const compiled = this.compiler.compile(expression);
    
    // Execute with runtime literal support
    return this.executeWithLiterals(compiled, data);
  }

  executeWithLiterals(compiled, data) {
    // Execute the compiled expression, handling literals specially
    return this.execute(compiled, data, {
      literalRuntime: this.runtime
    });
  }
}

// Usage example
const enhancedK = new EnhancedKRunner();

// Example program with literal notation
const programWithLiterals = `
  $ bnat = < {} _, bnat 0, bnat 1 >;
  
  @literal bnat "\\\\d+" parse_decimal format_decimal;
  
  parse_decimal = $@string parse_decimal_implementation;
  format_decimal = $bnat format_decimal_implementation;
  
  // Now we can use decimal literals directly:
  ten = 10;
  twenty = 20;
  thirty = {10 x, 20 y} plus;
  
  thirty
`;

// This would now work:
// const result = enhancedK.run(programWithLiterals, {});
// console.log(result); // Should output the bnat representation of 30

export {
  DynamicLexer,
  EnhancedSymbolTable,
  LiteralAwareCompiler,
  LiteralRuntime,
  EnhancedKRunner,
  literalGrammarExtension
};