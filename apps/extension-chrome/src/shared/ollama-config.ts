/**
 * Ollama configuration management
 * Centralises storage of endpoint, model names, and enabled state.
 */

import browser from './browser-compat';

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
  // All Ollama calls now route through the background script (OLLAMA_PROXY),
  // so the CORS POST probe is no longer needed. A simple GET /api/version
  // suffices to confirm reachability.
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
    const version = data.version || 'unknown';
    return { success: true, version };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') return { success: false, error: 'Connection timed out' };
      return { success: false, error: err.message };
    }
    return { success: false, error: 'Connection failed' };
  }
}
