import type { PdfDocumentObject, PdfEngine } from '@embedpdf/models';
import { PdfInputError } from '../pdf/errors';
import type { PageImage } from './recognize';

/**
 * Rasterises pages so they can be recognized. Browser only — PDFium renders to
 * a Blob, and decoding one needs the platform's image pipeline.
 */

/**
 * Scale to render at, relative to the page's natural size.
 *
 * Tesseract wants roughly 300 DPI to read body text reliably, and PDF points
 * are 72 to the inch, so ~4x. Going higher costs recognition time quadratically
 * for very little accuracy.
 */
export const OCR_RENDER_SCALE = 4;

export interface RenderOptions {
  scale?: number;
  /** Called as each page finishes rasterising. */
  onProgress?: (completed: number, total: number) => void;
  /** Restricts the run to these zero-based page indices. Defaults to every page. */
  pageIndices?: readonly number[];
}

/**
 * Renders `pageIndices` of an already-open document to images.
 *
 * Image dimensions are read back from the decoded bitmap rather than predicted
 * from the page size and scale: PDFium applies the page's `/Rotate` itself, and
 * the text layer needs the size of the image that was *actually* recognized.
 */
export async function renderPagesForOcr(
  engine: PdfEngine,
  doc: PdfDocumentObject,
  options: RenderOptions = {},
): Promise<PageImage[]> {
  const scale = options.scale ?? OCR_RENDER_SCALE;
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new PdfInputError(`ocr: render scale must be a positive number, got ${String(scale)}`);
  }

  const indices = options.pageIndices ?? doc.pages.map((page) => page.index);
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= doc.pageCount) {
      throw new PdfInputError(
        `ocr: page index ${String(index)} is out of range for a ${String(doc.pageCount)}-page document`,
      );
    }
  }

  const images: PageImage[] = [];
  for (const [completed, index] of indices.entries()) {
    const page = doc.pages[index];
    if (!page) {
      throw new PdfInputError(`ocr: page ${String(index + 1)} is missing from the document`);
    }

    const blob = await engine
      .renderPage(doc, page, { scaleFactor: scale, dpr: 1, withAnnotations: false })
      .toPromise();

    // Decode only to measure, then release: the text layer needs the true pixel
    // size, but holding a decoded bitmap per page would keep a long document's
    // worth of pixels alive at once. Tesseract takes the Blob and decodes it
    // itself, one page at a time.
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();

    images.push({ pageIndex: index, width, height, image: blob });

    options.onProgress?.(completed + 1, indices.length);
  }
  return images;
}
