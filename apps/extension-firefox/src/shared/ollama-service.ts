/**
 * Ollama service for intelligent field analysis and matching
 */

export interface OllamaResponse {
  fields: Array<{
    fieldIndex: number;
    intent: string;
    suggestedValue: string;
    confidence: number;
    reasoning: string;
  }>;
}

export interface EmbeddingResponse {
  embedding: number[];
}

const OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Check if Ollama is available
 */
export async function checkOllamaConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.ok;
  } catch (err) {
    console.warn('Ollama not available:', err);
    return false;
  }
}

/**
 * Analyze unfilled fields using Ollama LLM
 */
export async function analyzeFieldsWithOllama(
  prompt: string,
  model: string = 'llama3.2'
): Promise<OllamaResponse | null> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json'
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Parse the JSON response from Ollama
    try {
      const parsed = JSON.parse(data.response);
      return parsed;
    } catch (e) {
      console.error('Failed to parse Ollama JSON response:', data.response);
      return null;
    }
  } catch (err) {
    console.error('Error calling Ollama:', err);
    return null;
  }
}

/**
 * Get embeddings for text using Ollama
 */
export async function getEmbedding(
  text: string,
  model: string = 'nomic-embed-text'
): Promise<number[] | null> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings API error: ${response.statusText}`);
    }

    const data: EmbeddingResponse = await response.json();
    return data.embedding;
  } catch (err) {
    console.error('Error getting embedding:', err);
    return null;
  }
}

/**
 * Get embeddings for multiple texts
 */
export async function getBatchEmbeddings(
  texts: string[],
  model: string = 'nomic-embed-text'
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();

  for (const text of texts) {
    const embedding = await getEmbedding(text, model);
    if (embedding) {
      embeddings.set(text, embedding);
    }
  }

  return embeddings;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Find best matching option using embeddings
 */
export async function findBestMatchWithEmbeddings(
  targetText: string,
  options: string[],
  threshold: number = 0.7
): Promise<{ option: string; similarity: number } | null> {
  // Get embedding for target
  const targetEmbedding = await getEmbedding(targetText);
  if (!targetEmbedding) return null;

  // Get embeddings for all options
  const optionEmbeddings = await Promise.all(
    options.map(async opt => ({
      option: opt,
      embedding: await getEmbedding(opt)
    }))
  );

  // Calculate similarities
  const similarities = optionEmbeddings
    .filter(item => item.embedding !== null)
    .map(item => ({
      option: item.option,
      similarity: cosineSimilarity(targetEmbedding, item.embedding!)
    }))
    .sort((a, b) => b.similarity - a.similarity);

  // Return best match if above threshold
  if (similarities.length > 0 && similarities[0].similarity >= threshold) {
    return similarities[0];
  }

  return null;
}

/**
 * Smart match for dropdown/select fields
 */
export async function smartMatchDropdown(
  fieldLabel: string,
  fieldOptions: string[],
  profileValue: string,
  context?: string
): Promise<string | null> {
  // Try exact match first
  const exactMatch = fieldOptions.find(
    opt => opt.toLowerCase() === profileValue.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Try partial match
  const partialMatch = fieldOptions.find(
    opt => opt.toLowerCase().includes(profileValue.toLowerCase()) ||
           profileValue.toLowerCase().includes(opt.toLowerCase())
  );
  if (partialMatch) return partialMatch;

  // Use embeddings for semantic matching
  const contextText = context 
    ? `${fieldLabel}: ${context}. User's value: ${profileValue}`
    : `${fieldLabel}. User's value: ${profileValue}`;

  const match = await findBestMatchWithEmbeddings(contextText, fieldOptions, 0.6);
  return match?.option || null;
}

/**
 * Use Ollama to infer appropriate value for a field.
 * When `onChunk` is provided, streams tokens as they arrive and calls
 * `onChunk(partialText)` on each token — enabling live field preview.
 */
