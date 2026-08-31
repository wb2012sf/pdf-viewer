# Decisions

One line per assumption made instead of interrupting a session, newest last.

- 2026-08-31 — Used `@embedpdf/react-pdf-viewer` (the packaged viewer with its own chrome) rather than
  hand-assembling `@embedpdf/core` + a dozen `@embedpdf/plugin-*` packages. Same PDFium/EmbedPDF stack
  named in CLAUDE.md, one dependency instead of twelve, and it already carries the annotation, search,
  form-fill, signature, stamp, print, export and rotate plugins the scope calls for.
- 2026-08-31 — Pinned EmbedPDF to the 2.15.x line. The 3.x packages (`@embedpdf/react`, `@embedpdf/viewer`)
  are published only as `3.0.0-next.0` prereleases; a scaffold should not start on an unreleased major.
- 2026-08-31 — Vitest runs in `node` by default; DOM tests opt in per file with a
  `// @vitest-environment jsdom` docblock. Vitest 4 dropped `environmentMatchGlobs`.
- 2026-08-31 — Playwright's `webServer` runs `npm run build && npm run preview` rather than the dev server,
  so end-to-end tests exercise the same static bundle Tauri will package.
- 2026-08-31 — Test fixtures give page `i` a width of `100 + i`, so tests can assert page *identity* after
  a merge/split/reorder, not just page count. pdf-lib cannot extract text, so geometry is the structural
  signal available.
- 2026-08-31 — `page-ops.ts` detects encryption by loading with `ignoreEncryption: true` and then checking
  `doc.isEncrypted`, rather than catching pdf-lib's `EncryptedPDFError`. Same refusal, but `instanceof` against
  that class returns false in practice — pdf-lib ships both a CJS and an ESM build, and the thrown class is not
  always the imported one. A boolean does not have that problem, and it lets the error name encryption rather
  than reporting a parse failure.
- 2026-08-31 — Scaffold only: no OCR module and no Tauri shell yet. `tesseract.js` is installed so the
  dependency decision is recorded, but no stub code was written for unbuilt features.

- 2026-08-31 — Encrypt/decrypt dropped from scope (user decision, not an assumption). pdf-lib cannot encrypt
  or decrypt and PDFium's password support is read-side only, so there was no path that did not mean adopting
  another library. CLAUDE.md's scope and "out of scope" sections were updated to match. Reading an already-
  encrypted file is unaffected — it still fails loudly.

- 2026-08-31 — OCR is split into `recognize` (Tesseract, browser-only) and `applyTextLayer` (pdf-lib,
  environment-agnostic), with rendering left to the caller. That keeps the part that decides where text lands
  on the page testable headlessly; only the thin worker wrapper needs a browser.
- 2026-08-31 — Bundled `eng.traineddata` from tessdata_fast (4.1 MB, committed to the repo) rather than
  tessdata_best (~12 MB). CLAUDE.md already accepts lower recognition quality than ocrmypdf in exchange for
  zero runtime dependencies; this is the same trade at a quarter of the download.
- 2026-08-31 — The traineddata lives in `public/tessdata/` rather than being imported through Vite, because
  Tesseract builds its own URL as `${langPath}/${lang}.traineddata` and cannot cope with a hashed filename.
  The worker and WASM core *are* imported with `?url`, so they cannot drift from the installed version.
- 2026-08-31 — `corePath` names `tesseract-core-simd-lstm.wasm.js` directly, which skips Tesseract's SIMD
  feature detection and commits to a WASM SIMD build. The alternative was bundling six core variants.
- 2026-08-31 — Invisible text is placed with PDF render mode 3 plus a horizontal squeeze (`Tz`) per word, so a
  text selection lines up with the ink in the scan underneath. Words below 30% confidence are dropped by
  default: a wrong word makes search match a page that does not contain the term, which is worse than a miss.
- 2026-08-31 — Text is folded into WinAnsi before encoding (ligatures expanded, smart punctuation flattened,
  anything else dropped). The standard PDF fonts cannot encode arbitrary Unicode and pdf-lib throws on the
  first bad character, which would lose the whole word.

- 2026-08-31 — OCR now handles rotated pages (`src/lib/ocr/rotation.ts`), closing the open item raised earlier
  the same day. The geometry is anchored on four corner facts that are checkable by turning a sheet of paper,
  not by algebra; the algebra is then checked separately by composing it with an independently written forward
  transform and requiring the round trip to be exact. A `/Rotate` that is not a multiple of 90 is rejected
  rather than rounded, since no rounding of it could be right.

## Open items

- Code-signing for the Tauri installer (SmartScreen/Gatekeeper) is still undecided — carried over from CLAUDE.md.
