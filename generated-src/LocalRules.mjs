import { Pattern } from './Pattern.mjs';
import codes from '../codes.mjs';

export class LocalRules {
  constructor(graph) {
    this.graph = graph;
  }

  annotateIdentity(expr) {
    const p = this.graph.addNode(Pattern.openUnknown());
    expr.patterns = [p, p];
  }

  annotateComp(expr) {
    const inP = this.graph.addNode(Pattern.openUnknown());
    const outP = this.graph.addNode(Pattern.openUnknown());
    expr.patterns = [inP, outP];
    
    if (expr.comp.length === 0) {
      this.graph.unify('comp:empty', inP, outP);
    } else {
      this.graph.unify('comp:start', inP, expr.comp[0].patterns[0]);
      this.graph.unify('comp:end', outP, expr.comp[expr.comp.length - 1].patterns[1]);
      
      for (let i = 0; i < expr.comp.length - 1; i++) {
        this.graph.unify('comp:chain', 
          expr.comp[i].patterns[1], 
          expr.comp[i + 1].patterns[0]);
      }
    }
  }

  annotateProduct(expr) {
    const inP = this.graph.addNode(Pattern.openUnknown());
    
    if (expr.product.length === 0) {
      const unitId = this.graph.getTypeId(codes.unitCode, this.codeRegistry);
      expr.patterns = [inP, unitId];
    } else if (expr.product.length === 1) {
      const { label, exp } = expr.product[0];
      const outP = this.graph.addNode(Pattern.openUnion([label]), {
        [label]: [exp.patterns[1]]
      });
      expr.patterns = [inP, outP];
      this.graph.unify('variant:input', inP, exp.patterns[0]);
    } else {
      const labels = expr.product.map(f => f.label);
      const edges = {};
      const inputs = [inP];
      
      for (const { label, exp } of expr.product) {
        edges[label] = [exp.patterns[1]];
        inputs.push(exp.patterns[0]);
      }
      
      const outP = this.graph.addNode(Pattern.closedProduct(labels), edges);
      expr.patterns = [inP, outP];
      this.graph.unify('product:input', ...inputs);
    }
  }

  annotateUnion(expr) {
    const inP = this.graph.addNode(Pattern.openUnknown());
    const outP = this.graph.addNode(Pattern.openUnknown());
    expr.patterns = [inP, outP];
    
    if (expr.union.length > 0) {
      const inputs = [inP, ...expr.union.map(e => e.patterns[0])];
      const outputs = [outP, ...expr.union.map(e => e.patterns[1])];
      
      this.graph.unify('union:input', ...inputs);
      this.graph.unify('union:output', ...outputs);
    }
  }

  annotateDot(expr) {
    const outP = this.graph.addNode(Pattern.openUnknown());
    const inP = this.graph.addNode(Pattern.openUnknown([expr.dot]), {
      [expr.dot]: [outP]
    });
    expr.patterns = [inP, outP];
  }

  annotateDiv(expr) {
    const outP = this.graph.addNode(Pattern.openUnknown());
    const inP = this.graph.addNode(Pattern.openUnion([expr.div]), {
      [expr.div]: [outP]
    });
    expr.patterns = [inP, outP];
  }

  annotateVid(expr) {
    const inP = this.graph.addNode(Pattern.openUnknown());
    const outP = this.graph.addNode(Pattern.openUnion([expr.vid]), {
      [expr.vid]: [inP]
    });
    expr.patterns = [inP, outP];
  }

  annotateCode(expr, codeRegistry) {
    const typeId = this.graph.getTypeId(expr.code, codeRegistry);
    expr.patterns = [typeId, typeId];
  }

  annotateRef(expr, varRefs) {
    const inP = this.graph.addNode(Pattern.openUnknown());
    const outP = this.graph.addNode(Pattern.openUnknown());
    expr.patterns = [inP, outP];
    
    varRefs.push({
      varName: expr.ref,
      inputPatternId: inP,
      outputPatternId: outP,
      expr
    });
  }

  annotateFilter(expr) {
    // Filter creates a pattern constraint
    // For now, treat as identity with open unknown
    const p = this.graph.addNode(Pattern.openUnknown());
    expr.patterns = [p, p];
  }
}
