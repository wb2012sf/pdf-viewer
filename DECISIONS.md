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

- 2026-08-31 — The signature dialog's cursive faces are bundled (Caveat, Dancing Script, Great Vibes,
  Pacifico; 156 KB, SIL OFL 1.1), reversing the earlier decision to turn them off. Setting `signature: null`
  had not merely degraded the fonts — the viewer drops the "Type" tab entirely rather than falling back to a
  system cursive, so a whole way of signing had gone missing. Same mistake as `defaultLibrary: false`.
- 2026-08-31 — The faces live in `public/fonts/` with a generated stylesheet rather than being imported through
  Vite: the viewer takes a *stylesheet URL*, and that stylesheet references the font files relatively, so both
  need stable unhashed names. `scripts/sync-signature-fonts.mjs` refreshes them from `@fontsource/*`. This also
  avoids adding `blob:` to the Tauri `style-src`, which would have meant re-verifying a CSP that now works.
- 2026-08-31 — The five reported form-field problems all reproduce and are all EmbedPDF's, not this app's;
  written up in `KNOWN-ISSUES.md` with a `test.fail()` test each, so a fixed dependency shows up as an
  unexpected pass. The multiline one is auto-sizing: the viewer fits the font to the field's height, which is
  right for one line and wrong for a box meant to wrap.

- 2026-08-31 — The unsaved-changes check asked the viewer during *render*, so annotating — which happens
  entirely inside the viewer and re-renders nothing here — left the click handler holding a stale "clean".
  Close and Open therefore warned only after a page operation. It is now asked at click time. The tests missed
  it because every one of them made its change through this app's own controls; two now annotate instead.
- 2026-08-31 — Two of the viewer's form defects are patched from outside it in
  `src/lib/viewer/form-field-fixes.ts`: MaxLen is read from the document and applied to the widget, and an
  auto-sized multiline widget is given a font that leaves room to wrap. Both make a document unusable rather
  than untidy, which is what justifies reaching into another component's shadow DOM. A MutationObserver
  reapplies them, since widgets are rebuilt on scroll and zoom.

- 2026-08-31 — The unsaved-changes warning, the max-length limit and the multiline font fix were all confirmed
  working on Windows by the user. The italics report was traced to the document rather than the viewer.

- 2026-08-31 — The Pages panel shows rendered previews and reorders by drag, replacing a list of page numbers
  with ↑/↓ buttons. A page is identifiable by what is on it, and moving a page ten places was ten clicks.
- 2026-08-31 — Previews stay on screen while the next set renders, rather than the list emptying on every
  operation — which collapsed it and lost the scroll position exactly when the user wanted to see the result.
  Staleness is *derived* (do the previews come from the bytes now open?) rather than stored, so the effect
  never sets state synchronously.
- 2026-08-31 — Thumbnails render at 0.4 scale with annotations included: a preview omitting the stamp just
  placed is worse than no preview, because it looks like the stamp did not land.
- 2026-08-31 — The Pages panel is 15.5rem. Wider made the thumbnails nicer but pushed the viewer's own tab bar
  into an overflow menu at 1280px, which costs more than it gains.
- 2026-08-31 — Split is driven by ticking the pages that should *start* a new document, and writes the parts
  alongside the original rather than replacing it — like extract. Ticking page 1 is treated as redundant
  rather than an error. Dismissing one save dialog stops the rest, instead of asking a dozen more times.
- 2026-08-31 — After a drag, the selection follows the page to its new position. Leaving the tick on whatever
  slid into the old slot would be actively misleading.

- 2026-08-31 — The rotation badge now shows how far a page has been turned *since the document was opened*,
  not its stored `/Rotate`. Plenty of documents carry `/Rotate 90` on a page that displays perfectly upright —
  scanners write it routinely — and badging that "90°" told the reader their page was sideways when it was not.
- 2026-08-31 — The viewer's own Export is answered by this app when running under Tauri
  (`src/lib/viewer/export-bridge.ts`). The viewer implements Export by clicking a hidden `<a download>`, which
  a browser honours and the webview silently ignores, so Export was a dead menu item in the packaged app. The
  bridge is deliberately *not* installed in a browser, where the viewer's own handler works and taking over as
  well would download the document twice.
- 2026-08-31 — `disabledCategories` does not remove `document-export`, `document-open` or `document-close` from
  the viewer's document menu in 2.15.0, at the top level or under `ui`/`commands`. Tried and reverted; the
  export bridge is the workaround.
- 2026-08-31 — "Merge…" is now "Append…", with the hint line saying where the pages go. The old label did not
  say whether the other document went before, after, or at the selection — it appends.

