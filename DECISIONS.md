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

- 2026-08-31 — Wiring OCR into the UI surfaced that the app was **not** actually offline: the packaged viewer
  fetched PDFium's WASM, Open Sans, the signature dialog's cursive fonts and a stamp gallery from jsDelivr and
  Google Fonts at runtime, despite the WASM also being bundled. `src/lib/viewer/offline-config.ts` disables all
  four. (Superseded for stamps by the entry below, which bundles the gallery rather than dropping it.)
- 2026-08-31 — The stamp gallery is bundled from `@embedpdf/default-stamps` rather than disabled. The plugin
  accepts a library given directly (`libraries: [...]`), so the manifest is read at build time and the artwork
  emitted as a hashed asset; the manifest's own relative `pdf` reference is never used. `manifests: []` is still
  required, because that option points at jsDelivr independently of `libraries`. English only — the package
  carries seven more locales if wanted.
- 2026-08-31 — Corrected an earlier mistake: `stamp.defaultLibrary: false` was set while disabling the CDN
  fetch, but despite the name that option is the container for stamps the *user* saves, not the built-in
  gallery. It is now left at its default, so custom stamps work again. Only `manifests` needed clearing.
- 2026-08-31 — Manifest stamp names are mapped to `PdfAnnotationName` through a checked lookup that rejects
  both unknown names and numeric-enum reverse lookups (`PdfAnnotationName['13']` answers `'Approved'`). An
  unmapped name would otherwise become `undefined` and yield a stamp that silently cannot be placed.
- 2026-08-31 — `wasmUrl` must be made absolute with `new URL(asset, location.href).href`. Vite emits asset URLs
  relative to the page, the PDFium engine runs in a web worker, and a worker resolves a relative URL against
  its own location — which is also inside `assets/`. The result was `assets/assets/…`, a 404, and a viewer that
  hung forever without logging anything.
- 2026-08-31 — OCR opens its own PDFium document handle rather than reusing the viewer's, and closes it in a
  `finally`. The run must not disturb what the user is looking at, and these are native handles that leak.
- 2026-08-31 — After OCR the viewer is reopened on the result, so the new text layer is searchable immediately
  rather than after a save-and-reopen. The bytes handed to pdf-lib are the original ones, so the visible page
  is never re-encoded through a PDFium round trip.
- 2026-08-31 — Playwright's per-test timeout is 120s. Booting PDFium means compiling a 4.6 MB WASM module, which
  takes tens of seconds headless; the 30s default expired while the viewer was still legitimately starting.
- 2026-08-31 — The e2e offline check records requests rather than blocking them. Installing any `context.route`
  handler stops the viewer resolving the `blob:` URL it is handed, so an enforced blackout failed for a reason
  unrelated to OCR.
- 2026-08-31 — EmbedPDF paints pages into `<img>` elements inside its shadow root, not `<canvas>`. The scaffold's
  `canvas` locator could never have matched; e2e assertions use `embedpdf-container img`.

- 2026-08-31 — **Bug found and fixed while testing stamp placement: Save discarded annotations.** The Save
  button wrote the bytes the file was opened with, but anything drawn, stamped, highlighted or filled since
  then lives in the viewer's state until flattened. A user could stamp a page, press Save, and get their
  original file back with no warning. OCR had the same flaw, since it also read the opened bytes. Both now go
  through `currentDocumentBytes`, which asks the viewer's export plugin for the document as it stands.
- 2026-08-31 — `App` holds the `PluginRegistry` rather than just the engine, since both the engine and the
  export capability come from it.
- 2026-08-31 — The viewer labels its controls with `aria-label`, not `title`, and renders into a shadow root.
  E2E tests locate controls by `aria-label` and click real screen coordinates: Playwright's actionability
  checks cannot drive the component's internals (a `getByTitle(...).click()` simply times out).

- 2026-08-31 — `useOcr.run` takes a function that yields the bytes rather than the bytes themselves, so that
  reading the document out of the viewer happens inside the hook's guarded region. A failure there is then
  reported the same way any other OCR failure is, instead of escaping as an unhandled rejection.
- 2026-08-31 — Save reports a read failure in the toolbar and writes nothing. Handing over a copy that silently
  lacks the user's recent work would be worse than refusing, so there is no fallback to the opened bytes.
