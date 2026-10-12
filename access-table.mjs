// access-table.mjs: State-Indexed Access Table for Polymorphic Execution
// Translates an input schema S into a compact, indexable navigation table
// allowing function instructions to access payload fields and variants
// without runtime string comparisons or dynamic dictionary lookups.

import { patternToPropertyList } from "./codecs/runtime/pattern-json.mjs";

/**
 * Node descriptor for a single state in schema S.
 */
export class NodeDescriptor {
  constructor(state, kind) {
    this.state = state;
    this.kind = kind; // 'product', 'union', or 'any'
  }
}

/**
 * AccessTable encapsulates the complete navigation structure for a
 * schema S with respect to a function's structural access profile P.
 */
export class AccessTable {
  constructor(descriptors, rootState = 0, wordSize = 8) {
    this.descriptors = descriptors;
    this.rootState = rootState;
    this.wordSize = wordSize;
    this.stateCount = descriptors.length;
  }

  getDescriptor(stateId) {
    const desc = this.descriptors[stateId];
    if (!desc) {
      throw new Error(`AccessTable has no descriptor for state ${stateId}`);
    }
    return desc;
  }

  /**
   * Resolves physical byte offset and child state for a logical
   * field access.
   */
  resolveField(stateId, fieldNameOrSlot) {
    const desc = this.getDescriptor(stateId);
    if (desc.kind !== "product") {
      throw new Error(`State ${stateId} is not a product (is ${desc.kind})`);
    }

    if (typeof fieldNameOrSlot === "string") {
      const fieldMeta = desc.fields[fieldNameOrSlot];
      if (!fieldMeta) {
        throw new Error(
          `Field '${fieldNameOrSlot}' not found in state ${stateId}`
        );
      }
      return fieldMeta;
    }

    const slot = fieldNameOrSlot;
    return {
      byteOffset: desc.slotToByteOffset[slot],
      childState: desc.slotToChildState[slot],
      skipCount: desc.slotToSkipCount[slot]
    };
  }

  /**
   * Resolves branch index and child state for a variant discriminator.
   */
  resolveVariant(stateId, tagOrId) {
    const desc = this.getDescriptor(stateId);
    if (desc.kind !== "union") {
      throw new Error(`State ${stateId} is not a union (is ${desc.kind})`);
    }

    if (typeof tagOrId === "string") {
      const tagMeta = desc.tags[tagOrId];
      if (!tagMeta) {
        throw new Error(`Variant '${tagOrId}' not found in state ${stateId}`);
      }
      return tagMeta;
    }

    const tagId = tagOrId;
    return {
      branchId: desc.branchMap[tagId],
      childState: desc.childStateMap[tagId]
    };
  }

  toJSON() {
    return {
      rootState: this.rootState,
      wordSize: this.wordSize,
      stateCount: this.stateCount,
      descriptors: this.descriptors
    };
  }
}

/**
 * Normalizes a pattern, pattern graph, or property list into
 * a canonical property list format.
 */
function toPropertyList(patternOrGraph) {
  if (Array.isArray(patternOrGraph)) {
    return patternOrGraph;
  }
  if (patternOrGraph && Array.isArray(patternOrGraph.nodes)) {
    return patternToPropertyList(patternOrGraph);
  }
  if (patternOrGraph?.patterns?.nodes) {
    // TypePatternGraph from KIR / KVM
    return patternOrGraph.patterns.nodes.map((node) => {
      let kind = "any";
      if (node.pattern === "{}") kind = "closed-product";
      else if (node.pattern === "{...}") kind = "open-product";
      else if (node.pattern === "<>") kind = "closed-union";
      else if (node.pattern === "<...>") kind = "open-union";
      const edges = (node.fields || []).map((f, i) => [f, i]);
      return [kind, edges];
    });
  }
  throw new Error("Invalid pattern representation for access table generation");
}

/**
 * Builds an Access Table bridging an Input Schema S to Function
 * Pattern P.
 *
 * @param {Array|Object} schema - Concrete input value schema S
 * @param {Array|Object} pattern - Function's input pattern graph P
 * @param {Object} [options]
 * @param {number} [options.wordSize=8] - Word size in bytes (default: 8)
 * @returns {AccessTable}
 */