- 2026-08-31 — The viewer own Open and Close, and their Ctrl+O / Ctrl+W shortcuts, are re-registered at runtime
  through the commands plugin so they run this app handlers (`src/lib/viewer/document-commands.ts`). They
  previously walked straight past the unsaved-changes warning. Supplying `commands` in the viewer config
  instead replaces the entire command set and the viewer then fails to render at all; the plugin capability
  replaces a single command in place.

- 2026-08-31 — Each page preview carries its own rotate and delete buttons, shown on hover and reachable by
  keyboard. They act on that page alone even when others are selected: the page a button sits on is the one
  being pointed at, and borrowing the selection would make the same click do different things.
- 2026-08-31 — Shift-click selects the run between the last plainly-clicked page and this one. The anchor does
  not move on a shift-click, so a second one re-picks the run rather than chaining off the end of the first.
- 2026-08-31 — Dragging a page that is part of the selection moves the whole selection; dragging one outside it
  moves only that page. `orderWithPagesMoved` generalises the single-page arithmetic and reproduces it exactly
  for one page, which is asserted rather than assumed. A selection straddling the drop target counts as moving
  upwards, since there is no reading under which half of it goes each way.
- 2026-08-31 — After a move the selection follows the pages to wherever they landed, read out of the
  permutation rather than guessed.
- 2026-08-31 — The tick boxes must not `preventDefault` on click: doing so left a row highlighted and counted as
  selected while its box rendered unticked. Caught in a screenshot review, and now asserted.

- 2026-09-01 — **Two bugs the user reported, both mine, both with tests that had been passing.** The previews
  blanked on every page operation because replacing the document nulls the registry, so the engine went null
  and `useThumbnails` cleared — the test only polled for "not empty" afterwards, which is satisfied once the
  *new* previews land and says nothing about the gap. It now watches the list continuously and asserts it never
  emptied.
- 2026-09-01 — Reordering moved from HTML5 drag-and-drop to pointer events. Native drag would not start from
  the preview image, and cannot be driven by real mouse movement in a test — so `locator.dragTo`, which
  dispatches the drag events directly, passed while nobody could actually drag a page. The e2e helper now
  presses, moves in steps and releases on the image itself, which is what a hand does.
- 2026-09-01 — Thumbnails are sized by height rather than width, so a landscape page comes out wider than a
  portrait one instead of being squeezed into the same column.
- 2026-09-01 — Appending accepts several files at once, in the order chosen. Dropping several onto the window
  opens the first with the rest appended: opening only the first and discarding the others silently would be
  the worse answer.
- 2026-09-01 — A drop is treated as deliberate, so it asks about unsaved work rather than refusing; the files
  are held across the warning and opened once it is answered, rather than making the user find them again.

- 2026-09-01 — The pages panel can be resized by dragging its edge or with the arrow keys, and the preview size
  is derived from the width. Widening a panel that left the pages the same size would miss the point of
  widening it.
- 2026-09-01 — Merge is a dialog of its own, separate from the page panel's Append, because the two answer
  different questions: Append adds to the document already open, Merge assembles a set from nothing — which is
  why it works with no document open. With one open it is seeded with that document, read through
  `currentDocumentBytes` so annotations survive, and that entry cannot be removed: the result replaces it.
- 2026-09-01 — Page counts are read as each file joins the merge queue, so the dialog can say how large the
  result will be, and a file that is not a readable PDF is named as it is added rather than taking the whole
  batch down at the end.
- 2026-09-01 — The panel marks the page the viewer is showing, and clicking a preview scrolls the viewer to it.
  The marker is deliberately quieter than selection: where the reader is and what an operation would act on are
  different questions.
- 2026-09-01 — The preview was moved out of the `<label>`. Inside it, clicking a preview to navigate also
  activated the tick box, so looking at a page and choosing it were the same gesture — caught by a test written
  for exactly that.

- 2026-09-01 — Pointer-based list dragging is now one hook (`useListDrag`), used by both the page panel and the
  merge list. The second use was the moment to stop copying it.
- 2026-09-01 — The hook takes the list ref rather than returning one. A ref handed back from a hook and read
  during render is indistinguishable, to the React compiler lint, from reading its `.current`.
- 2026-09-01 — The merge list keeps its ↑/↓ buttons alongside dragging: a drag is not reachable from a keyboard,
  and the arrows are also the only way to move a row by exactly one place without aiming.

- 2026-09-01 — `dragDropEnabled: false` in the Tauri window config. It defaults to true, which routes file
  drops to Tauri and stops the webview delivering HTML5 drag events — so the drop-to-open added the same day
  would not have worked in the packaged app at all. Found by reading Tauri's config schema rather than by
  waiting for the bug report; nothing here uses Tauri's own file-drop event.

