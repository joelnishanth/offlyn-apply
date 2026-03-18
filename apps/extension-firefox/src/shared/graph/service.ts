/**
 * Graph Memory Layer — GraphMemoryService
 *
 * Background-owned singleton. The only component that directly mutates the
 * graph. Content scripts never call this directly — they send messages to
 * the background runtime which delegates here.
 *
 * Initialization sequence:
 *   await graphMemory.initialize();
 *
 * Primary public API:
 *   getBestAnswerForField(input)  — single autofill lookup entry point
 *   recordAnswer(...)             — persist a used answer back into graph
 *   recordCorrection(...)         — dual question + field correction linkage
 *   reinforceSimilarity(...)      — strengthen or create SIMILAR_TO edges
 *
 * Debug API:
 *   recordFillProvenance(...)     — called after every fill resolution
 *   getLastFillProvenance(...)    — called by debug panel handler
 */

import {
  EMBEDDING_CACHE_SAVE_DEBOUNCE_MS,
  LONG_FORM_FIELDS,
  LONG_FORM_LENGTH_THRESHOLD,
  PRUNING,
  SAVE_DEBOUNCE_MS,
  SIMILARITY_THRESHOLD,
  SIMILARITY_WITH_USAGE_MIN_CONFIDENCE,
} from './constants';
import { isTypeCompatible } from '../field-classifier';
import { deindexEdge, deindexNode, buildIndexes, indexEdge, indexNode } from './indexes';
import {
  applicationNodeId,
  correctionNodeId,
  edgeKey,
  fieldNodeId,
  longFormAnswerNodeId,
  normalizeAnswerValue,
  normalizeQuestion,
  questionNodeId,
  shortFormAnswerNodeId,
} from './normalize';
import { scoreCandidate, selectBestCandidate, meetsAutofillThreshold } from './scoring';
import {
  asAnswer,
  asCorrection,
  asQuestion,
  findFieldByCanonicalField,
  findQuestionByNormalizedText,
  getAnswersForQuestion,
  getAnswersViaField,
  getLatestCorrection,
  getSimilarQuestions,
  hasCorrectionNode,
  isOrphanNode,
} from './selectors';
import {
  loadEmbeddingCache,
  loadGraphState,
  saveEmbeddingCache,
  saveGraphState,
} from './storage';
import type {
  AnswerPayload,
  AnswerSource,
  ApplicationPayload,
  CorrectionPayload,
  EdgeMetadata,
  EdgeType,
  FieldPayload,
  FillProvenanceRecord,
  GetBestAnswerInput,
  GetBestAnswerResult,
  GraphEdge,
  GraphIndexes,
  GraphJobContext,
  GraphNode,
  NodePayload,
  NodeType,
  QuestionPayload,
  SelectionReason,
  ScoringContext,
} from './types';

// ── ID helper ─────────────────────────────────────────────────────────────────

