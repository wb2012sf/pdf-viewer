/**
 * OCR: turn a scanned PDF into a searchable one, entirely on this machine.
 *
 * The pipeline is three steps, deliberately kept separable:
 *
 *   render (caller, PDFium) → recognizePages (Tesseract) → applyTextLayer (pdf-lib)
 *
 * Only the middle step needs a browser. `applyTextLayer` is pure PDF work, so
 * the part that decides where text lands on the page is testable headlessly.
 */
export { recognizePages, toOcrPage } from './recognize';
export type { PageImage, RecognizeOptions, TesseractBlockTree } from './recognize';

export { applyTextLayer, placeWord } from './text-layer';
export type { TextLayerOptions, TextLayerReport } from './text-layer';

export { toWinAnsi } from './win-ansi';
export { DEFAULT_LANGUAGE, LANG_PATH, ocrAssetPaths } from './assets';
export type { OcrAssetPaths } from './assets';

export type { OcrPage, OcrWord, PixelBox } from './types';
