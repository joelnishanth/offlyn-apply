/**
 * Graph Memory Layer — Schema Migrations
 *
 * Safe, incremental schema upgrades. New migrations are added here as the
 * graph schema evolves. Each migration receives the raw loaded data and
 * returns (potentially transformed) nodes/edges.
 */

import { CURRENT_SCHEMA_VERSION } from './constants';
import type { GraphMeta, PersistedEdges, PersistedNodes } from './types';

export interface MigrationInput {
  nodes: PersistedNodes;
  edges: PersistedEdges;
  meta: GraphMeta;
}

/**
 * Run all pending migrations in order.
 * Returns the (possibly transformed) data and an updated meta.
 */
export function runMigrations(input: MigrationInput): MigrationInput {
  let { nodes, edges, meta } = input;
  const currentVersion = meta.schemaVersion ?? 0;

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return input;
  }

  console.log(`[Graph] Running migrations from v${currentVersion} to v${CURRENT_SCHEMA_VERSION}`);

  // v0 → v1: Initial schema — data shape is already correct, just stamp the version.
  if (currentVersion < 1) {
    meta = {
      ...meta,
      schemaVersion: 1,
      migrationHistory: [
        ...(meta.migrationHistory ?? []),
        { version: 1, timestamp: Date.now() },
      ],
    };
    console.log('[Graph] Migration v0 → v1 complete');
  }

  // Future migrations:
  // if (currentVersion < 2) { ... }

  return { nodes, edges, meta };
}

/**
 * Build a fresh GraphMeta, optionally reconstructed from actual data when
 * the stored meta is missing or inconsistent.
 */
export function buildMeta(
  nodes: PersistedNodes,
  edges: PersistedEdges,
  existing?: Partial<GraphMeta>
): GraphMeta {
  return {
    schemaVersion: existing?.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    lastUpdated: existing?.lastUpdated ?? Date.now(),
    nodeCount: Object.keys(nodes).length,
    edgeCount: Object.keys(edges).length,
    migrationHistory: existing?.migrationHistory ?? [],
  };
}
