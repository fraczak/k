import { PatternGraph } from './PatternGraph.mjs';
import { LocalRules } from './LocalRules.mjs';
import { computeSCCs, topologicalSort } from './GraphUtils.mjs';

export class TypeDerivation {
  constructor(codeRegistry, representatives = {}, codes = null) {
    this.codeRegistry = codeRegistry;
    this.representatives = representatives;
    this.codes = codes;
  }

  derive(program) {
    // Phase 1: Initialize
    const relDefs = this.initialize(program);
    
    // Phase 2: Dependency analysis
    const sccs = this.analyzeDependencies(relDefs);
    
    // Phase 3: Fixed-point iteration
    this.iterateToFixedPoint(relDefs, sccs);
    
    return relDefs;
  }

  initialize(program) {
    const relDefs = new Map();
    
    for (const [name, relObj] of Object.entries(program.rels)) {
      // Handle both {def: expr} and expr directly
      const expr = relObj.def || relObj;
      
      const graph = new PatternGraph(this.codeRegistry);
      const varRefs = [];
      
      this.annotateExpression(expr, graph, varRefs);
      
      relDefs.set(name, {
        name,
        def: expr,
        graph,
        varRefs
      });
    }
    
    return relDefs;
  }

  annotateExpression(expr, graph, varRefs) {
    const rules = new LocalRules(graph);
    rules.codeRegistry = this.codeRegistry;
    rules.representatives = this.representatives;
    
    switch (expr.op) {
      case 'identity':
        rules.annotateIdentity(expr);
        break;
      
      case 'comp':
        for (const e of expr.comp) {
          this.annotateExpression(e, graph, varRefs);
        }
        rules.annotateComp(expr);
        break;
      
      case 'product':
        for (const { exp } of expr.product) {
          this.annotateExpression(exp, graph, varRefs);
        }
        rules.annotateProduct(expr);
        break;
      
      case 'union':
        for (const e of expr.union) {
          this.annotateExpression(e, graph, varRefs);
        }
        rules.annotateUnion(expr);
        break;
      
      case 'dot':
        rules.annotateDot(expr);
        break;
      
      case 'div':
        rules.annotateDiv(expr);
        break;
      
      case 'vid':
        rules.annotateVid(expr);
        break;
      
      case 'code':
        rules.annotateCode(expr, this.codeRegistry);
        break;
      
      case 'ref':
        rules.annotateRef(expr, varRefs);
        break;
      
      case 'filter':
        rules.annotateFilter(expr);
        break;
      
      default:
        throw new Error(`Unknown expression type: ${expr.op}\nExpression: ${JSON.stringify(expr, null, 2)}`);
    }
  }

  analyzeDependencies(relDefs) {
    const edges = [];
    
    for (const [name, relDef] of relDefs) {
      for (const varRef of relDef.varRefs) {
        edges.push({ from: name, to: varRef.varName });
      }
    }
    
    const sccs = computeSCCs(edges, [...relDefs.keys()]);
    return topologicalSort(sccs);
  }

  iterateToFixedPoint(relDefs, sccs) {
    const MAX_ITERATIONS = 10;
    
    for (const scc of sccs) {
      let prevState = null;
      let converged = false;
      
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        // Compress before processing
        for (const relName of scc) {
          const relDef = relDefs.get(relName);
          relDef.graph.compress(this.codes);
        }
        
        for (const relName of scc) {
          const relDef = relDefs.get(relName);
          
          for (const varRef of relDef.varRefs) {
            const targetDef = relDefs.get(varRef.varName);
            if (!targetDef) {
              throw new Error(`Undefined reference: ${varRef.varName}`);
            }
            
            const mapping = targetDef.graph.clone(
              [targetDef.def.patterns[0], targetDef.def.patterns[1]],
              relDef.graph
            );
            
            relDef.graph.unify(
              `ref:input ${relName}(${varRef.varName})`,
              varRef.inputPatternId,
              mapping.get(targetDef.def.patterns[0])
            );
            
            relDef.graph.unify(
              `ref:output`,
              varRef.outputPatternId,
              mapping.get(targetDef.def.patterns[1])
            );
          }
        }
        
        // Compress after processing
        for (const relName of scc) {
          const relDef = relDefs.get(relName);
          relDef.graph.compress(this.codes);
        }
        
        const currentState = this.serializeSCC(relDefs, scc);
        if (currentState === prevState) {
          converged = true;
          break;
        }
        prevState = currentState;
      }
      
      if (!converged) {
        console.warn(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                            ⚠️  WARNING  ⚠️                                 ║
║                                                                           ║
║  Fixed-point iteration did NOT converge after ${MAX_ITERATIONS} iterations!           ║
║                                                                           ║
║  SCC: [${scc.join(', ')}]${' '.repeat(Math.max(0, 60 - scc.join(', ').length))}║
║                                                                           ║
║  Consider adding explicit type annotations for your recursive functions. ║
║  Recursive polymorphic functions may require explicit types to converge. ║
║                                                                           ║
║  Type inference results may be incomplete or incorrect!                   ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);
      }
    }
  }

  serializeSCC(relDefs, scc) {
    const parts = [];
    for (const relName of scc) {
      const relDef = relDefs.get(relName);
      const allPatterns = this.collectAllPatterns(relDef.def);
      const reps = allPatterns.map(id => relDef.graph.find(id));
      parts.push(`${relName}:[${reps.join(',')}]`);
    }
    return parts.join(';');
  }

  collectAllPatterns(expr) {
    const patterns = [...expr.patterns];
    
    switch (expr.op) {
      case 'comp':
        for (const e of expr.comp) {
          patterns.push(...this.collectAllPatterns(e));
        }
        break;
      case 'product':
        for (const { exp } of expr.product) {
          patterns.push(...this.collectAllPatterns(exp));
        }
        break;
      case 'union':
        for (const e of expr.union) {
          patterns.push(...this.collectAllPatterns(e));
        }
        break;
    }
    
    return patterns;
  }
}
