/**
 * Vector search utilities for semantic resume queries
 * Uses embeddings stored in browser storage
 */

import browser from './browser-compat';

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Search for most relevant chunks based on query embedding
 */
export async function searchResumeChunks(
  queryEmbedding: number[],
  topK: number = 3
): Promise<Array<{ text: string; similarity: number }>> {
  try {
    // Get stored embeddings from browser storage
    const data = await browser.storage.local.get(['resume_embeddings']);
    const embeddings = data.resume_embeddings || [];
    
    if (embeddings.length === 0) {
      console.warn('[VectorSearch] No embeddings found in storage');
      return [];
    }
    
    // Calculate similarity for each chunk
    const results = embeddings.map((chunk: any) => ({
      text: chunk.text,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));
    
    // Sort by similarity (highest first) and return top K
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, topK);
  } catch (err) {
    console.error('[VectorSearch] Search failed:', err);
    return [];
  }
}

/**
 * Get all stored resume chunks
 */
export async function getResumeChunks(): Promise<string[]> {
  try {
    const data = await browser.storage.local.get(['resume_chunks']);
    return data.resume_chunks || [];
  } catch (err) {
    console.error('[VectorSearch] Failed to get chunks:', err);
    return [];
  }
}

/**
 * Clear stored embeddings and chunks
 */
export async function clearResumeEmbeddings(): Promise<void> {
  try {
    await browser.storage.local.remove(['resume_embeddings', 'resume_chunks']);
    console.log('[VectorSearch] Cleared embeddings and chunks');
  } catch (err) {
    console.error('[VectorSearch] Failed to clear embeddings:', err);
  }
}

/**
 * Get storage stats
 */
export async function getEmbeddingStats(): Promise<{
  chunkCount: number;
  totalSize: number;
  hasEmbeddings: boolean;
}> {
  try {
    const data = await browser.storage.local.get(['resume_embeddings', 'resume_chunks']);
    const embeddings = data.resume_embeddings || [];
    const chunks = data.resume_chunks || [];
    
    // Estimate storage size
    const jsonStr = JSON.stringify(data);
    const sizeInBytes = new Blob([jsonStr]).size;
    
    return {
      chunkCount: chunks.length,
      totalSize: sizeInBytes,
      hasEmbeddings: embeddings.length > 0,
    };
  } catch (err) {
    console.error('[VectorSearch] Failed to get stats:', err);
    return {
      chunkCount: 0,
      totalSize: 0,
      hasEmbeddings: false,
    };
  }
}
