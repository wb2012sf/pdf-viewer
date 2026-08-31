# PDF Workbench

A cross-platform PDF tool that replicates the PDF functionality of macOS Preview: view, search,
annotate, fill existing form fields, stamp a signature, merge/split/reorder/rotate/extract pages,
and OCR scanned pages into searchable text.

Everything runs on the machine it is opened on. There is no backend, no Docker, and no network
call at runtime — PDFium (rendering), Tesseract (OCR) and pdf-lib (page operations) all execute in
the browser/webview, and the PDFium WASM binary is bundled into the build output.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

## Commands

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                            |
| `npm run build`        | Static production bundle into `dist/`                      |
| `npm run preview`      | Serve the production bundle on http://localhost:4173       |
| `npm run test`         | Vitest unit/integration tests                              |
| `npm run test:e2e`     | Playwright browser tests (headless; builds and previews)   |
| `npm run lint`         | ESLint                                                     |
| `npm run typecheck`    | `tsc --noEmit`                                             |

`npm run test:e2e` needs the browser binary once: `npx playwright install --with-deps chromium`.

## Layout

```
src/
  App.tsx                  Shell: open a file, hand it to the viewer
  components/              UI pieces, each with a co-located .test.tsx
  lib/pdf/                 Page operations on real PDF bytes (pdf-lib)
    page-ops.ts            merge / extract / reorder / split / rotate
    errors.ts              Boundary validation for untrusted input
  lib/ocr/                 Scanned page -> searchable PDF
    recognize.ts           Tesseract worker; browser only
    text-layer.ts          Invisible searchable text via pdf-lib
    win-ansi.ts            Folds OCR output into what standard fonts encode
    assets.ts              Bundled worker/core/traineddata paths
  test/fixtures.ts         Builds identifiable PDFs for tests
public/tessdata/           eng.traineddata, bundled so OCR works offline
tests/e2e/                 Playwright specs + fixture PDF
```

## OCR

Three steps, deliberately separable:

```
render (caller, PDFium) -> recognizePages (Tesseract) -> applyTextLayer (pdf-lib)
```

Only the middle step needs a browser, so the part that decides where text lands on the page is unit-tested
headlessly. Recognized words are written as PDF text render mode 3 — laid out and selectable, never painted —
so the scan still looks like the scan.

Open a PDF, press **Make searchable**, and the viewer reopens on the result once the text layer is written.
**Save** writes the current document — including any OCR layer — back to disk.

Nothing is fetched at runtime: the Tesseract worker and WASM core are bundled through Vite, and
`eng.traineddata` is served from `public/`. Adding a language means adding its `.traineddata` to
`public/tessdata/`.

## Staying offline

The packaged viewer fetches four things from the internet by default — the PDFium WASM binary, its own UI
font, the signature dialog's cursive fonts, and a stamp gallery. `src/lib/viewer/offline-config.ts` turns each
of those off and points the engine at the bundled binary instead.

This is enforced, not assumed: `tests/e2e/ocr.spec.ts` records every request the browser makes during a real
OCR run and fails if any of them leaves the app's own origin.

Rotated pages are handled. A recogniser only ever sees the page *as displayed*, so its boxes arrive with
`/Rotate` already applied; `src/lib/ocr/rotation.ts` maps them back into the page's own coordinates and turns
the glyphs to match, so the invisible text sits on the ink and reads along it. A `/Rotate` that is not a
quarter turn is rejected rather than rounded.

Regenerate the end-to-end fixture with `node tests/e2e/fixtures/make-fixture-pdf.mjs`.

## Testing

Development is headless — there is no display server. Playwright's Chromium does not need one, and
the screenshots it writes to `test-results/screenshots/` are reviewed as part of a change. Page
operations are asserted against real PDF output (page count, page identity, rotation), not just
"it didn't throw": test fixtures give each page a distinct width so a test can prove *which* source
page ended up where after a merge or reorder.

See `CLAUDE.md` for the architectural decisions behind this stack and `DECISIONS.md` for
assumptions made along the way.