- 2026-09-01 — `render: { withForms: true, withAnnotations: true }`. `withForms` defaults to **false**, and
  PDFium draws static appearance streams and interactive form widgets in separate passes — so form widgets were
  never drawn at all. That is what made a Submit button invisible, and is the likeliest explanation for a combo
  box having no dropdown arrow. Found by chasing the arrow report after the user checked the same file in
  Acrobat and saw the arrow there, which disproved the earlier guess that it was the document.

## Open items

- File-select fields have no picker, and push buttons — now drawn, since `withForms` was switched on — still
  have no control behind them, so they cannot be pressed. See `KNOWN-ISSUES.md`.
- Whether the dropdown arrow is fixed is unconfirmed: the fixture cannot show it either way, so it needs a
  document authored by a real form tool.
- The desktop app is verified on Windows only; macOS and Linux are untried.
- **The desktop app has not been re-verified since that smoke test.** Everything added since — Save as/Close and
  the unsaved-changes warning, the page panel and its previews, pointer dragging, the merge dialog, dropping
  files, the export bridge and command overrides, the form-widget patches, the bundled cursive fonts — has only
  ever run in a browser. The browser and the webview have already differed twice (`<a download>`, and now
  drag-and-drop), so this is worth a run rather than an assumption.
- 2026-09-01 — Dropping several files at once now opens the merge dialog with them queued, instead of
  merging them behind the reader and opening the result. Combining silently gave no chance to check or
  change the order, and produced a document nobody had asked to be built that way. A single dropped file
  still opens directly — one file is an open, not an assembly job.
- 2026-09-01 — A merged document is named `merged.pdf` rather than after whichever file happened to be
  first in the queue. Offering "sample.pdf" in the Save-as dialog for a document that is no longer
  sample.pdf invites saving over the original.
- 2026-09-01 — The reorder drop indicator is now a line on the edge the page will be inserted at, and it
  follows the drag direction: downwards settles after the target row, upwards before it. Previously the
  target row was outlined, which reads as "onto this page" — the one thing a reorder never means — and
  gave no way to tell which side of it the page would land on until after the drop.
- 2026-09-01 — Re-added ↑/↓ buttons alongside drag reordering rather than treating drag as the only way.
  Dragging is quicker over a long distance and worse for moving one place, and it is not available at all
  to anyone who cannot hold a button down while moving a pointer.
- 2026-09-01 — `setPointerCapture` is called inside a `try`, and after `preventDefault` rather than before
  it. It is an improvement to a drag, not a requirement, but it threw in jsdom and can throw in a browser
  that considers the pointer inactive — and the throw was ending the drag, and in the resize handle also
  skipping the `preventDefault` that stops the browser selecting text instead. This was masked as 7
  "unhandled errors" in an otherwise green unit run.
- 2026-09-04 — The merge queue's ↑/↓ move the row out from under the pointer, so a second mouse click at
  the same spot acts on whichever document took that position. With ↓ this swaps the two back, which looks
  like the button did nothing — the likely explanation for a "very lagging" report that could not be
  reproduced (10 presses measured at a 42 ms mean). Focus follows the document, so the keyboard is
  unaffected; only repeated mouse clicks at one spot are. Left as it stands pending a decision, because
  the alternatives are design changes rather than fixes: move the arrows out of the rows so they act on a
  selected document, or leave dragging as the gesture for a long move.
- 2026-09-10 — **Resolved 2026-09-28, see below.** The viewer's own Thumbnails tab draws a rotated page at half
  the scale of an upright one (measured; see `KNOWN-ISSUES.md`). Hiding that tab is the preferred
  direction — it duplicates the Pages panel and has now produced five reports that were not about our
  code — but it cannot be hidden on its own: Thumbnails is the sidebar's default tab, so removing the
  button leaves its panel showing with no way off it. The two ways out are to hide the whole sidebar,
  losing outline/bookmark navigation with it, or to hide the tab and have a watcher select Outline when
  the sidebar opens, which patches the component's state rather than its appearance. Not chosen yet.
- 2026-09-11 — The desktop app is being tried on Linux for the first time, from a copy of the repo at
  `~/dev_projects/` on a Linux desktop. It has only ever been verified on Windows, and Linux uses
  WebKitGTK rather than WebView2 — the layer where the two previous webview-only defects lived. Treat
  results from there as first-run findings rather than regressions.
