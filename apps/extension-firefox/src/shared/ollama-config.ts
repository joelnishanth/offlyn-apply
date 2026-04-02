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
  // Route through background script to avoid CORS issues on Firefox extension pages
  try {
    const result = await browser.runtime.sendMessage({ kind: 'TEST_OLLAMA_CONNECTION', endpoint });
    return result as ConnectionTestResult;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
