/**
 * Where the OCR engine's assets come from.
 *
 * Every path here resolves to something inside the bundle. Tesseract.js
 * defaults to fetching its worker, its WASM core and its language data from a
 * CDN at first use, which would make OCR fail on a machine that is offline —
 * the one thing this app promises never to happen (see CLAUDE.md).
 *
 * The worker and core are pulled through Vite with `?url`, so they are emitted
 * as hashed assets and cannot drift from the installed version. The language
 * data lives in `public/` instead, because Tesseract builds its own URL as
 * `${langPath}/${lang}.traineddata` and so needs a stable, unhashed filename.
 */
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
// Naming the core file directly skips Tesseract's own SIMD feature detection,
// which would otherwise build a CDN URL. That commits us to a WebAssembly SIMD
// build: fine for the Tauri webview and every browser since 2021, and the
// alternative is bundling all six core variants for a case that will not arise.
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';

/** Directory served with `eng.traineddata` in it. */
export const LANG_PATH = '/tessdata';

/** The one language bundled today. Adding another means adding its file to `public/tessdata/`. */
export const DEFAULT_LANGUAGE = 'eng';

export interface OcrAssetPaths {
  workerPath: string;
  corePath: string;
  langPath: string;
  /** The bundled traineddata is not gzipped, so Tesseract must not append `.gz`. */
  gzip: boolean;
}

export function ocrAssetPaths(): OcrAssetPaths {
  return {
    workerPath: workerUrl,
    corePath: coreUrl,
    langPath: LANG_PATH,
    gzip: false,
  };
}
