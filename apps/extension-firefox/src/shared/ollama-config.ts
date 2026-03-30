/**
 * Ollama configuration management
 * Centralises storage of endpoint, model names, and enabled state.
 */

export interface OllamaConfig {
  endpoint: string;
  chatModel: string;
  embeddingModel: string;
  lastChecked: number;
  enabled: boolean;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  endpoint: 'http://localhost:11434',
  chatModel: 'llama3.2',
  embeddingModel: 'nomic-embed-text',
  lastChecked: 0,
  enabled: false,
};

const STORAGE_KEY = 'ollamaConfig';

export async function getOllamaConfig(): Promise<OllamaConfig> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      return { ...DEFAULT_OLLAMA_CONFIG, ...stored } as OllamaConfig;
    }
  } catch (err) {
    console.warn('[OllamaConfig] Failed to load config, using defaults:', err);
  }
  return { ...DEFAULT_OLLAMA_CONFIG };
}

export async function saveOllamaConfig(config: OllamaConfig): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: config });
}

export async function isOllamaEnabled(): Promise<boolean> {
  const config = await getOllamaConfig();
  return config.enabled;
}

export interface ConnectionTestResult {
  success: boolean;
  version?: string;
  /** Ollama reachable but POST requests blocked by CORS (need OLLAMA_ORIGINS) */
  corsBlocked?: boolean;
  error?: string;
}

export async function testOllamaConnection(endpoint: string): Promise<ConnectionTestResult> {
  // Step 1: Basic reachability check via GET /api/version (simple request, no CORS preflight)
  let version: string;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${endpoint}/api/version`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    version = data.version || 'unknown';
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') return { success: false, error: 'Connection timed out' };
      return { success: false, error: err.message };
    }
    return { success: false, error: 'Connection failed' };
  }

  // Step 2: CORS check — POST with Content-Type: application/json triggers preflight.
  // If Ollama returns 403, the moz-extension:// origin isn't in its allowed list.
  // If Ollama returns anything else (even 400/500), CORS is working fine.
  try {
    const corsController = new AbortController();
    const corsTimeoutId = setTimeout(() => corsController.abort(), 5000);

    const corsResponse = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: '', prompt: '', stream: false }),
      signal: corsController.signal,
    });

    clearTimeout(corsTimeoutId);

    if (corsResponse.status === 403) {
      return {
        success: true,
        version,
        corsBlocked: true,
        error: 'Origin blocked — Ollama is not allowing requests from this extension',
      };
    }
    // Any other status (400 bad request, 200, 500…) means CORS is fine
  } catch (corsErr) {
    // A network-level error here (TypeError: NetworkError) usually means CORS preflight was rejected
    const msg = corsErr instanceof Error ? corsErr.message : '';
    // 'Failed to fetch' / 'NetworkError' = CORS rejection by browser before 403 even arrives
    if (corsErr instanceof Error && corsErr.name !== 'AbortError') {
      return {
        success: true,
        version,
        corsBlocked: true,
        error: `CORS preflight rejected: ${msg}`,
      };
    }
    // AbortError = timeout; treat as "unknown", don't flag corsBlocked
  }

  return { success: true, version };
}
