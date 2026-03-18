/**
 * Graph Memory Layer — Storage
 *
 * Loads and saves graph state to browser.storage.local using Record<id, T>
 * shapes (not arrays) for incremental updates and efficient defensive loading.
 *
 * Firefox-specific: never uses browser.storage.local.get(null) — always
 * passes explicit key arrays.
 */

import browser from '../browser-compat';
import { GRAPH_STORAGE_KEYS } from './constants';
import { buildMeta, runMigrations } from './migrations';
import type {
  GraphEdge,
  GraphMeta,
  GraphNode,
  PersistedEmbeddingCache,
  PersistedEdges,
  PersistedNodes,
} from './types';

// ── Validators ────────────────────────────────────────────────────────────────

function isValidNode(value: unknown): value is GraphNode {
  if (!value || typeof value !== 'object') return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.type === 'string' &&
    typeof n.createdAt === 'number' &&
    typeof n.updatedAt === 'number' &&
    n.payload !== null &&
    typeof n.payload === 'object'
  );
}

function isValidEdge(value: unknown): value is GraphEdge {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.from === 'string' &&
    typeof e.to === 'string' &&
    typeof e.type === 'string' &&
    typeof e.weight === 'number' &&
    typeof e.createdAt === 'number' &&
    typeof e.updatedAt === 'number'
  );
}

// ── Load ──────────────────────────────────────────────────────────────────────

export interface LoadedGraphState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  meta: GraphMeta;
}

/**
 * Load the full graph state from browser.storage.local.
 *
 * Defensive behavior:
 * - Skips corrupt node/edge entries without throwing
 * - Reconstructs meta if missing or if counts disagree with actual data
 * - Treats missing schema version as v0 and runs migrations
 * - Returns an empty initialized graph if nothing is stored
 */
export async function loadGraphState(): Promise<LoadedGraphState> {
  let rawNodes: PersistedNodes = {};
  let rawEdges: PersistedEdges = {};
  let rawMeta: Partial<GraphMeta> | null = null;

  try {
    const stored = await browser.storage.local.get([
      GRAPH_STORAGE_KEYS.nodes,
      GRAPH_STORAGE_KEYS.edges,
      GRAPH_STORAGE_KEYS.meta,
    ]);

    if (stored[GRAPH_STORAGE_KEYS.nodes] && typeof stored[GRAPH_STORAGE_KEYS.nodes] === 'object') {
      rawNodes = stored[GRAPH_STORAGE_KEYS.nodes] as PersistedNodes;
    }
    if (stored[GRAPH_STORAGE_KEYS.edges] && typeof stored[GRAPH_STORAGE_KEYS.edges] === 'object') {
      rawEdges = stored[GRAPH_STORAGE_KEYS.edges] as PersistedEdges;
    }
    if (stored[GRAPH_STORAGE_KEYS.meta] && typeof stored[GRAPH_STORAGE_KEYS.meta] === 'object') {
      rawMeta = stored[GRAPH_STORAGE_KEYS.meta] as Partial<GraphMeta>;
    }
  } catch (err) {
    console.warn('[Graph] Storage read failed, initializing empty graph:', err);
    return buildEmptyState();
  }

  // Validate and sanitize each entry — skip corrupt records
  const validNodes: PersistedNodes = {};
  for (const [id, node] of Object.entries(rawNodes)) {
    if (isValidNode(node) && node.id === id) {
      validNodes[id] = node;
    } else {
      console.warn(`[Graph] Skipping corrupt node "${id}"`);
    }
  }

  const validEdges: PersistedEdges = {};
  for (const [id, edge] of Object.entries(rawEdges)) {
    if (isValidEdge(edge) && edge.id === id) {
      validEdges[id] = edge;
    } else {
      console.warn(`[Graph] Skipping corrupt edge "${id}"`);
    }
  }

  // Reconstruct meta if missing or if counts disagree with actual data
  let meta: GraphMeta;
  if (!rawMeta) {
    console.log('[Graph] graph_meta missing — reconstructing from data');
    meta = buildMeta(validNodes, validEdges, { schemaVersion: 0 });
  } else {
    const actualNodeCount = Object.keys(validNodes).length;
    const actualEdgeCount = Object.keys(validEdges).length;
    if (rawMeta.nodeCount !== actualNodeCount || rawMeta.edgeCount !== actualEdgeCount) {
      console.log('[Graph] Meta counts mismatch actual data — trusting actual data');
      meta = buildMeta(validNodes, validEdges, rawMeta);
    } else {
      meta = buildMeta(validNodes, validEdges, rawMeta);
    }
  }

  // Run migrations if needed
  const migrated = runMigrations({ nodes: validNodes, edges: validEdges, meta });

  // Build in-memory maps
  const nodes = new Map<string, GraphNode>(Object.entries(migrated.nodes));
  const edges = new Map<string, GraphEdge>(Object.entries(migrated.edges));

  console.log(`[Graph] Loaded ${nodes.size} nodes, ${edges.size} edges (schema v${migrated.meta.schemaVersion})`);

  return { nodes, edges, meta: migrated.meta };
}

function buildEmptyState(): LoadedGraphState {
  return {
    nodes: new Map(),
    edges: new Map(),
    meta: buildMeta({}, {}),
  };
}

// ── Eviction ──────────────────────────────────────────────────────────────────

