/**
 * PDF text extraction helpers.
 *
 * pdf.js is loaded via <script> tags in the host page:
 *   1. pdf.worker.min.js – sets globalThis.pdfjsWorker (main-thread handler)
 *   2. pdf.min.js         – the main library (reads the handler automatically)
 *
 * Because Firefox blocks Web Worker creation in store-installed extensions,
 * we never set workerSrc. pdf.js detects globalThis.pdfjsWorker and runs
 * everything on the main thread, which is fine for small resume PDFs.
 */

export interface PdfjsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
}

export interface PdfDocument {
  numPages: number;
  getPage(num: number): Promise<{
    getTextContent(): Promise<{ items: { str: string }[] }>;
    getAnnotations(): Promise<Array<{ subtype?: string; url?: string }>>;
  }>;
}

export async function extractPagesText(pdf: PdfDocument): Promise<string> {
  let fullText = '';
  const linkUrls = new Set<string>();
  const totalPages = pdf.numPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(' ');
    fullText += pageText + '\n\n';

    try {
      const annotations = await page.getAnnotations();
      for (const annot of annotations) {
        if (annot.subtype === 'Link' && annot.url) {
          linkUrls.add(annot.url);
        }
      }
    } catch {
      // getAnnotations may not be available in all pdf.js builds
    }
  }

  if (linkUrls.size > 0) {
    const relevant = Array.from(linkUrls).filter(
      (u) => /linkedin\.com|github\.com|github\.io|portfolio|mailto:/i.test(u)
    );
    if (relevant.length > 0) {
      fullText += '\n\nEmbedded links found in document:\n' + relevant.join('\n');
    }
  }

  return fullText.trim();
}
