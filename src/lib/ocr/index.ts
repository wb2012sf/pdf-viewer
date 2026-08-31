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

export { OCR_RENDER_SCALE, renderPagesForOcr } from './render';
export type { RenderOptions } from './render';

export { makeSearchable } from './pipeline';
export type { MakeSearchableOptions, OcrProgress, OcrStage, SearchableResult } from './pipeline';

export { applyTextLayer, placeWord } from './text-layer';
export type { Placement, TargetPage, TextLayerOptions, TextLayerReport } from './text-layer';

export { displayToUser, displayedSize, textDirection, toPageRotation } from './rotation';
export type { PageRotation } from './rotation';

export { toWinAnsi } from './win-ansi';
export { DEFAULT_LANGUAGE, LANG_PATH, ocrAssetPaths } from './assets';
export type { OcrAssetPaths } from './assets';

export type { OcrPage, OcrWord, PixelBox } from './types';
