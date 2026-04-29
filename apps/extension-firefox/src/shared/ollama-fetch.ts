/**
 * Fetch wrapper for Ollama API calls.
 *
 * CORS is handled at install time by the Offlyn AI Setup installer, which
 * configures OLLAMA_ORIGINS to accept the extension's origin. All requests
 * (GET and POST) go through fetch() directly.
 *
 * This thin wrapper exists so every call site uses a single function,
 * making it easy to add error handling, retry logic, or telemetry later.
 */
export async function ollamaFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}
