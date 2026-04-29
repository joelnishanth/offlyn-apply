import { describe, it, expect } from 'vitest';
import type { PdfDocument } from './pdf-extract';
import { extractPagesText } from './pdf-extract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPdf(pages: string[][]): PdfDocument {
  return {
    numPages: pages.length,
    getPage: async (num: number) => ({
      getTextContent: async () => ({
        items: pages[num - 1].map((str) => ({ str })),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// extractPagesText
// ---------------------------------------------------------------------------

describe('extractPagesText', () => {
  it('joins text items from a single page', async () => {
    const pdf = makeMockPdf([['Alice', 'Smith', 'alice@example.com']]);
    const text = await extractPagesText(pdf);
    expect(text).toBe('Alice Smith alice@example.com');
  });

  it('concatenates text from multiple pages', async () => {
    const pdf = makeMockPdf([['Page one content'], ['Page two content']]);
    const text = await extractPagesText(pdf);
    expect(text).toContain('Page one content');
    expect(text).toContain('Page two content');
  });

  it('returns empty string for a PDF with no text items', async () => {
    const pdf = makeMockPdf([[]]);
    const text = await extractPagesText(pdf);
    expect(text).toBe('');
  });

  it('handles a multi-page resume with varied content', async () => {
    const pdf = makeMockPdf([
      ['John Doe', ' ', 'Software Engineer'],
      ['Experience:', ' ', 'Company A', ' - ', '2020-2024'],
      ['Education:', ' ', 'MIT', ' ', 'BS CS'],
    ]);
    const text = await extractPagesText(pdf);
    expect(text).toContain('John Doe');
    expect(text).toContain('Company A');
    expect(text).toContain('MIT');
    expect(pdf.numPages).toBe(3);
  });
});