export function buildAccessTable(schema, pattern, options = {}) {
  const wordSize = options.wordSize ?? 8;
  const sList = toPropertyList(schema);
  const pList = toPropertyList(pattern);

  const stateCount = sList.length;
  const descriptors = new Array(stateCount);

  // Simulation worklist: pairs of [stateInS, stateInP]
  const visited = new Set();
  const worklist = [[0, 0]];

  while (worklist.length > 0) {
    const [sId, pId] = worklist.shift();
    const key = `${sId}:${pId}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const sNode = sList[sId];
    const pNode = pList[pId];
    if (!sNode || !pNode) continue;

    const [sKind, sEdges] = sNode;
    const [pKind, pEdges] = pNode;

    const sIsUnion = sKind.includes("union");
    const pIsUnion = pKind.includes("union");

    if (sIsUnion !== pIsUnion && sKind !== "any" && pKind !== "any") {
      throw new Error(
        `Structural mismatch at S[${sId}] (${sKind}) vs P[${pId}] (${pKind})`
      );
    }

    if (sIsUnion) {
      // Sort variant tags in S alphabetically to define physical tag IDs
      const sortedSEdges = [...sEdges].sort((a, b) =>
        a[0].localeCompare(b[0])
      );
      const pEdgeMap = new Map(
        pEdges.map(([label, target], idx) => [
          label,
          { target, branchIdx: idx }
        ])
      );

      const tags = {};
      const branchMap = [];
      const childStateMap = [];

      sortedSEdges.forEach(([tag, sTarget], tagId) => {
        const pMatch = pEdgeMap.get(tag);
        const branchId = pMatch ? pMatch.branchIdx : -1;
        const pTarget = pMatch ? pMatch.target : null;

        tags[tag] = {
          tagId,
          branchId,
          childState: sTarget,
          childPatternState: pTarget
        };
        branchMap[tagId] = branchId;
        childStateMap[tagId] = sTarget;

        if (pTarget != null && pTarget < pList.length) {
          worklist.push([sTarget, pTarget]);
        }
      });

      descriptors[sId] = {
        state: sId,
        kind: "union",
        isOpen: sKind.startsWith("open"),
        variantCount: sortedSEdges.length,
        tags,
        branchMap,
        childStateMap
      };
    } else if (sKind.includes("product")) {
      // Physical layout of fields in S: sorted by label
      const sortedSEdges = [...sEdges].sort((a, b) =>
        a[0].localeCompare(b[0])
      );
      const sFieldMap = new Map(
        sortedSEdges.map(([label, target], idx) => [
          label,
          { target, physicalSlot: idx }
        ])
      );

      const fields = {};
      const slotToByteOffset = [];
      const slotToChildState = [];
      const slotToSkipCount = [];

      pEdges.forEach(([field, pTarget], logicalSlot) => {
        const sMatch = sFieldMap.get(field);
        if (!sMatch) {
          if (!pKind.startsWith("open")) {
            throw new Error(`Required field '${field}' missing in S[${sId}]`);
          }
          return;
        }

        const physicalSlot = sMatch.physicalSlot;
        const sTarget = sMatch.target;
        const byteOffset = physicalSlot * wordSize;
        const skipCount = physicalSlot;

        fields[field] = {
          logicalSlot,
          physicalSlot,
          byteOffset,
          skipCount,
          childState: sTarget,
          childPatternState: pTarget
        };

        slotToByteOffset[logicalSlot] = byteOffset;
        slotToChildState[logicalSlot] = sTarget;
        slotToSkipCount[logicalSlot] = skipCount;

        if (pTarget < pList.length) {
          worklist.push([sTarget, pTarget]);
        }
      });

      descriptors[sId] = {
        state: sId,
        kind: "product",
        isOpen: sKind.startsWith("open"),
        fieldCount: sortedSEdges.length,
        fields,
        slotToByteOffset,
        slotToChildState,
        slotToSkipCount
      };
    } else {
      descriptors[sId] = {
        state: sId,
        kind: "any"
      };
    }
  }

  // Populate any unreached states in S as self-contained descriptors
  for (let sId = 0; sId < stateCount; sId++) {
    if (!descriptors[sId]) {
      const [sKind, sEdges] = sList[sId];
      if (sKind.includes("union")) {
        const sorted = [...sEdges].sort((a, b) => a[0].localeCompare(b[0]));
        descriptors[sId] = {
          state: sId,
          kind: "union",
          isOpen: sKind.startsWith("open"),
          variantCount: sorted.length,
          tags: Object.fromEntries(
            sorted.map(([t, target], i) => [
              t,
              { tagId: i, branchId: i, childState: target }
            ])
          ),
          branchMap: sorted.map((_, i) => i),
          childStateMap: sorted.map(([_, target]) => target)
        };
      } else if (sKind.includes("product")) {
        const sorted = [...sEdges].sort((a, b) => a[0].localeCompare(b[0]));
        descriptors[sId] = {
          state: sId,
          kind: "product",
          isOpen: sKind.startsWith("open"),
          fieldCount: sorted.length,
          fields: Object.fromEntries(
            sorted.map(([f, target], i) => [
              f,
              {
                logicalSlot: i,
                physicalSlot: i,
                byteOffset: i * wordSize,
                skipCount: i,
                childState: target
              }
            ])
          ),
          slotToByteOffset: sorted.map((_, i) => i * wordSize),
          slotToChildState: sorted.map(([_, target]) => target),
          slotToSkipCount: sorted.map((_, i) => i)
        };
      } else {
        descriptors[sId] = { state: sId, kind: "any" };
      }
    }
  }

  return new AccessTable(descriptors, 0, wordSize);
}
