/**
 * Graph Memory Layer — Type Definitions
 *
 * All node, edge, index, and metadata types for the Firefox graph memory system.
 * Edge directions are normative — all traversal code must follow them:
 *   Question --ANSWERED_BY--> Answer
 *   Field    --MAPS_TO-->     Question
 *   Question --SIMILAR_TO-->  Question  (stored bidirectionally)
 *   Answer   --USED_IN-->     Application
 *   Question --CORRECTED_TO--> Correction
 *   Field    --CORRECTED_TO--> Correction
 *   Answer   --DERIVED_FROM--> Question
 */

// ── Node types ───────────────────────────────────────────────────────────────

export type NodeType = 'question' | 'answer' | 'field' | 'application' | 'correction';

export type EdgeType =
  | 'ANSWERED_BY'
  | 'MAPS_TO'
  | 'SIMILAR_TO'
  | 'USED_IN'
  | 'CORRECTED_TO'
  | 'DERIVED_FROM';

/**
 * Why a particular answer was selected — carried on AnswerPayload and
 * FillProvenanceRecord for debugging.
 */
export type SelectionReason = 'exact' | 'field' | 'similarity' | 'llm' | 'correction' | 'rl' | 'profile';

export type AnswerSource = 'user' | 'llm' | 'profile' | 'learned';

// ── Node payloads ─────────────────────────────────────────────────────────────

export interface QuestionPayload {
  rawText: string;
  normalizedText: string;
  /** Aligned with FieldPayload.canonicalField — single naming system */
  canonicalField?: string;
  /** ATS platform hint: 'greenhouse' | 'lever' | 'workday' | 'ashby' | etc. */
  platform?: string;
  /** Semantic prompt type from FieldClassifier — used for type-compatibility checks */
  promptType?: string;
}

export interface AnswerPayload {
  value: string;
  source: AnswerSource;
  /** Provenance — why this answer was selected */
  selectionReason?: SelectionReason;
  confidence: number;
  usageCount: number;
  lastUsedAt: number;
  /** Semantic prompt type from FieldClassifier — used for type-compatibility checks */
  promptType?: string;
}

export interface FieldPayload {
  /** Single source of truth for field identity — e.g. 'first_name', 'cover_letter' */
  canonicalField: string;
  aliases: string[];
}

export interface CorrectionPayload {
  originalValue: string;
  correctedValue: string;
  context: {
    company?: string;
    jobTitle?: string;
    url?: string;
    platform?: string;
  };
}

export interface ApplicationPayload {
  company: string;
  jobTitle: string;
  url: string;
  platform?: string;
}

export type NodePayload =
  | QuestionPayload
  | AnswerPayload
  | FieldPayload
  | CorrectionPayload
  | ApplicationPayload;

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: NodeType;
  createdAt: number;
  updatedAt: number;
  payload: NodePayload;
  /**
   * When true, this node is a debug/similarity/low-confidence artifact.
   * It is excluded from user-facing graph views (Overview, Focus modes)
   * but visible in Advanced mode.
   */
  internal?: boolean;
}

// ── Edges ─────────────────────────────────────────────────────────────────────

export interface EdgeMetadata {
  /** For SIMILAR_TO edges */
  similarityScore?: number;
  platform?: string;
  successCount?: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  /** 0–1, used for scoring and pruning */
  weight: number;
  createdAt: number;
  updatedAt: number;
  metadata?: EdgeMetadata;
}

// ── Indexes (in-memory only, never persisted) ─────────────────────────────────

export interface GraphIndexes {
  /** normalizedText -> question node id */
  questionByNormalizedText: Map<string, string>;
  /** canonicalField -> field node id */
  fieldByCanonicalField: Map<string, string>;
  /** node id -> outgoing edge ids */
  edgesByFrom: Map<string, string[]>;
  /** node id -> incoming edge ids */
  edgesByTo: Map<string, string[]>;
  /** type -> node ids */
  nodesByType: Map<NodeType, string[]>;
  /** `${from}:${to}:${type}` -> edge id — enables O(1) upsert */
  edgeKey: Map<string, string>;
}

// ── Graph metadata (stored plaintext in graph_meta) ───────────────────────────

export interface GraphMeta {
  schemaVersion: number;
  lastUpdated: number;
  nodeCount: number;
  edgeCount: number;
  migrationHistory: Array<{ version: number; timestamp: number }>;
}

// ── Persisted storage shapes ──────────────────────────────────────────────────

/** What is written to browser.storage.local for graph_nodes / graph_edges */
export type PersistedNodes = Record<string, GraphNode>;
export type PersistedEdges = Record<string, GraphEdge>;
/** What is written to graph_embedding_cache */
export type PersistedEmbeddingCache = Record<string, number[]>;

// ── Fill provenance (in-memory session only, never persisted) ─────────────────

export interface FillProvenanceRecord {
  value: string;
  source: SelectionReason | null;
  confidence: number;
  matchedQuestionText?: string;
  matchedQuestionId?: string;
  answerNodeId?: string;
  /** Set when source is 'similarity' */
  similarityScore?: number;
  /** Set when a correction influenced the result */
  correctionContext?: {
    originalValue: string;
    correctedAt?: number;
  };
  resolvedAt: number;
}

// ── getBestAnswerForField input/output ────────────────────────────────────────

export interface GetBestAnswerInput {
  questionText: string;
  canonicalField?: string;
  platform?: string;
  company?: string;
  jobTitle?: string;
  url?: string;
  /** Semantic prompt type from FieldClassifier — used for type-compatibility check */
  promptType?: string;
}

export interface GetBestAnswerResult {
  value: string | null;
  confidence: number;
  source: 'graph-exact' | 'graph-field' | 'graph-similar' | null;
  selectionReason: SelectionReason | null;
  questionNodeId?: string;
  answerNodeId?: string;
}

// ── Job context (mirrors existing JobContext in learning-types) ───────────────

export interface GraphJobContext {
  company?: string;
  jobTitle?: string;
  url?: string;
  platform?: string;
}

// ── Scoring context ───────────────────────────────────────────────────────────

export type MatchClass = 'correction' | 'exact' | 'field' | 'similarity';

export interface ScoringContext {
  matchClass: MatchClass;
  platform?: string;
  questionPlatform?: string;
  similarityScore?: number;
  hasCorrectionNode: boolean;
}
