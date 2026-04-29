/**
 * Ollama service for intelligent field analysis and matching.
 * All calls route through the background script via OLLAMA_PROXY to avoid CORS.
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

const getBrowser = () => (globalThis as any).chrome ?? (globalThis as any).browser;

async function ollamaProxy(method: string, path: string, body?: any): Promise<any> {
  const b = getBrowser();
  if (!b?.runtime?.sendMessage) {
    throw new Error('Extension runtime not available');
  }
  const resp = await b.runtime.sendMessage({ kind: 'OLLAMA_PROXY', method, path, body });
  if (!resp?.ok) {
    throw new Error(resp?.error || `Ollama request failed: ${method} ${path}`);
  }
  return resp.data;
}

/**
 * Check if Ollama is available.
 * Routes through the background script to avoid CORS blocks on job sites.
 */
export async function checkOllamaConnection(): Promise<boolean> {
  try {
    const b = getBrowser();
    if (b?.runtime?.sendMessage) {
      const resp = await b.runtime.sendMessage({ kind: 'CHECK_OLLAMA' });
      return !!resp?.connected;
    }
    return false;
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
    const data = await ollamaProxy('POST', '/api/generate', {
      model,
      prompt,
      stream: false,
      format: 'json',
    });

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
    const data: EmbeddingResponse = await ollamaProxy('POST', '/api/embeddings', {
      model,
      prompt: text,
    });
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
    // Long-form fields use port-based streaming for live preview
    if (isLongForm && onChunk) {
      const b = getBrowser();
      if (b?.runtime?.connect) {
        return await new Promise<string | null>((resolve) => {
          const port = b.runtime.connect({ name: 'field-inference' });
          let fullValue = '';

          port.postMessage({ prompt, model: 'llama3.2', fieldLabel });

          port.onMessage.addListener((msg: any) => {
            if (msg.kind === 'chunk') {
              fullValue += msg.text;
              onChunk(cleanLLMResponse(fullValue, true));
            } else if (msg.kind === 'done') {
              const cleaned = cleanLLMResponse(msg.value || fullValue, true);
              port.disconnect();
              resolve(cleaned || null);
            } else if (msg.kind === 'error') {
              port.disconnect();
              resolve(null);
            }
          });

          port.onDisconnect.addListener(() => {
            if (fullValue) {
              resolve(cleanLLMResponse(fullValue, true) || null);
            } else {
              resolve(null);
            }
          });
        });
      }
    }

    // Short fields and fallback: non-streaming proxy
    const data = await ollamaProxy('POST', '/api/generate', {
      model: 'llama3.2',
      prompt,
      stream: false,
    });

    let value: string = data?.response?.trim() || '';

    if (value === 'UNKNOWN' || !value) return null;

    value = cleanLLMResponse(value, isLongForm);

    if (!value) return null;

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