export async function inferFieldValue(
  fieldLabel: string,
  fieldType: string,
  fieldContext: string,
  profileData: any,
  options?: string[],
  onChunk?: (partial: string) => void
): Promise<string | null> {
  // Detect if this is a long-form / textarea field that needs a paragraph response
  const labelLower = fieldLabel.toLowerCase();
  const isLongForm = fieldType === 'textarea' ||
    labelLower.includes('describe') || labelLower.includes('explain') ||
    labelLower.includes('tell us') || labelLower.includes('please share') ||
    labelLower.includes('why') || labelLower.includes('additional information') ||
    labelLower.includes('cover letter') || labelLower.includes('motivation') ||
    labelLower.includes('elaborate') || labelLower.includes('projects') ||
    labelLower.length > 80;

  let prompt: string;

  if (isLongForm) {
    prompt = `You are filling out a job application form for the candidate below. Write a direct, professional answer for this field.

FIELD: "${fieldLabel}"

CANDIDATE PROFILE:
${JSON.stringify(profileData, null, 2)}

RULES:
- Write the answer as if YOU are the candidate (first person: "I", "my", "me").
- Write 2-4 sentences that are specific and relevant to the question.
- DO NOT include any preamble, introduction, labels, or meta-commentary.
- DO NOT say things like "Here is my answer" or "Sure, here's a response".
- DO NOT wrap the answer in quotes.
- Just write the actual answer text directly.
- Use real newlines (press Enter) for paragraph breaks, not "\\n".

Answer:`;
  } else {
    prompt = `You are a job application assistant. Based on the candidate's profile, suggest the best value for this form field.

FIELD INFORMATION:
- Label: "${fieldLabel}"
- Type: ${fieldType}
- Context: "${fieldContext}"
${options ? `- Available options: ${options.join(', ')}` : ''}

CANDIDATE PROFILE:
${JSON.stringify(profileData, null, 2)}

Task: What is the most appropriate value for this field? ${options ? 'Choose from the available options.' : ''}

Respond with ONLY the value, nothing else. No quotes, no explanation, no preamble. If you cannot determine a good value, respond with "UNKNOWN".`;
  }

  try {
    const useStreaming = typeof onChunk === 'function';

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: useStreaming
      })
    });

    if (!response.ok) return null;

    let value: string;

    if (useStreaming && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        const text = decoder.decode(chunk, { stream: true });
        for (const line of text.split('\n').filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            if (obj.response) {
              accumulated += obj.response;
              // Stream the raw partial so the caller can show live progress;
              // full cleanup happens after generation finishes.
              onChunk!(accumulated);
            }
          } catch { /* partial JSON — ignore */ }
        }
      }

      value = accumulated.trim();
    } else {
      const data = await response.json();
      value = data.response?.trim() || '';
    }

    if (value === 'UNKNOWN' || !value) return null;

    // Post-process: clean up common LLM artifacts
    value = cleanLLMResponse(value, isLongForm);

    if (!value) return null;

    // If options provided, match to closest option
    if (options && options.length > 0) {
      return await smartMatchDropdown(fieldLabel, options, value, fieldContext);
    }

    return value;
  } catch (err) {
    console.error('Error inferring field value:', err);
    return null;
  }
}

/**
 * Clean up common LLM response artifacts:
 * - Strip preamble / meta-commentary
 * - Convert literal \n to actual newlines
 * - Remove surrounding quotes
 * - Remove "Answer:" or "Response:" prefixes
 */
function cleanLLMResponse(raw: string, isLongForm: boolean): string {
  let text = raw;

  // 1. Convert literal \n sequences to actual newlines
  text = text.replace(/\\n/g, '\n');

  // 2. Remove surrounding quotes (single or double)
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // 3. Strip common LLM preamble patterns (case-insensitive)
  const preamblePatterns = [
    /^here\s+is\s+(a\s+|my\s+|the\s+|an?\s+)?.*?:\s*/i,
    /^sure[,!.]?\s*(here\s*('s|is)\s+)?.*?:\s*/i,
    /^(okay|ok)[,!.]?\s*(here\s*('s|is)\s+)?.*?:\s*/i,
    /^(certainly|absolutely)[,!.]?\s*.*?:\s*/i,
    /^(below\s+is|the\s+following\s+is)\s+.*?:\s*/i,
    /^answer:\s*/i,
    /^response:\s*/i,
    /^value:\s*/i,
    /^my\s+answer:\s*/i,
  ];

  for (const pattern of preamblePatterns) {
    text = text.replace(pattern, '');
  }

  // 4. Remove surrounding quotes again (LLM might have quoted after preamble)
  text = text.trim();
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // 5. For short-field responses, collapse to single line
  if (!isLongForm) {
    text = text.replace(/\n+/g, ' ').trim();
  } else {
    // For long-form, normalize excessive newlines (>2 consecutive)
    text = text.replace(/\n{3,}/g, '\n\n').trim();
  }

  return text;
}
