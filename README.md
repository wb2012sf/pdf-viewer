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
  test/fixtures.ts         Builds identifiable PDFs for tests
tests/e2e/                 Playwright specs + fixture PDF
```

Regenerate the end-to-end fixture with `node tests/e2e/fixtures/make-fixture-pdf.mjs`.

## Testing

Development is headless — there is no display server. Playwright's Chromium does not need one, and
the screenshots it writes to `test-results/screenshots/` are reviewed as part of a change. Page
operations are asserted against real PDF output (page count, page identity, rotation), not just
"it didn't throw": test fixtures give each page a distinct width so a test can prove *which* source
page ended up where after a merge or reorder.

See `CLAUDE.md` for the architectural decisions behind this stack and `DECISIONS.md` for
assumptions made along the way.