- 2026-09-22 — Size reduction downsamples **only `DCTDecode` (JPEG) image streams**. Everything else — Flate
  bitmaps, CCITT and JBIG2 scans, JPEG 2000 — is counted and left untouched. The stream bytes of a JPEG
  *are* a JPEG file, so the browser decodes and re-encodes them directly; every other encoding would have to
  be unpacked into samples, interpreted against its colour space and bit depth, and packed again by hand.
  That is where the bugs and the quality losses would be, and it is not where a large PDF's megabytes
  usually are — those are photographs and camera scans, which are JPEG.
- 2026-09-22 — An image's effective resolution is estimated against the **whole page it is drawn on**, not
  the box it is actually placed in, which would mean tracking every content stream's transformation
  matrices. The error only runs one way: an image filling a quarter of the page reads as a lower DPI than it
  really is, so it is downsampled too little rather than too much. Under-reducing is a disappointment;
  over-reducing is damage. Images reused across pages are measured against the largest of them.
- 2026-09-22 — Images reachable only through an **annotation's appearance stream** (a stamp, a placed
  signature) are left alone: nothing walks `/Annots` looking for them. They are typically small, and
  typically PNG — that is, Flate, which is skipped anyway. Worth revisiting only if a signature photo ever
  turns out to be what is making someone's file large.
- 2026-09-22 — A reduction that does not pay for itself is **discarded rather than kept**, at two levels: an
  individual image whose re-encode came out no smaller keeps its original bytes, and a document that came
  out no smaller is thrown away and the original returned with `changed: false`. "Reduce size" handing back
  a bigger file is the kind of bug a user has to notice for themselves.
- 2026-09-22 — A re-encoded image is written as `/DeviceRGB`, 8 bits per component, with `/DecodeParms`
  dropped, because that is what a canvas hands back whatever went in. Images carrying a `/Decode` array or
  `/ImageMask` are skipped instead — a canvas round trip silently loses both.
- 2026-09-22 — The resolution is offered as three named presets (Screen 72 / Balanced 150 / Print 300)
  rather than a DPI field, with the number shown beside each name. "What is this file for" is a question
  anyone can answer; "how many dots per inch" is not. The DPI is still visible so that someone who does know
  need not guess which preset hides which number.
- 2026-09-22 — `load` in `page-ops.ts` is exported as `loadPdf` and shared with `compress.ts`, rather than
  compression opening documents its own way. Both have to refuse encrypted and unparseable files for the
  same reasons, and a second loader would eventually drift from the first.
- 2026-09-22 — The `photo.pdf` end-to-end fixture's JPEG is produced by **Playwright's Chromium**, inside
  `make-fixture-pdf.mjs`. Node cannot encode JPEG without a new dependency, and encoding JPEG in a browser
  is precisely what the feature does. Deliberately kept to ~190 KB: it is a committed binary, and every
  other fixture in that directory is under 51 KB.
- 2026-09-22 — The toolbar now wraps as a row (`flex-wrap`), buttons never break their own labels, and the
  filename keeps a 6 rem floor instead of `min-width: 0`. Adding the reduction summary to that row squeezed
  `photo.pdf` down to "p…" and then broke every button onto two lines. A bar that runs out of room should
  break *between* its controls.
- 2026-09-22 — A reduced document is renamed `<name>-reduced.pdf`; one that came back unchanged keeps its
  own name. The reduction was replacing the open document while keeping its filename, which pre-fills the
  Save dialog with the original's name — and one click through that dialog in the original's folder
  overwrites a file whose high-resolution images cannot be recovered. This is the rule merge already
  follows (`merged.pdf`, 2026-09-01) and extract and split already follow (`-pages.pdf`, `-part-N.pdf`):
  a derived document gets a derived name. Reducing twice does not stack the suffix.
- 2026-09-22 — **Every operation that changes a document now renames it**, not just size reduction:
  `-edited` for rotate/delete/reorder/append and for annotating in the viewer, `-searchable` for OCR,
  `-reduced` for size reduction, on top of the `-pages`/`-part-N`/`merged.pdf` that extract, split and
  merge already used. Supersedes the reduce-only rename recorded earlier the same day. The file on disk is
  still the original after any of these, so offering its name back in the Save dialog is what talks someone
  into overwriting it — and a rotation is recoverable where a reduction or a deleted page is not, which is
  a distinction not worth asking the user to hold in their head at the moment they are clicking Save.
- 2026-09-22 — Markers **replace rather than stack**, and only a marker ending the name counts as one of
  ours. Three operations in a row would otherwise give `report-edited-reduced-searchable.pdf`, and a
  document the user themselves called `reduced-staff-list.pdf` would have their word eaten. The name only
  has to be different and recognisable; it is not a changelog.
