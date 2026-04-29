/**
 * Graph Memory Layer — Indexes
 *
 * All indexes are in-memory only and are never persisted.
 * They are rebuilt from scratch on load and updated in-place on every mutation.
 *
 * The edgeKey index (`from:to:type` → edge id) is what makes
 * createOrUpdateEdge() O(1) without any full scans.
 */

import { edgeKey } from './normalize';
import type { EdgeType, GraphEdge, GraphIndexes, GraphNode, NodeType, QuestionPayload, FieldPayload } from './types';

// ── Build ─────────────────────────────────────────────────────────────────────

/**
 * Build all indexes from scratch from the full node and edge maps.
 * Called once on service initialization after loading from storage.
 */
export function buildIndexes(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>
): GraphIndexes {
  const questionByNormalizedText = new Map<string, string>();
  const fieldByCanonicalField = new Map<string, string>();
  const edgesByFrom = new Map<string, string[]>();
  const edgesByTo = new Map<string, string[]>();
  const nodesByType = new Map<NodeType, string[]>();
  const edgeKeyIndex = new Map<string, string>();

  for (const node of nodes.values()) {
    indexNode(node, questionByNormalizedText, fieldByCanonicalField, nodesByType);
  }

  for (const edge of edges.values()) {
    indexEdge(edge, edgesByFrom, edgesByTo, edgeKeyIndex);
  }

  return {
    questionByNormalizedText,
    fieldByCanonicalField,
    edgesByFrom,
    edgesByTo,
    nodesByType,
    edgeKey: edgeKeyIndex,
  };
}

// ── Point updates (called on every mutation instead of full rebuild) ──────────

/**
 * Add a node to the relevant indexes.
 */
export function indexNode(
  node: GraphNode,
  questionByNormalizedText: Map<string, string>,
  fieldByCanonicalField: Map<string, string>,
  nodesByType: Map<NodeType, string[]>
): void {
  // nodesByType
  const typeList = nodesByType.get(node.type) ?? [];
  if (!typeList.includes(node.id)) {
    typeList.push(node.id);
    nodesByType.set(node.type, typeList);
  }

  // Type-specific indexes
  if (node.type === 'question') {
    const p = node.payload as QuestionPayload;
    questionByNormalizedText.set(p.normalizedText, node.id);
  } else if (node.type === 'field') {
    const p = node.payload as FieldPayload;
    fieldByCanonicalField.set(p.canonicalField, node.id);
  }
}

/**
 * Remove a node from all indexes.
 */
export function deindexNode(
  node: GraphNode,
  questionByNormalizedText: Map<string, string>,
  fieldByCanonicalField: Map<string, string>,
  nodesByType: Map<NodeType, string[]>
): void {
  const typeList = nodesByType.get(node.type);
  if (typeList) {
    const filtered = typeList.filter(id => id !== node.id);
    nodesByType.set(node.type, filtered);
  }

  if (node.type === 'question') {
    const p = node.payload as QuestionPayload;
    if (questionByNormalizedText.get(p.normalizedText) === node.id) {
      questionByNormalizedText.delete(p.normalizedText);
    }
  } else if (node.type === 'field') {
    const p = node.payload as FieldPayload;
    if (fieldByCanonicalField.get(p.canonicalField) === node.id) {
      fieldByCanonicalField.delete(p.canonicalField);
    }
  }
}

/**
 * Add an edge to the edgesByFrom, edgesByTo, and edgeKey indexes.
 */
export function indexEdge(
  edge: GraphEdge,
  edgesByFrom: Map<string, string[]>,
  edgesByTo: Map<string, string[]>,
  edgeKeyIndex: Map<string, string>
): void {
  // edgesByFrom
  const fromList = edgesByFrom.get(edge.from) ?? [];
  if (!fromList.includes(edge.id)) {
    fromList.push(edge.id);
    edgesByFrom.set(edge.from, fromList);
  }

  // edgesByTo
  const toList = edgesByTo.get(edge.to) ?? [];
  if (!toList.includes(edge.id)) {
    toList.push(edge.id);
    edgesByTo.set(edge.to, toList);
  }

  // edgeKey — enables O(1) upsert
  edgeKeyIndex.set(edgeKey(edge.from, edge.to, edge.type), edge.id);
}

/**
 * Remove an edge from all edge indexes.
 */
export function deindexEdge(
  edge: GraphEdge,
  edgesByFrom: Map<string, string[]>,
  edgesByTo: Map<string, string[]>,
  edgeKeyIndex: Map<string, string>
): void {
  const fromList = edgesByFrom.get(edge.from);
  if (fromList) {
    edgesByFrom.set(edge.from, fromList.filter(id => id !== edge.id));
  }

  const toList = edgesByTo.get(edge.to);
  if (toList) {
    edgesByTo.set(edge.to, toList.filter(id => id !== edge.id));
  }

  edgeKeyIndex.delete(edgeKey(edge.from, edge.to, edge.type));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get all edges of a given type outgoing from a node.
 */
export function getOutgoingEdgesOfType(
  nodeId: string,
  type: EdgeType,
  edges: Map<string, GraphEdge>,
  edgesByFrom: Map<string, string[]>
): GraphEdge[] {
  const ids = edgesByFrom.get(nodeId) ?? [];
  return ids
    .map(id => edges.get(id))
    .filter((e): e is GraphEdge => e !== undefined && e.type === type);
}

/**
 * Get all edges of a given type incoming to a node.
 */
export function getIncomingEdgesOfType(
  nodeId: string,
  type: EdgeType,
  edges: Map<string, GraphEdge>,
  edgesByTo: Map<string, string[]>
): GraphEdge[] {
  const ids = edgesByTo.get(nodeId) ?? [];
  return ids
    .map(id => edges.get(id))
    .filter((e): e is GraphEdge => e !== undefined && e.type === type);
}