const MAX_GRAPH_NODES = 400;
const MAX_GRAPH_EDGES = 800;

/**
 * Prune the graph in-place when it exceeds size limits.
 *
 * Eviction order for nodes:
 *   1. `internal` nodes (housekeeping) — lowest priority
 *   2. Low-weight answer nodes (confidence < 0.3)
 *   3. Oldest nodes by updatedAt
 *
 * Edges whose from/to node no longer exists are removed automatically.
 */
function pruneGraphIfNeeded(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>
): void {
  if (nodes.size <= MAX_GRAPH_NODES && edges.size <= MAX_GRAPH_EDGES) return;

  if (nodes.size > MAX_GRAPH_NODES) {
    const sorted = Array.from(nodes.entries()).sort(([, a], [, b]) => {
      // Internal nodes are lowest priority
      const aInternal = a.internal ? 0 : 1;
      const bInternal = b.internal ? 0 : 1;
      if (aInternal !== bInternal) return aInternal - bInternal;
      // Low-confidence answer nodes next
      const aConf = (a.payload as any).confidence ?? 1;
      const bConf = (b.payload as any).confidence ?? 1;
      if (Math.abs(aConf - bConf) > 0.05) return aConf - bConf;
      // Oldest last-updated last
      return a.updatedAt - b.updatedAt;
    });

    for (const [id] of sorted.slice(0, nodes.size - MAX_GRAPH_NODES)) {
      nodes.delete(id);
    }
    console.log(`[Graph] Evicted nodes — keeping ${nodes.size}`);
  }

  // Remove dangling edges
  const validNodeIds = new Set(nodes.keys());
  let edgesRemoved = 0;
  for (const [id, edge] of edges) {
    if (!validNodeIds.has(edge.from) || !validNodeIds.has(edge.to)) {
      edges.delete(id);
      edgesRemoved++;
    }
  }

  // If still over limit, remove lowest-weight edges
  if (edges.size > MAX_GRAPH_EDGES) {
    const sortedEdges = Array.from(edges.entries()).sort(([, a], [, b]) => a.weight - b.weight);
    for (const [id] of sortedEdges.slice(0, edges.size - MAX_GRAPH_EDGES)) {
      edges.delete(id);
    }
    console.log(`[Graph] Evicted edges — keeping ${edges.size}`);
  }

  if (edgesRemoved > 0) {
    console.log(`[Graph] Removed ${edgesRemoved} dangling edges`);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Persist the full graph state to browser.storage.local.
 * Converts in-memory Maps back to Record shapes before writing.
 * Prunes the graph to stay within size limits before persisting.
 */
export async function saveGraphState(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>
): Promise<void> {
  pruneGraphIfNeeded(nodes, edges);

  const persistedNodes: PersistedNodes = Object.fromEntries(nodes);
  const persistedEdges: PersistedEdges = Object.fromEntries(edges);
  const meta: GraphMeta = buildMeta(persistedNodes, persistedEdges, {
    schemaVersion: 1,
    lastUpdated: Date.now(),
  });

  try {
    await browser.storage.local.set({
      [GRAPH_STORAGE_KEYS.nodes]: persistedNodes,
      [GRAPH_STORAGE_KEYS.edges]: persistedEdges,
      [GRAPH_STORAGE_KEYS.meta]: meta,
    });
  } catch (err) {
    console.error('[Graph] Save failed:', err);
  }
}

// ── Embedding cache ───────────────────────────────────────────────────────────

/**
 * Load the embedding cache from browser.storage.local.
 * Returns an empty Map if nothing is stored.
 */
export async function loadEmbeddingCache(): Promise<Map<string, number[]>> {
  try {
    const stored = await browser.storage.local.get([GRAPH_STORAGE_KEYS.embeddingCache]);
    const raw = stored[GRAPH_STORAGE_KEYS.embeddingCache];

    if (raw && typeof raw === 'object') {
      const cache = new Map<string, number[]>();
      for (const [id, vec] of Object.entries(raw as PersistedEmbeddingCache)) {
        if (Array.isArray(vec)) {
          cache.set(id, vec as number[]);
        }
      }
      console.log(`[Graph] Loaded ${cache.size} cached embeddings`);
      return cache;
    }
  } catch (err) {
    console.warn('[Graph] Failed to load embedding cache:', err);
  }
  return new Map();
}

const MAX_EMBEDDING_CACHE = 150;

/**
 * Persist the embedding cache to browser.storage.local.
 * Caps the cache at MAX_EMBEDDING_CACHE entries (drops oldest keys first).
 */
export async function saveEmbeddingCache(cache: Map<string, number[]>): Promise<void> {
  let toPersist = cache;

  if (cache.size > MAX_EMBEDDING_CACHE) {
    const entries = Array.from(cache.entries());
    // Keep the most recently added entries (tail of insertion order)
    const trimmed = entries.slice(entries.length - MAX_EMBEDDING_CACHE);
    toPersist = new Map(trimmed);
    console.log(`[Graph] Embedding cache trimmed to ${MAX_EMBEDDING_CACHE} entries`);
  }

  try {
    const persisted: PersistedEmbeddingCache = Object.fromEntries(toPersist);
    await browser.storage.local.set({
      [GRAPH_STORAGE_KEYS.embeddingCache]: persisted,
    });
  } catch (err) {
    console.error('[Graph] Embedding cache save failed:', err);
  }
}
