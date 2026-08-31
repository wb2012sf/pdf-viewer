import type { PdfEngine } from '@embedpdf/models';
import { PdfInputError, assertPdfBytes } from '../pdf/errors';
import { recognizePages } from './recognize';
import { renderPagesForOcr } from './render';
import { applyTextLayer, type TextLayerReport } from './text-layer';

/**
 * The three OCR stages, in order, reported as they run.
 *
 * OCR is slow enough that a UI has to say which part is slow — rasterising a
 * page and recognizing it have very different durations, and a single
 * percentage would hide that.
 */
export type OcrStage = 'rendering' | 'recognizing' | 'writing';

export interface OcrProgress {
  stage: OcrStage;
  completed: number;
  total: number;
}

export interface MakeSearchableOptions {
  language?: string;
  /** Render scale relative to the page's natural size. */
  scale?: number;
  minConfidence?: number;
  pageIndices?: readonly number[];
  onProgress?: (progress: OcrProgress) => void;
  signal?: AbortSignal;
}

export interface SearchableResult extends TextLayerReport {
  pagesProcessed: number;
}

/**
 * Turns a scanned PDF into a searchable one: render each page, recognize it,
 * and write the words back as an invisible text layer.
 *
 * The engine renders; pdf-lib writes. They deliberately never meet — the bytes
 * that come out are the bytes that went in, plus text operators, so nothing
 * about the visible page is re-encoded by a round trip through PDFium.
 */
export async function makeSearchable(
  engine: PdfEngine,
  pdfBytes: Uint8Array,
  options: MakeSearchableOptions = {},
): Promise<SearchableResult> {
  assertPdfBytes(pdfBytes, 'document');
  throwIfAborted(options.signal);

  // A fresh handle, closed in `finally`: the OCR run must not disturb the
  // document the viewer is showing, and PDFium documents are native memory that
  // leaks if it is not returned.
  const buffer = pdfBytes.slice().buffer;
  const doc = await engine.openDocumentBuffer({ id: `ocr-${String(Date.now())}`, content: buffer }).toPromise();

  try {
    const images = await renderPagesForOcr(engine, doc, {
      ...(options.scale !== undefined ? { scale: options.scale } : {}),
      ...(options.pageIndices !== undefined ? { pageIndices: options.pageIndices } : {}),
      onProgress: (completed, total) => options.onProgress?.({ stage: 'rendering', completed, total }),
    });
    throwIfAborted(options.signal);

    const recognized = await recognizePages(images, {
      ...(options.language !== undefined ? { language: options.language } : {}),
      onProgress: (completed, total) => options.onProgress?.({ stage: 'recognizing', completed, total }),
    });
    throwIfAborted(options.signal);

    options.onProgress?.({ stage: 'writing', completed: 0, total: 1 });
    const report = await applyTextLayer(pdfBytes, recognized, {
      ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
    });
    options.onProgress?.({ stage: 'writing', completed: 1, total: 1 });

    return { ...report, pagesProcessed: recognized.length };
  } finally {
    // Bitmaps hold decoded pixel data; without this a long document's worth
    // stays alive until the collector gets round to it.
    await engine.closeDocument(doc).toPromise();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new PdfInputError('ocr: cancelled');
  }
}
