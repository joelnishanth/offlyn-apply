export type ParseErrorKind = 'cors' | 'model-not-found' | 'offline' | 'generic';

/**
 * Classify an Ollama-related error string into a category so the UI can show
 * targeted troubleshooting guidance.
 *
 * Priority: model-not-found > cors > offline > generic
 */
export function classifyParseError(error: string): ParseErrorKind {
  if (/not found|404|model .* not found|pull llama/i.test(error)) {
    return 'model-not-found';
  }
  if (/403|Forbidden|CORS|blocking/i.test(error)) {
    return 'cors';
  }
  if (/not connected|ollama not connected|failed to fetch|network/i.test(error)) {
    return 'offline';
  }
  return 'generic';
}

/**
 * Enrich a raw error message from the Ollama API / parser with actionable
 * context so the user knows how to fix it.  Used by the background script
 * before sending the error back to the onboarding page.
 */
export function enrichParseErrorMessage(raw: string): string {
  if (/403|Forbidden/i.test(raw)) {
    return raw + " Ollama is blocking the extension. Restart Ollama with: OLLAMA_ORIGINS='chrome-extension://*' ollama serve";
  }
  if (/not found|404|model .* not found/i.test(raw)) {
    return (
      'Required AI model not found. Please install the models by running:\n' +
    'ollama pull llama3.2:1b\n' +
    'ollama pull nomic-embed-text'
    );
  }
  return raw;
}
