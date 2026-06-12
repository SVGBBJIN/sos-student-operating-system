/**
 * Shared pdf.js access — pdf.js is heavy (~400 kB), so it stays out of the
 * main bundle and loads on demand the first time a PDF is actually parsed.
 */

let pdfjsPromise = null;

export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url
      ).toString();
      return lib;
    });
  }
  return pdfjsPromise;
}

/**
 * extractPdfText — extracts plain text from a PDF File/Blob.
 * Pages are joined with blank lines; scanned/image-only PDFs yield ''.
 */
export async function extractPdfText(source, { maxPages = Infinity } = {}) {
  const lib = await loadPdfJs();
  const ab = await source.arrayBuffer();
  const pdf = await lib.getDocument({ data: ab }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  return pages.join('\n\n').trim();
}
