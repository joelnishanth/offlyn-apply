import type { Node, Edge } from '@xyflow/react';
import type { GraphNode, GraphEdge } from '../../shared/graph/types';

/**
 * Hierarchical layout:
 *   Row 0 (top):    field nodes   — anchors / canonical fields
 *   Row 1:          question nodes
 *   Row 2:          answer nodes
 *   Row 3 (bottom): correction + application nodes
 *
 * Each row is centered. Nodes are spaced horizontally.
 * Column spacing is wider so default fit-view isn't cramped.
 */

const ROW_SPACING = 200;
const COL_SPACING = 240;

type RowKey = 'field' | 'question' | 'answer' | 'other';

const ROW_ORDER: Record<RowKey, number> = {
  field:    0,
  question: 1,
  answer:   2,
  other:    3,
};

function getRow(type: string): RowKey {
  if (type === 'field')    return 'field';
  if (type === 'question') return 'question';
  if (type === 'answer')   return 'answer';
  return 'other';
}

export function buildReactFlowElements(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge>
): { nodes: Node[]; edges: Edge[] } {
  const nodeList = Object.values(nodes);
  const edgeList = Object.values(edges);

  // Group nodes into rows
  const rows: Record<RowKey, GraphNode[]> = {
    field:    [],
    question: [],
    answer:   [],
    other:    [],
  };
  for (const n of nodeList) {
    rows[getRow(n.type)].push(n);
  }

  // Compute positions — center each row independently
  const rfNodes: Node[] = [];
  for (const [rowKey, rowNodes] of Object.entries(rows) as [RowKey, GraphNode[]][]) {
    const y = ROW_ORDER[rowKey] * ROW_SPACING;
    const totalWidth = (rowNodes.length - 1) * COL_SPACING;
    const startX = -totalWidth / 2;

    rowNodes.forEach((n, i) => {
      rfNodes.push({
        id: n.id,
        type: n.type,
        position: { x: startX + i * COL_SPACING, y },
        data: {
          label:    getNodeLabel(n),
          payload:  n.payload,
          nodeType: n.type,
          // dimmed / neighbor / etc are injected by RelationshipsTab at render time
        },
        draggable: true,
      });
    });
  }

  // Build React Flow edges — NO labels by default (edge type shown in toolbar only)
  const rfEdges: Edge[] = edgeList.map(e => ({
    id:     e.id,
    source: e.from,
    target: e.to,
    // label intentionally omitted — labels create clutter
    type: 'default',
    style:     getBaseEdgeStyle(e.type),
    markerEnd: {
      type:   'arrowclosed' as any,
      color:  getEdgeColor(e.type),
      width:  10,
      height: 10,
    },
    data: { edgeType: e.type, weight: e.weight },
  }));

  return { nodes: rfNodes, edges: rfEdges };
}

export function getNodeLabel(n: GraphNode): string {
  const p = n.payload as any;
  switch (n.type) {
    case 'question':    return p.normalizedText || p.rawText || n.id;
    case 'answer':      return p.value || n.id;
    case 'field':       return p.canonicalField || n.id;
    case 'correction':  return p.correctedValue || n.id;
    case 'application': return p.company || n.id;
    default:            return n.id;
  }
}

export function getEdgeColor(type: string): string {
  switch (type) {
    case 'ANSWERED_BY':  return '#22c55e';
    case 'MAPS_TO':      return '#f59e0b';
    case 'CORRECTED_TO': return '#ef4444';
    case 'USED_IN':      return '#3b82f6';
    case 'SIMILAR_TO':   return '#6366f1';
    case 'DERIVED_FROM': return '#8b5cf6';
    default:             return '#52525b';
  }
}

/**
 * Base edge style — intentionally quiet.
 * RelationshipsTab overrides style when edges are in a focused/dimmed state.
 */
export function getBaseEdgeStyle(type: string): React.CSSProperties {
  const color = getEdgeColor(type);
  const base: React.CSSProperties = {
    stroke:        color,
    strokeOpacity: 0.18,
    strokeWidth:   1,
  };
  if (type === 'CORRECTED_TO') return { ...base, strokeDasharray: '5 3', strokeOpacity: 0.22 };
  if (type === 'SIMILAR_TO')   return { ...base, strokeDasharray: '2 3', strokeOpacity: 0.12 };
  return base;
}

/** Highlighted edge style — used when edge connects to the selected node. */
export function getFocusedEdgeStyle(type: string): React.CSSProperties {
  const color = getEdgeColor(type);
  return {
    stroke:        color,
    strokeOpacity: 0.9,
    strokeWidth:   2,
    ...(type === 'CORRECTED_TO' ? { strokeDasharray: '5 3' } : {}),
    ...(type === 'SIMILAR_TO'   ? { strokeDasharray: '2 3' } : {}),
  };
}
