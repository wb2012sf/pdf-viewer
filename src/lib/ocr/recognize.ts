import { createWorker, type Worker } from 'tesseract.js';
import { PdfInputError } from '../pdf/errors';
import { DEFAULT_LANGUAGE, ocrAssetPaths } from './assets';
import type { OcrPage, OcrWord } from './types';

/**
 * The subset of Tesseract's result this module reads.
 *
 * Declared structurally rather than imported so the mapping below can be tested
 * without standing up a worker: a fixture only has to be this shape.
 */
export interface TesseractBlockTree {
  blocks:
    | ReadonlyArray<{
        paragraphs: ReadonlyArray<{
          lines: ReadonlyArray<{
            words: ReadonlyArray<{
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
          }>;
        }>;
      }>
    | null;
}

/**
 * Flattens Tesseract's block/paragraph/line/word tree into the flat word list
 * the text layer works from.
 *
 * Words with no text survive as far as the text layer, which decides what is
 * searchable; this function's only job is the shape change.
 */
export function toOcrPage(
  result: TesseractBlockTree,
  pageIndex: number,
  imageWidth: number,
  imageHeight: number,
): OcrPage {
  const words: OcrWord[] = [];
  for (const block of result.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({ text: word.text, confidence: word.confidence, bbox: { ...word.bbox } });
        }
      }
    }
  }
  return { pageIndex, imageWidth, imageHeight, words };
}

/** An image of a page, as produced by rendering it with PDFium. */
export interface PageImage {
  pageIndex: number;
  width: number;
  height: number;
  /** Anything Tesseract accepts: a canvas, an ImageBitmap, a Blob, a data URL. */
  image: Parameters<Worker['recognize']>[0];
}

export interface RecognizeOptions {
  /** Language code; the traineddata for it must be bundled. @default 'eng' */
  language?: string;
  /** Reports progress 0–1 as pages complete. */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Runs OCR over already-rendered page images.
 *
 * Rendering is deliberately the caller's job: PDFium does it in the browser,
 * and keeping it out of here is what stops the OCR pipeline from depending on a
 * canvas. One worker is created for the whole batch, because spinning one up
 * costs a WASM instantiation and a traineddata load.
 */
export async function recognizePages(
  images: readonly PageImage[],
  options: RecognizeOptions = {},
): Promise<OcrPage[]> {
  for (const image of images) {
    if (!Number.isInteger(image.pageIndex) || image.pageIndex < 0) {
      throw new PdfInputError(`ocr: page index ${String(image.pageIndex)} is not a page number`);
    }
    if (!(image.width > 0) || !(image.height > 0)) {
      throw new PdfInputError(
        `ocr: page ${String(image.pageIndex + 1)} image has no size (${String(image.width)}x${String(image.height)})`,
      );
    }
  }
  if (images.length === 0) return [];

  const { workerPath, corePath, langPath, gzip } = ocrAssetPaths();
  const worker = await createWorker(options.language ?? DEFAULT_LANGUAGE, undefined, {
    workerPath,
    corePath,
    langPath,
    gzip,
  });

  try {
    const pages: OcrPage[] = [];
    for (const [completed, image] of images.entries()) {
      // `blocks: true` is what makes per-word boxes available; without it only
      // the plain text comes back, and the text layer has nowhere to put it.
      const { data } = await worker.recognize(image.image, {}, { blocks: true });
      pages.push(toOcrPage(data, image.pageIndex, image.width, image.height));
      options.onProgress?.(completed + 1, images.length);
    }
    return pages;
  } finally {
    // The worker holds a WASM instance and the loaded traineddata; leaking one
    // per OCR run would grow memory until the tab falls over.
    await worker.terminate();
  }
}
