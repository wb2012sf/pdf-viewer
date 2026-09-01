import type { PDFViewerConfig } from '@embedpdf/react-pdf-viewer';
// Bundled by Vite as a hashed asset, so the engine is served from the app
// itself rather than fetched from a CDN at first render.
import pdfiumWasmAsset from '@embedpdf/pdfium/pdfium.wasm?url';
import { defaultStampLibrary } from './stamps';
import { SIGNATURE_FONTS } from './signature-fonts';

/**
 * The engine runs in a web worker, and Vite emits asset URLs relative to the
 * page. A worker resolves a relative URL against its *own* location — which is
 * also inside `assets/` — so the relative form becomes `assets/assets/…`, 404s,
 * and the viewer waits forever without logging anything. Absolute resolves the
 * same from either context. Resolved on call, so importing this module does
 * not require a `location` to exist.
 */
function pdfiumWasmUrl(): string {
  return new URL(pdfiumWasmAsset, globalThis.location.href).href;
}

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
 * Each is either pointed at a bundled asset or turned off deliberately, rather
 * than left to a default. `tests/e2e/ocr.spec.ts` fails if any request leaves
 * the app's own origin.
 */
export function offlineViewerConfig(src: string): PDFViewerConfig {
  return {
    src,
    theme: { preference: 'system' },

    // The engine itself.
    wasmUrl: pdfiumWasmUrl(),

    // Fallback fonts for documents that reference a font they do not embed.
    // Disabled: a missing glyph is a far smaller problem than a viewer that
    // stalls on a network request that can never complete.
    fontFallback: null,

    fonts: {
      // The viewer's own UI font. Left off: the system stack is present
      // everywhere and downloading Open Sans buys nothing worth a request.
      ui: null,
      // The signature dialog's cursive faces, served from the bundle. These do
      // have to be supplied — with no stylesheet at all the viewer drops the
      // "Type" tab entirely rather than falling back to a system cursive.
      signature: SIGNATURE_FONTS,
    },

    // PDFium draws a page's static appearance streams and its *interactive*
    // form widgets in separate passes, and the second is off by default. Without
    // it a combo box has no dropdown arrow and a field no focus chrome — the
    // page looks like a printout of the form rather than a form.
    render: { withForms: true, withAnnotations: true },

    // The standard stamp gallery, supplied directly from the bundle instead of
    // being fetched. `manifests` must be cleared as well: it is a separate
    // option that still points at jsDelivr, and leaving it at its default
    // fires the request regardless of what `libraries` contains.
    //
    // `defaultLibrary` is deliberately left alone — despite the name it is the
    // container for stamps the *user* saves, not the built-in gallery, and
    // disabling it would take away custom stamps for no gain.
    stamp: { libraries: [defaultStampLibrary()], manifests: [] },
  };
}
