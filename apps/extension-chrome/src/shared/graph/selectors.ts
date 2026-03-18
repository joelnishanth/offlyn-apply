/**
 * Graph Memory Layer — Selectors
 *
 * Pure traversal helpers that operate on the in-memory Maps and Indexes.
 * No mutations, no storage I/O.
 *
 * Edge directions used here (normative):
 *   Question --ANSWERED_BY--> Answer
 *   Field    --MAPS_TO-->     Question
 *   Question --SIMILAR_TO-->  Question  (bidirectional)
 *   Question --CORRECTED_TO--> Correction
 *   Field    --CORRECTED_TO--> Correction
 *   Answer   --DERIVED_FROM--> Question
 *   Answer   --USED_IN-->     Application
 */

import { getIncomingEdgesOfType, getOutgoingEdgesOfType } from './indexes';
import type {
  AnswerPayload,
  CorrectionPayload,
  FieldPayload,
  GraphEdge,
  GraphIndexes,
  GraphNode,
  QuestionPayload,
} from './types';

// ── Node lookup ───────────────────────────────────────────────────────────────

export function findQuestionByNormalizedText(
  normalizedText: string,
  indexes: GraphIndexes,
  nodes: Map<string, GraphNode>
): GraphNode | null {
  const id = indexes.questionByNormalizedText.get(normalizedText);
  return id ? (nodes.get(id) ?? null) : null;
}

export function findFieldByCanonicalField(
  canonicalField: string,
  indexes: GraphIndexes,
  nodes: Map<string, GraphNode>
): GraphNode | null {
  const id = indexes.fieldByCanonicalField.get(canonicalField);
  return id ? (nodes.get(id) ?? null) : null;
}

// ── Answer traversal ──────────────────────────────────────────────────────────

/**
 * Get all Answer nodes connected to a Question via ANSWERED_BY edges.
 * Question --ANSWERED_BY--> Answer
 */
export function getAnswersForQuestion(
  questionId: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  indexes: GraphIndexes
): GraphNode[] {
  const answeredByEdges = getOutgoingEdgesOfType(
    questionId, 'ANSWERED_BY', edges, indexes.edgesByFrom
  );
  return answeredByEdges
    .map(e => nodes.get(e.to))
    .filter((n): n is GraphNode => n !== undefined && n.type === 'answer');
}

// ── Field → questions traversal ───────────────────────────────────────────────

/**
 * Get all Question nodes a Field maps to via MAPS_TO edges.
 * Field --MAPS_TO--> Question
 */
export function getQuestionsForField(
  fieldId: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  indexes: GraphIndexes
): GraphNode[] {
  const mapsToEdges = getOutgoingEdgesOfType(
    fieldId, 'MAPS_TO', edges, indexes.edgesByFrom
  );
  return mapsToEdges
    .map(e => nodes.get(e.to))
    .filter((n): n is GraphNode => n !== undefined && n.type === 'question');
}

/**
 * Get all answers reachable from a field node via:
 *   Field --MAPS_TO--> Question --ANSWERED_BY--> Answer
 *
 * Returns answers paired with their source question for scoring context.
 */
export function getAnswersViaField(
  fieldId: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  indexes: GraphIndexes
): Array<{ answer: GraphNode; sourceQuestion: GraphNode }> {
  const questions = getQuestionsForField(fieldId, nodes, edges, indexes);
  const results: Array<{ answer: GraphNode; sourceQuestion: GraphNode }> = [];

  for (const question of questions) {
    const answers = getAnswersForQuestion(question.id, nodes, edges, indexes);
    for (const answer of answers) {
      results.push({ answer, sourceQuestion: question });
    }
  }

  return results;
}

// ── Similarity traversal ──────────────────────────────────────────────────────

/**
 * Get all questions similar to a given question via SIMILAR_TO edges.
 * Returns them paired with the edge weight (similarity score).
 */
export function getSimilarQuestions(
  questionId: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  indexes: GraphIndexes
): Array<{ question: GraphNode; similarity: number }> {
  const similarEdges = getOutgoingEdgesOfType(
    questionId, 'SIMILAR_TO', edges, indexes.edgesByFrom
  );
  return similarEdges
    .map(e => {
      const q = nodes.get(e.to);
      return q && q.type === 'question'
        ? { question: q, similarity: e.metadata?.similarityScore ?? e.weight }
        : null;
    })
    .filter((r): r is { question: GraphNode; similarity: number } => r !== null);
}

// ── Correction traversal ──────────────────────────────────────────────────────

/**
 * Get the most recent Correction node attached to a question or field.
 * Question --CORRECTED_TO--> Correction
 * Field    --CORRECTED_TO--> Correction
 */
export function getLatestCorrection(
  nodeId: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  indexes: GraphIndexes
): GraphNode | null {
  const correctionEdges = getOutgoingEdgesOfType(
    nodeId, 'CORRECTED_TO', edges, indexes.edgesByFrom
  );
  const corrections = correctionEdges
    .map(e => nodes.get(e.to))
    .filter((n): n is GraphNode => n !== undefined && n.type === 'correction');

  if (corrections.length === 0) return null;

  // Most recent by createdAt
  return corrections.reduce((latest, curr) =>
    curr.createdAt > latest.createdAt ? curr : latest
  );
}

/**
 * Check whether a question or field node has any correction attached.
 */
export function hasCorrectionNode(
  nodeId: string,
  edges: Map<string, GraphEdge>,
  indexes: GraphIndexes
): boolean {
  const correctionEdges = getOutgoingEdgesOfType(
    nodeId, 'CORRECTED_TO', edges, indexes.edgesByFrom
  );
  return correctionEdges.length > 0;
}

// ── Orphan detection (used by pruning) ────────────────────────────────────────

/**
 * Returns true if a node has no inbound or outbound edges of any type.
 */
export function isOrphanNode(
  nodeId: string,
  indexes: GraphIndexes
): boolean {
  const outbound = indexes.edgesByFrom.get(nodeId) ?? [];
  const inbound = indexes.edgesByTo.get(nodeId) ?? [];
  return outbound.length === 0 && inbound.length === 0;
}

// ── Typed payload accessors ───────────────────────────────────────────────────

export function asQuestion(node: GraphNode): QuestionPayload {
  return node.payload as QuestionPayload;
}

export function asAnswer(node: GraphNode): AnswerPayload {
  return node.payload as AnswerPayload;
}

export function asField(node: GraphNode): FieldPayload {
  return node.payload as FieldPayload;
}

export function asCorrection(node: GraphNode): CorrectionPayload {
  return node.payload as CorrectionPayload;
}
