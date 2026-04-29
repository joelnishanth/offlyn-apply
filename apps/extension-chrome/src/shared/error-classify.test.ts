import { describe, it, expect } from 'vitest';
import { classifyParseError, enrichParseErrorMessage } from './error-classify';

// ---------------------------------------------------------------------------
// classifyParseError
// ---------------------------------------------------------------------------

describe('classifyParseError', () => {
  // ── model-not-found ─────────────────────────────────────────────────────

  it('detects bare "Not Found" (HTTP 404 statusText)', () => {
    expect(classifyParseError('Not Found')).toBe('model-not-found');
  });

  it('detects "404" status code in message', () => {
    expect(classifyParseError('HTTP 404')).toBe('model-not-found');
  });

  it('detects Ollama "model X not found" phrasing', () => {
    expect(classifyParseError('model "llama3.2" not found')).toBe('model-not-found');
  });

  it('detects enriched message containing "pull llama"', () => {
    expect(
      classifyParseError(
        'Required AI model not found. Please install the models by running:\nollama pull llama3.2',
      ),
    ).toBe('model-not-found');
  });

  // ── cors ─────────────────────────────────────────────────────────────────

  it('detects "403" CORS error', () => {
    expect(classifyParseError('HTTP 403')).toBe('cors');
  });

  it('detects "Forbidden" CORS error', () => {
    expect(classifyParseError('Forbidden')).toBe('cors');
  });

  it('detects explicit "CORS" mention', () => {
    expect(classifyParseError('CORS policy blocked the request')).toBe('cors');
  });

  it('detects "blocking" keyword', () => {
    expect(classifyParseError('Ollama is blocking the extension')).toBe('cors');
  });

  // ── offline ──────────────────────────────────────────────────────────────

  it('detects "not connected" error', () => {
    expect(classifyParseError('Ollama not connected')).toBe('offline');
  });

  it('detects "Failed to fetch" (network down)', () => {
    expect(classifyParseError('Failed to fetch')).toBe('offline');
  });

  it('detects "NetworkError" style message', () => {
    expect(classifyParseError('A network error occurred')).toBe('offline');
  });

  // ── generic ──────────────────────────────────────────────────────────────

  it('falls back to generic for unknown errors', () => {
    expect(classifyParseError('Something unexpected happened')).toBe('generic');
  });

  it('falls back to generic for empty string', () => {
    expect(classifyParseError('')).toBe('generic');
  });

  // ── priority: model-not-found > cors > offline ──────────────────────────

  it('prioritises model-not-found over offline when both keywords present', () => {
    // Unlikely but defensive: "not connected" + "not found" → model-not-found wins
    expect(classifyParseError('not found, also not connected')).toBe('model-not-found');
  });
});

// ---------------------------------------------------------------------------
// enrichParseErrorMessage
// ---------------------------------------------------------------------------

describe('enrichParseErrorMessage', () => {
  it('enriches "Not Found" with model pull instructions', () => {
    const enriched = enrichParseErrorMessage('Not Found');
    expect(enriched).toContain('ollama pull llama3.2');
    expect(enriched).toContain('ollama pull nomic-embed-text');
  });

  it('enriches "404" with model pull instructions', () => {
    const enriched = enrichParseErrorMessage('HTTP 404');
    expect(enriched).toContain('ollama pull llama3.2');
  });

  it('enriches "model X not found" with pull instructions', () => {
    const enriched = enrichParseErrorMessage('model "llama3.2" not found, try pulling it first');
    expect(enriched).toContain('ollama pull llama3.2');
  });

  it('enriches "403" with CORS restart instructions', () => {
    const enriched = enrichParseErrorMessage('HTTP 403 Forbidden');
    expect(enriched).toContain('OLLAMA_ORIGINS');
    expect(enriched).toContain('chrome-extension');
  });

  it('enriches "Forbidden" with CORS instructions', () => {
    const enriched = enrichParseErrorMessage('Forbidden');
    expect(enriched).toContain('OLLAMA_ORIGINS');
  });

  it('passes through unrecognised errors unchanged', () => {
    const msg = 'Some random parsing failure';
    expect(enrichParseErrorMessage(msg)).toBe(msg);
  });

  it('passes through empty string unchanged', () => {
    expect(enrichParseErrorMessage('')).toBe('');
  });
});