function generateEdgeId(): string {
  return `edge:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── GraphMemoryService ────────────────────────────────────────────────────────

export class GraphMemoryService {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private indexes!: GraphIndexes;
  private embeddingCache: Map<string, number[]> = new Map();

  private ready = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private embeddingCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Session-scoped fill provenance — never persisted. */
  private fillProvenance: Map<string, FillProvenanceRecord> = new Map();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.ready) return;

    const { nodes, edges } = await loadGraphState();
    this.nodes = nodes;
    this.edges = edges;
    this.indexes = buildIndexes(this.nodes, this.edges);
    this.embeddingCache = await loadEmbeddingCache();
    this.ready = true;

    console.log('[Graph] Initialized — nodes:', this.nodes.size, 'edges:', this.edges.size);
    this.pruneGraph();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveGraphState(this.nodes, this.edges).catch(err =>
        console.error('[Graph] Scheduled save failed:', err)
      );
    }, SAVE_DEBOUNCE_MS);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await saveGraphState(this.nodes, this.edges);
  }

  private scheduleEmbeddingCacheSave(): void {
    if (this.embeddingCacheSaveTimer !== null) clearTimeout(this.embeddingCacheSaveTimer);
    this.embeddingCacheSaveTimer = setTimeout(() => {
      this.embeddingCacheSaveTimer = null;
      saveEmbeddingCache(this.embeddingCache).catch(err =>
        console.error('[Graph] Embedding cache save failed:', err)
      );
    }, EMBEDDING_CACHE_SAVE_DEBOUNCE_MS);
  }

  // ── Primary public API ─────────────────────────────────────────────────────

  /**
   * Single entry point for autofill answer lookup.
   *
   * Resolution order:
   *   1. Exact question match (graph-exact)
   *   2. Canonical field match (graph-field)
   *   3. Embedding similarity + graph reinforcement (graph-similar)
   *   4. Returns null → caller falls through to LLM
   */
  async getBestAnswerForField(input: GetBestAnswerInput): Promise<GetBestAnswerResult> {
    if (!this.ready) {
      return { value: null, confidence: 0, source: null, selectionReason: null };
    }

    const normalizedText = normalizeQuestion(input.questionText);
    const { candidates, source, questionNodeId: qId } = this.collectCandidates(
      normalizedText,
      input
    );

    if (candidates.length === 0) {
      return { value: null, confidence: 0, source: null, selectionReason: null };
    }

    const best = selectBestCandidate(candidates);
    if (!best) return { value: null, confidence: 0, source: null, selectionReason: null };

    const payload = asAnswer(best.node);

    // Type-compatibility gate — prevent "No" filling a date field, etc.
    if (input.promptType && !isTypeCompatible(payload.value, input.promptType as any)) {
      console.log(`[Graph] Type-incompatible answer rejected — value="${payload.value}" promptType="${input.promptType}"`);
      return { value: null, confidence: 0, source: null, selectionReason: null };
    }

    return {
      value: payload.value,
      confidence: best.confidence,
      source: source,
      selectionReason: payload.selectionReason ?? null,
      questionNodeId: qId,
      answerNodeId: best.node.id,
    };
  }

  private collectCandidates(
    normalizedText: string,
    input: GetBestAnswerInput
  ): {
    candidates: ReturnType<typeof scoreCandidate>[];
    source: GetBestAnswerResult['source'];
    questionNodeId?: string;
  } {
    // 1. Exact question match
    const exactQuestion = findQuestionByNormalizedText(normalizedText, this.indexes, this.nodes);
    if (exactQuestion) {
      const answers = getAnswersForQuestion(exactQuestion.id, this.nodes, this.edges, this.indexes);
      if (answers.length > 0) {
        const questionHasCorrection = hasCorrectionNode(exactQuestion.id, this.edges, this.indexes);
        const candidates = answers.map(a => {
          const ctx: ScoringContext = {
            matchClass: questionHasCorrection ? 'correction' : 'exact',
            platform: input.platform,
            questionPlatform: (exactQuestion.payload as QuestionPayload).platform,
            hasCorrectionNode: questionHasCorrection,
          };
          return scoreCandidate(a, ctx);
        });
        return { candidates, source: 'graph-exact', questionNodeId: exactQuestion.id };
      }
    }

    // 2. Canonical field match
    if (input.canonicalField) {
      const fieldNode = findFieldByCanonicalField(input.canonicalField, this.indexes, this.nodes);
      if (fieldNode) {
        const fieldHasCorrection = hasCorrectionNode(fieldNode.id, this.edges, this.indexes);
        const viaField = getAnswersViaField(fieldNode.id, this.nodes, this.edges, this.indexes);
        if (viaField.length > 0) {
          const candidates = viaField.map(({ answer, sourceQuestion }) => {
            const ctx: ScoringContext = {
              matchClass: fieldHasCorrection ? 'correction' : 'field',
              platform: input.platform,
              questionPlatform: (sourceQuestion.payload as QuestionPayload).platform,
              hasCorrectionNode: fieldHasCorrection,
            };
            return scoreCandidate(answer, ctx);
          });
          return { candidates, source: 'graph-field' };
        }
      }
    }

    // 3. Similarity — handled asynchronously by the caller using findSimilarByEmbedding()
    // Returns empty here; the async similarity path calls getBestAnswerForField after
    // reinforcing the SIMILAR_TO edge (so step 1 will hit on the next pass).
    return { candidates: [], source: null };
  }

  /**
   * Find similar questions using the embedding cache and return the best answer.
   * Separate async method because Ollama embedding calls are expensive.
   * Caller is responsible for calling getEmbedding() and cosineSimilarity() externally.
   */
  async applyEmbeddingSimilarity(
    questionText: string,
    questionEmbedding: number[],
    computeSimilarity: (a: number[], b: number[]) => number,
    input: GetBestAnswerInput
  ): Promise<GetBestAnswerResult> {
    if (!this.ready) return { value: null, confidence: 0, source: null, selectionReason: null };

    const normalizedText = normalizeQuestion(questionText);
    const questionIds = this.indexes.nodesByType.get('question') ?? [];
    let bestScore = 0;
    let bestQuestion: GraphNode | null = null;

    for (const qId of questionIds) {
      const q = this.nodes.get(qId);
      if (!q) continue;

      const qPayload = asQuestion(q);
      let cachedEmbedding = this.embeddingCache.get(qId);

      if (!cachedEmbedding) {
        // Embedding not yet cached — skip this candidate for now.
        // Will be computed and cached the first time this question is used.
        continue;
      }

      const similarity = computeSimilarity(questionEmbedding, cachedEmbedding);
      if (similarity > SIMILARITY_THRESHOLD && similarity > bestScore) {
        bestScore = similarity;
        bestQuestion = q;
      }
    }

    if (!bestQuestion) return { value: null, confidence: 0, source: null, selectionReason: null };

    const bestQPayload = asQuestion(bestQuestion);
    // Reinforce the SIMILAR_TO relationship (both directions)
    const incomingNormalized = normalizeQuestion(questionText);
    const incomingId = questionNodeId(incomingNormalized);

    // Similarity-path nodes are internal (debug) artifacts — not shown in user-facing graph
    const incomingNode = this.nodes.get(incomingId);
    if (incomingNode && !incomingNode.internal) {
      incomingNode.internal = true;
    }
    this.reinforceSimilarity(incomingId, bestQuestion.id, bestScore);

    // Cache the incoming question's embedding
    this.embeddingCache.set(incomingId, questionEmbedding);
    this.scheduleEmbeddingCacheSave();

    const answers = getAnswersForQuestion(bestQuestion.id, this.nodes, this.edges, this.indexes);
    if (answers.length === 0) return { value: null, confidence: 0, source: null, selectionReason: null };

    const candidates = answers.map(a => {
      const ctx: ScoringContext = {
        matchClass: 'similarity',
        platform: input.platform,
        questionPlatform: bestQPayload.platform,
        similarityScore: bestScore,
        hasCorrectionNode: false,
      };
      return scoreCandidate(a, ctx);
    });

    const best = selectBestCandidate(candidates);
    if (!best) return { value: null, confidence: 0, source: null, selectionReason: null };

    // Only surface for autofill if confidence passes threshold
    const payload = asAnswer(best.node);
    const usedBefore = payload.usageCount > 0;
    const adjustedConfidence = usedBefore
      ? Math.max(best.confidence, SIMILARITY_WITH_USAGE_MIN_CONFIDENCE)
      : best.confidence;

    return {
      value: payload.value,
      confidence: adjustedConfidence,
      source: 'graph-similar',
      selectionReason: 'similarity',
      questionNodeId: bestQuestion.id,
      answerNodeId: best.node.id,
    };
  }

  // ── Node mutations ─────────────────────────────────────────────────────────

  upsertQuestionNode(
    rawText: string,
    canonicalField?: string,
    platform?: string
  ): GraphNode {
    const normalizedText = normalizeQuestion(rawText);
    const id = questionNodeId(normalizedText);

    const existing = this.nodes.get(id);
    if (existing) {
      return existing;
    }

    const node: GraphNode = {
      id,
      type: 'question',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: {
        rawText,
        normalizedText,
        canonicalField,
        platform,
      } satisfies QuestionPayload,
    };

    this.nodes.set(id, node);
    indexNode(node, this.indexes.questionByNormalizedText, this.indexes.fieldByCanonicalField, this.indexes.nodesByType);
    this.scheduleSave();
    return node;
  }

  upsertFieldNode(canonicalField: string, alias?: string): GraphNode {
    const id = fieldNodeId(canonicalField);
    const existing = this.nodes.get(id);

    if (existing) {
      // Add alias if new
      if (alias) {
        const p = existing.payload as FieldPayload;
        if (!p.aliases.includes(alias)) {
          p.aliases.push(alias);
          existing.updatedAt = Date.now();
          this.scheduleSave();
        }
      }
      return existing;
    }

    const node: GraphNode = {
      id,
      type: 'field',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: {
        canonicalField,
        aliases: alias ? [alias] : [],
      } satisfies FieldPayload,
    };

    this.nodes.set(id, node);
    indexNode(node, this.indexes.questionByNormalizedText, this.indexes.fieldByCanonicalField, this.indexes.nodesByType);
    this.scheduleSave();
    return node;
  }

  upsertAnswerNode(
    value: string,
    canonicalField: string,
    source: AnswerSource,
    selectionReason?: SelectionReason
  ): GraphNode {
    const isLongForm =
      value.length > LONG_FORM_LENGTH_THRESHOLD || LONG_FORM_FIELDS.has(canonicalField);

    const id = isLongForm
      ? longFormAnswerNodeId()
      : shortFormAnswerNodeId(normalizeAnswerValue(value), canonicalField);

    const existing = this.nodes.get(id);
    if (existing && !isLongForm) {
      // For short-form: update source/reason but don't create duplicate
      const p = existing.payload as AnswerPayload;
      if (selectionReason) p.selectionReason = selectionReason;
      existing.updatedAt = Date.now();
      return existing;
    }

    const node: GraphNode = {
      id,
      type: 'answer',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: {
        value,
        source,
        selectionReason,
        confidence: 0.5,
        usageCount: 0,
        lastUsedAt: Date.now(),
      } satisfies AnswerPayload,
    };

    this.nodes.set(id, node);
    indexNode(node, this.indexes.questionByNormalizedText, this.indexes.fieldByCanonicalField, this.indexes.nodesByType);
    this.scheduleSave();
    return node;
  }

  // ── Edge mutations ─────────────────────────────────────────────────────────

  /**
   * Create a new edge or update an existing one (by weight and metadata).
   * Uses the edgeKey index for O(1) lookup — no full scan.
   */
  createOrUpdateEdge(
    from: string,
    to: string,
    type: EdgeType,
    weight: number,
    metadata?: EdgeMetadata
  ): GraphEdge {
    const key = edgeKey(from, to, type);
    const existingId = this.indexes.edgeKey.get(key);

    if (existingId) {
      const existing = this.edges.get(existingId);
      if (existing) {
        existing.weight = weight;
        existing.updatedAt = Date.now();
        if (metadata) {
          existing.metadata = { ...existing.metadata, ...metadata };
        }
        this.scheduleSave();
        return existing;
      }
    }

    const edge: GraphEdge = {
      id: generateEdgeId(),
      from,
      to,
      type,
      weight,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata,
    };

    this.edges.set(edge.id, edge);
    indexEdge(edge, this.indexes.edgesByFrom, this.indexes.edgesByTo, this.indexes.edgeKey);
    this.scheduleSave();
    return edge;
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  /**
   * Record that an answer was used. Increments usageCount, updates
   * lastUsedAt, and links the answer to the application if context provided.
   */
  recordAnswer(
    questionText: string,
    value: string,
    source: AnswerSource,
    canonicalField: string | undefined,
    context?: GraphJobContext,
    internal?: boolean
  ): void {
    if (!this.ready) return;

    const field = canonicalField && canonicalField !== 'unknown' ? canonicalField : undefined;
    const questionNode = this.upsertQuestionNode(questionText, field);
    const answerNode = this.upsertAnswerNode(value, field ?? '', source);

    // Mark as internal (debug) if requested — e.g. answers for unknown/junk fields
    if (internal) {
      questionNode.internal = true;
      answerNode.internal = true;
    }

    // Connect question to answer
    this.createOrUpdateEdge(questionNode.id, answerNode.id, 'ANSWERED_BY', 1.0);

    // Connect field to question via MAPS_TO — only when we have a real canonical field
    if (field) {
      const fieldNode = this.upsertFieldNode(field);
      this.createOrUpdateEdge(fieldNode.id, questionNode.id, 'MAPS_TO', 1.0);
    }

    // Update usage stats
    const payload = answerNode.payload as AnswerPayload;
    payload.usageCount++;
    payload.lastUsedAt = Date.now();
    answerNode.updatedAt = Date.now();

    // Link to application if context provided
    if (context?.company || context?.url) {
      const appId = this.findOrCreateApplicationNode(context);
      this.createOrUpdateEdge(answerNode.id, appId, 'USED_IN', 1.0);
    }

    // Cache the embedding if we have it
    const qId = questionNodeId(normalizeQuestion(questionText));
    if (!this.embeddingCache.has(qId)) {
      // Will be computed lazily on first similarity lookup
    }

    this.scheduleSave();
  }

  /**
   * Record a user correction.
   * Connects the Correction node to BOTH the question node AND the field node
   * so future lookups benefit even if question wording differs.
   */
  recordCorrection(
    questionText: string,
    canonicalField: string | undefined,
    originalValue: string,
    correctedValue: string,
    context: GraphJobContext
  ): void {
    if (!this.ready) return;
    if (!correctedValue.trim() || originalValue === correctedValue) return;

    const questionNode = this.upsertQuestionNode(questionText, canonicalField);

    const correctionNode: GraphNode = {
      id: correctionNodeId(),
      type: 'correction',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: {
        originalValue,
        correctedValue,
        context,
      } satisfies CorrectionPayload,
    };
    this.nodes.set(correctionNode.id, correctionNode);
    indexNode(correctionNode, this.indexes.questionByNormalizedText, this.indexes.fieldByCanonicalField, this.indexes.nodesByType);

    // Question --CORRECTED_TO--> Correction
    this.createOrUpdateEdge(questionNode.id, correctionNode.id, 'CORRECTED_TO', 1.0);

    // Field --CORRECTED_TO--> Correction (if we have a canonical field)
    if (canonicalField) {
      const fieldNode = this.upsertFieldNode(canonicalField);
      this.createOrUpdateEdge(fieldNode.id, correctionNode.id, 'CORRECTED_TO', 1.0);
    }

    // Also upsert the corrected value as a high-confidence answer
    const correctedAnswer = this.upsertAnswerNode(correctedValue, canonicalField ?? '', 'user', 'correction');
    this.createOrUpdateEdge(questionNode.id, correctedAnswer.id, 'ANSWERED_BY', 1.0);

    const payload = correctedAnswer.payload as AnswerPayload;
    payload.usageCount++;
    payload.lastUsedAt = Date.now();
    payload.confidence = 0.95;
    correctedAnswer.updatedAt = Date.now();

    console.log(`[Graph] Correction recorded — "${questionText}": "${originalValue}" → "${correctedValue}"`);
    this.scheduleSave();
  }

  /**
   * Reinforce or create a SIMILAR_TO relationship between two questions.
   * Stored in both directions.
   */
  reinforceSimilarity(questionId1: string, questionId2: string, score: number): void {
    if (!this.ready || questionId1 === questionId2) return;

    this.createOrUpdateEdge(questionId1, questionId2, 'SIMILAR_TO', score, {
      similarityScore: score,
    });
    this.createOrUpdateEdge(questionId2, questionId1, 'SIMILAR_TO', score, {
      similarityScore: score,
    });
  }

  /**
   * Store the embedding for a question node in the cache.
   * Called after computing an embedding to avoid re-computing next time.
   */
  cacheQuestionEmbedding(questionNodeId: string, embedding: number[]): void {
    this.embeddingCache.set(questionNodeId, embedding);
    this.scheduleEmbeddingCacheSave();
  }

  // ── Debug provenance ───────────────────────────────────────────────────────

  /**
   * Record why a field was filled. Called after every getBestAnswerForField()
   * resolution (including LLM and RL fills, not just graph fills).
   * Session-scoped — never persisted.
   */
  recordFillProvenance(label: string, record: FillProvenanceRecord): void {
    this.fillProvenance.set(normalizeQuestion(label), record);
  }

  /**
   * Retrieve the last fill provenance for a field label.
   * Used by the "Why was this filled?" debug panel.
   */
  getLastFillProvenance(label: string): FillProvenanceRecord | null {
    return this.fillProvenance.get(normalizeQuestion(label)) ?? null;
  }

  // ── Pruning ────────────────────────────────────────────────────────────────

  /**
   * Remove nodes and edges that no longer contribute value.
   * Called on initialize() and can be called periodically.
   */
  pruneGraph(): void {
    if (!this.ready) return;

    const now = Date.now();
    const toRemoveNodes: string[] = [];
    const toRemoveEdges: string[] = [];

    // Prune SIMILAR_TO edges with low weight
    for (const edge of this.edges.values()) {
      if (edge.type === 'SIMILAR_TO' && edge.weight < PRUNING.minSimilarityEdgeWeight) {
        toRemoveEdges.push(edge.id);
      }
    }

    for (const id of toRemoveEdges) {
      const edge = this.edges.get(id);
      if (edge) {
        deindexEdge(edge, this.indexes.edgesByFrom, this.indexes.edgesByTo, this.indexes.edgeKey);
        this.edges.delete(id);
      }
    }

    // Prune orphan answer nodes (no edges, zero usage, old enough)
    for (const node of this.nodes.values()) {
      if (
        node.type === 'answer' &&
        isOrphanNode(node.id, this.indexes) &&
        (node.payload as AnswerPayload).usageCount === 0 &&
        now - node.createdAt > PRUNING.orphanAnswerAgeMs
      ) {
        toRemoveNodes.push(node.id);
      }

      // Prune old application nodes with no referencing edges
      if (
        node.type === 'application' &&
        isOrphanNode(node.id, this.indexes) &&
        now - node.createdAt > PRUNING.applicationAgeMs
      ) {
        toRemoveNodes.push(node.id);
      }

      // Prune orphan question nodes (no edges, old enough)
      if (
        node.type === 'question' &&
        isOrphanNode(node.id, this.indexes) &&
        now - node.createdAt > PRUNING.orphanQuestionAgeMs
      ) {
        toRemoveNodes.push(node.id);
      }
    }

    for (const id of toRemoveNodes) {
      const node = this.nodes.get(id);
      if (node) {
        deindexNode(node, this.indexes.questionByNormalizedText, this.indexes.fieldByCanonicalField, this.indexes.nodesByType);
        this.nodes.delete(id);
      }
    }

    if (toRemoveNodes.length > 0 || toRemoveEdges.length > 0) {
      console.log(`[Graph] Pruned ${toRemoveNodes.length} nodes, ${toRemoveEdges.length} edges`);
      this.scheduleSave();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private findOrCreateApplicationNode(context: GraphJobContext): string {
    const existing = this.indexes.nodesByType.get('application') ?? [];
    for (const id of existing) {
      const n = this.nodes.get(id);
      if (!n) continue;
      const p = n.payload as ApplicationPayload;
      if (p.url === context.url || (p.company === context.company && p.jobTitle === context.jobTitle)) {
        return id;
      }
    }

    const id = applicationNodeId();
    const node: GraphNode = {
      id,
      type: 'application',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: {
        company: context.company ?? 'unknown',
        jobTitle: context.jobTitle ?? 'unknown',
        url: context.url ?? '',
        platform: context.platform,
      } satisfies ApplicationPayload,
    };
    this.nodes.set(id, node);
    indexNode(node, this.indexes.questionByNormalizedText, this.indexes.fieldByCanonicalField, this.indexes.nodesByType);
    return id;
  }

  /**
   * Seed the graph with known profile values for canonical fields.
   * Called once after resume parsing so the graph has data from day one
   * instead of needing a warm-up fill session first.
   *
   * Uses the canonical question text for each well-known field so the
   * entries will be matched by field-canonical and similarity lookups.
   */
  seedFromProfile(profileEntries: Array<{ canonicalField: string; questionText: string; value: string }>): void {
    if (!this.ready) return;

    let seeded = 0;
    for (const entry of profileEntries) {
      const { canonicalField, questionText, value } = entry;
      if (!value.trim()) continue;

      // Never create 'unknown' field nodes — they pollute the graph by acting as a
      // catch-all that connects unrelated questions to the same answers.
      if (!canonicalField || canonicalField === 'unknown') continue;

      const questionNode = this.upsertQuestionNode(questionText, canonicalField);

      // For long-form answers: skip if this question already has an answer with
      // the same value to prevent duplicate nodes on every background startup.
      const isLongForm =
        value.length > LONG_FORM_LENGTH_THRESHOLD || LONG_FORM_FIELDS.has(canonicalField);

      if (isLongForm) {
        const existingAnswerIds = this.indexes.edgesByFrom.get(questionNode.id) ?? [];
        const alreadyHasThisValue = existingAnswerIds.some(edgeId => {
          const edge = this.edges.get(edgeId);
          if (!edge || edge.type !== 'ANSWERED_BY') return false;
          const answerNode = this.nodes.get(edge.to);
          if (!answerNode) return false;
          return (answerNode.payload as AnswerPayload).value === value;
        });
        if (alreadyHasThisValue) continue;
      }

      const answerNode = this.upsertAnswerNode(value, canonicalField, 'profile');
      const fieldNode = this.upsertFieldNode(canonicalField);

      this.createOrUpdateEdge(fieldNode.id, questionNode.id, 'MAPS_TO', 1.0);
      this.createOrUpdateEdge(questionNode.id, answerNode.id, 'ANSWERED_BY', 1.0);

      seeded++;
    }

    if (seeded > 0) {
      console.log(`[Graph] Seeded ${seeded} profile entries into graph`);
      this.scheduleSave();
    }
  }

  // ── Stats (for debugging/popup) ────────────────────────────────────────────

  getStats(): { nodeCount: number; edgeCount: number; ready: boolean } {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      ready: this.ready,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const graphMemory = new GraphMemoryService();
