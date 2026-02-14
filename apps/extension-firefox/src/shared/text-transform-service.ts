/**
 * Text Transform Service — uses Ollama to rewrite selected text.
 *
 * Actions:
 *   professional-fix  — fix grammar, tone, and make it polished
 *   expand            — elaborate on the text with more detail
 *   shorten           — condense the text while keeping key points
 */

const OLLAMA_BASE_URL = 'http://localhost:11434';

export type TransformAction = 'professional-fix' | 'expand' | 'shorten';

/**
 * Transform selected text using Ollama.
 * Returns the rewritten text, or null on failure.
 */
export async function transformText(
  text: string,
  action: TransformAction
): Promise<string | null> {
  const prompt = buildPrompt(text, action);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      console.error('[TextTransform] Ollama API error:', response.statusText);
      return null;
    }

    const data = await response.json();
    let result = (data.response || '').trim();

    if (!result) return null;

    // Clean common LLM artifacts
    result = cleanResponse(result, action);

    return result || null;
  } catch (err) {
    console.error('[TextTransform] Error:', err);
    return null;
  }
}

/**
 * Build the Ollama prompt for a given action.
 */
function buildPrompt(text: string, action: TransformAction): string {
  switch (action) {
    case 'professional-fix':
      return `You are a professional writing editor. Rewrite the following text to be polished, grammatically correct, and professional in tone. Keep the same meaning and key details. Do NOT add any preamble or explanation — output ONLY the rewritten text.

Text to fix:
"""
${text}
"""

Rewritten text:`;

    case 'expand':
      return `You are a professional writing assistant. Expand the following text with more detail, examples, or elaboration. Keep the same tone, style, and first-person perspective. Aim for roughly 2-3x the original length. Do NOT add any preamble or explanation — output ONLY the expanded text.

Text to expand:
"""
${text}
"""

Expanded text:`;

    case 'shorten':
      return `You are a professional writing editor. Shorten the following text to be more concise while preserving all key points and meaning. Aim for roughly half the original length. Do NOT add any preamble or explanation — output ONLY the shortened text.

Text to shorten:
"""
${text}
"""

Shortened text:`;
  }
}

/**
 * Strip common LLM response artifacts.
 */
function cleanResponse(raw: string, action: TransformAction): string {
  let text = raw;

  // Convert literal \n to real newlines
  text = text.replace(/\\n/g, '\n');

  // Remove surrounding quotes
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // Strip common preamble patterns
  const preambles = [
    /^here\s+(is|are)\s+(the\s+)?(rewritten|expanded|shortened|revised|updated|condensed|polished).*?:\s*/i,
    /^sure[,!.]?\s*(here\s*('s|is)\s+)?.*?:\s*/i,
    /^(okay|ok)[,!.]?\s*.*?:\s*/i,
    /^(certainly|absolutely)[,!.]?\s*.*?:\s*/i,
    /^(rewritten|expanded|shortened|revised|condensed)\s*(text|version)?:\s*/i,
  ];

  for (const p of preambles) {
    text = text.replace(p, '');
  }

  // Remove trailing explanations ("I hope this..." / "Let me know...")
  text = text.replace(/\n+(I hope|Let me know|Feel free|Is there anything|Would you like).*$/is, '');

  // Remove surrounding quotes again
  text = text.trim();
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // Normalize excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