- 2026-09-22 — Annotating is renamed **at save time rather than when it happens**. Highlights, stamps and
  form values live in the viewer's own state; this app is never told, and nothing re-renders — the same
  reason `hasUnsavedChanges` is asked at the moment it is needed rather than computed during render. A
  document already carrying a more specific marker is not demoted to `-edited` by a highlight.
- 2026-09-22 — The open document's size is shown in the toolbar at all times, taken from the bytes this app
  holds (`document.bytes.byteLength`) rather than asked of the viewer. Reading the true current size means
  exporting the whole PDF through PDFium, which is far too expensive to do on every render. The figure is
  therefore exact on open and after every operation this app performs, and stale only by whatever annotating
  has added since — a tooltip says so. Updating it on save was considered and rejected: refreshing
  `document.bytes` changes the document identity, which trips the effect that revokes the object URL the
  viewer is currently reading from.
- 2026-09-22 — With the size on screen at all times, the reduction summary stopped repeating it:
  "190 KB → 30 KB (84% smaller)" became "was 190 KB (84% smaller)", and the unchanged case dropped its size
  entirely. The new figure is already beside the filename; what the summary alone can say is where the
  document started, which is gone the moment the reduction lands.
- 2026-09-22 — The filename truncates before the size does when the toolbar runs out of room. A size cut to
  "3…" says nothing at all, while a name cut to "photo-redu…" still identifies the document.
- 2026-09-22 — The size chip in the toolbar **is** the measure button, rather than gaining a control beside
  it. The bar already carries the filename, the size, a reduction summary and six buttons, and the thing
  being re-measured is the thing already being looked at. Cost: a size chip reads as a label, so it is given
  a hover border and a tooltip to say it can be pressed.
- 2026-09-22 — A measured figure is marked with an asterisk rather than silently replacing the one shown by
  default, because the two are not the same quantity. `currentDocumentBytes` has PDFium serialise its own
  PDF, so even an untouched document measures differently from the file it was opened from — `sample.pdf`
  is 1.2 KB on disk and measures ~6 KB with one stamp on it. Presenting that as a correction to the default
  figure would look like a bug; presenting it as "what saving now would write" is what it actually is.
- 2026-09-22 — A measurement is discarded whenever the document is replaced. It describes the document it
  was taken from, and carrying it across an operation would label the new document with the old one's size.
- 2026-09-22 — A failed measurement reports the error and leaves the previous figure standing, down the same
  channel a failed save uses — it is the same failure (the viewer's export component being unavailable), and
  a number that is quietly wrong is worse than no new number.
- 2026-09-28 — The viewer's Thumbnails tab is removed, and its sidebar holds the Outline alone (user's call,
  after both halves were laid out). Done through the UI plugin's runtime `mergeSchema`, which merges
  sidebars by id and swaps only `sidebar-panel`'s `content` — not the DOM patch or state watcher the
  2026-09-10 entry anticipated, and not `ui.schema` in the config, which replaces the schema wholesale.
  With one panel left the content is `outline-sidebar` itself rather than a one-tab strip, since a strip
  with one tab is a control that does nothing.
- 2026-09-28 — Putting the Pages panel *inside* the viewer's sidebar was looked at and is not possible
  with `@embedpdf/react-pdf-viewer` 2.15.0: the schema accepts any `componentId`, but the ready-made
  viewer resolves them against a fixed internal map of its own 18 components and exposes no way to add
  one (only icons can be registered). Getting there would mean rebuilding the viewer's UI on the
  lower-level React plugins — a rewrite, not worth it to move one panel.
- 2026-09-28 — Installers stay **unsigned**. Code-signing costs money every year (an Apple Developer
  membership for macOS, a certificate or signing service for Windows), and the user chose not to spend it
  on a friends-and-family tool. The cost is a first-run warning: click-through on Windows, a trip to
  System Settings > Privacy & Security > Open Anyway on macOS. Moved to the backlog below, not rejected.

## Backlog — maybe later

Things deliberately set aside rather than refused. None is being worked on; each can be picked up
without undoing anything.

- **Code-signing the installers** (2026-09-28). Removes the SmartScreen and Gatekeeper warnings. Signing
  happens at build time through Tauri's bundler config, so it can be added to any later release with no
  code change, and a signed build installs over an unsigned one. Needs a paid Apple Developer membership
  (macOS) and a code-signing certificate or signing service (Windows) — a spending decision for the user.
- **Editable dropdowns taking a typed value** (2026-09-28). See `KNOWN-ISSUES.md` for what was tried and
  the one route left: writing the value with pdf-lib whenever the document leaves the viewer.
