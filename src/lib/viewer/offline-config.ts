import type { PDFViewerConfig } from '@embedpdf/react-pdf-viewer';
// Bundled by Vite as a hashed asset, so the engine is served from the app
// itself rather than fetched from a CDN at first render.
import pdfiumWasmAsset from '@embedpdf/pdfium/pdfium.wasm?url';

/**
 * The engine runs in a web worker, and Vite emits asset URLs relative to the
 * page. A worker resolves a relative URL against its *own* location — which is
 * also inside `assets/` — so the relative form becomes `assets/assets/…`, 404s,
 * and the viewer waits forever without logging anything. Absolute resolves the
 * same from either context.
 */
const pdfiumWasmUrl = new URL(pdfiumWasmAsset, globalThis.location.href).href;

/**
 * Viewer configuration that makes no network requests.
 *
 * Out of the box the packaged viewer fetches four things from the internet:
 * the PDFium WASM binary, Open Sans for its own chrome, cursive fonts for the
 * signature dialog, and a default stamp library — all from jsDelivr or Google
 * Fonts. On a machine with no connection the viewer then fails to render
 * anything at all, which is exactly what this app promises cannot happen
 * (see CLAUDE.md: the app must run for someone who has only been handed it).
 *
 * Each of these is turned off deliberately rather than left to a default, and
 * `tests/e2e/ocr.spec.ts` fails if any request leaves the app's own origin.
 */
export function offlineViewerConfig(src: string): PDFViewerConfig {
  return {
    src,
    theme: { preference: 'system' },

    // The engine itself.
    wasmUrl: pdfiumWasmUrl,

    // Fallback fonts for documents that reference a font they do not embed.
    // Disabled: a missing glyph is a far smaller problem than a viewer that
    // stalls on a network request that can never complete.
    fontFallback: null,

    // The viewer's own UI font, and the signature dialog's cursive faces.
    // `null` falls back to the system stack, which is present everywhere.
    fonts: { ui: null, signature: null },

    // The viewer ships a decorative stamp gallery ("Approved", "Draft", …)
    // whose manifest and artwork are fetched from jsDelivr. Both the library
    // entry and the manifest list have to be cleared: they are separate
    // options, and leaving `manifests` at its default still fires the request.
    //
    // This costs the built-in gallery, not the ability to stamp: placing a
    // signature image is the signature plugin's job and stays local.
    stamp: { defaultLibrary: false, manifests: [] },
  };
}