- 2026-08-31 — `App` is unit-tested with the viewer mocked out. The real one needs a browser, WASM and a canvas;
  the only part `App` talks to is the registry, so a stub of that exercises the whole error path.

- 2026-08-31 — Tauri desktop shell scaffolded (`src-tauri/`), but **not built or run**: the dev machine has no
  Rust toolchain, no WebKitGTK (a 630-package dependency closure, unobtainable without root) and no display.
  Bootstrapping that by hand would have taken hours and proved less than one real run elsewhere, so the shell
  ships unverified with `src-tauri/SMOKE-TEST.md` naming exactly what to check.
- 2026-08-31 — Saving is abstracted behind `src/lib/platform/save-file.ts`, which picks the OS save dialog
  under Tauri and `<a download>` in a browser. The webview has no download manager, so `<a download>` is a
  silent no-op there — the one break from packaging that could be predicted with confidence. Both branches are
  unit-tested through injected dependencies; only the browser one has been exercised for real.
- 2026-08-31 — The Tauri CSP is set explicitly rather than left at its default, since the app needs
  `'wasm-unsafe-eval'` and `blob:` in `script-src` and `blob:` in `worker-src`: two WASM modules and two web
  workers, one of which Tesseract loads from a blob URL. Untested — this is the most likely thing to be wrong.
- 2026-08-31 — The app icon is a placeholder (`src-tauri/app-icon.svg`); replace before giving the installer to
  anyone.

- 2026-08-31 — Page operations are wired into the UI (`PagePanel` + `usePageOps`). They read through
  `currentDocumentBytes` like Save and OCR, so annotations made before a reorder survive it — covered by an
  end-to-end test that stamps a page, rotates it, saves, and checks the annotation is still there.
- 2026-08-31 — Operations act only on ticked pages, and the buttons stay disabled until something is ticked.
  Rotating the whole document because nothing was selected is far more likely to be a mis-click than intent.
- 2026-08-31 — Moving is limited to a single selected page: "move these three up" has no obvious meaning when
  they are not adjacent. Deleting every page is refused in the UI as well as the library.
- 2026-08-31 — Extract writes a separate file rather than replacing what is open, since pulling pages out is
  normally about producing something alongside the original.
- 2026-08-31 — `orderWithPageMoved` lives in `page-ops.ts` rather than the panel, so the UI never hand-rolls a
  permutation; a property test checks every from/to pair still yields a full permutation, which is what
  `reorderPages` demands.

- 2026-08-31 — **The Tauri smoke test passed on Windows.** All five checks by hand: window opens, PDFium and
  Tesseract both run, the stamp gallery loads, Save writes through the OS dialog, and everything works with the
  network off. The offline promise and the custom-protocol assumptions are therefore no longer speculative on
  that platform. macOS and Linux are still unverified.
- 2026-08-31 — `vite.config.ts` excludes `src-tauri/**` from the dev-server watcher. `tauri dev` runs Vite
  while cargo is linking, and watching the DLL mid-write fails with EBUSY on Windows, killing the dev server
  and `tauri dev` with it. The scaffold had missed what the standard Tauri + Vite setup does.
- 2026-08-31 — "Save" is now "Save as…", since every save goes through a file dialog and writes a copy; there is
  no in-place overwrite of the opened file. A Close button sits beside it.
- 2026-08-31 — Unsaved-change detection is two sources ORed: edits this app made (OCR, page operations, tracked
  as a flag) and edits made inside the viewer (asked of the history plugin's `canUndo`). Neither alone is
  enough — the viewer knows nothing about OCR, and the app cannot see an annotation being drawn.
- 2026-08-31 — The warning dialog offers Cancel / Save as… / discard rather than a bare confirm, so the user is
  never made to choose between losing work and abandoning what they asked for. Cancel takes focus, so a stray
  Return cannot discard a document. Saving from the dialog only proceeds if a file was actually written — a
  dismissed save dialog must not quietly discard the work it was protecting.
- 2026-08-31 — The dialog is rendered in-app rather than using `window.confirm`, which is unstyled, blocks the
  thread, and behaves inconsistently inside a native webview.
- 2026-08-31 — A drawn signature is saved as an `/Ink` annotation, not `/Stamp` as first assumed. Verified end
  to end: draw, place, save, and the strokes are in the file.

## Open items

- Code-signing for the Tauri installer (SmartScreen/Gatekeeper) is still undecided — carried over from CLAUDE.md.
