# PDF Workbench

A cross-platform PDF tool that replicates the PDF functionality of macOS Preview: view, search,
annotate, fill existing form fields, stamp a signature, merge/split/reorder/rotate/extract pages,
reduce a file's size, and OCR scanned pages into searchable text.

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

`npm run test:e2e` needs two things once per machine — the browser binary and the system libraries it
links against:

```bash
npx playwright install chromium        # browser binary, as your normal user
sudo npx playwright install-deps       # ~294 apt packages, needs root
```

No display server is required afterwards; headless Chromium only needs the libraries present.

Two traps if you install the dependencies from a root shell rather than via `sudo`:

- **Node is installed through nvm, under your own home directory**, so root has no `node` on its PATH and
  `./node_modules/.bin/playwright` dies with `/usr/bin/env: 'node': No such file or directory`. Either
  prefix the PATH (`PATH=$HOME/.nvm/versions/node/<version>/bin:$PATH`, using the owning user's home) or
  hand apt the package list directly — `playwright install-deps --dry-run` prints it.
- **Only `install-deps` should run as root.** `playwright install` as root downloads a second copy of the
  browsers into `/root/.cache/ms-playwright`, leaving the copy the tests actually use untouched.

## Desktop app

`src-tauri/` wraps the same frontend in a native window and produces an installer:

```bash
npm run tauri:dev      # run it in a window
npm run tauri:build    # installer under src-tauri/target/release/bundle/
```

Verified on Windows on 2026-08-31: the window opens, PDFium and Tesseract both run, the stamp gallery loads,
Save writes through the OS dialog, and all of it works with the network off. `src-tauri/SMOKE-TEST.md` has the
per-platform prerequisites and the checklist.

It is still unverified on macOS and Linux, and installers are unsigned, so SmartScreen and Gatekeeper will warn
on first run.

## Layout

```
src/
  App.tsx                  Shell: open a file, hand it to the viewer
  components/              UI pieces, each with a co-located .test.tsx
  components/PagePanel.tsx Page previews: drag to reorder, rotate, delete, extract, split, merge
  hooks/                   useOcr, usePageOps, useThumbnails
  lib/pdf/                 Page operations on real PDF bytes (pdf-lib)
    page-ops.ts            merge / extract / reorder / split / rotate / remove
    errors.ts              Boundary validation for untrusted input
  lib/pdf/compress.ts      Size reduction: which images to downsample, and how far
  lib/pdf/image-resampler.ts   The browser half of it: decode, scale, re-encode as JPEG
  lib/ocr/                 Scanned page -> searchable PDF
    recognize.ts           Tesseract worker; browser only
    text-layer.ts          Invisible searchable text via pdf-lib
    win-ansi.ts            Folds OCR output into what standard fonts encode
    assets.ts              Bundled worker/core/traineddata paths
  test/fixtures.ts         Builds identifiable PDFs for tests
public/tessdata/           eng.traineddata, bundled so OCR works offline
tests/e2e/                 Playwright specs + fixture PDF
```

## Page operations

**Pages** in the toolbar opens a panel of page previews.

- **Hover a page** for its own rotate and delete buttons, which act on that page alone.
- **Drag** a page to reorder it. Dragging a page that is part of the selection moves the whole selection.
- **Click** a page to tick it, **shift-click** to tick the whole run between the two.
- **Click a preview** to take the viewer to that page; the page the viewer is showing is outlined.
- **Drag the panel's edge** to resize it — the previews grow with it. Arrow keys work on the handle too.
- Ticked pages can be rotated, deleted, extracted to a separate file, or used as **Split…** points, which start
  a new document at each. **Append…** adds another PDF to the end.

Operations run on the document as it currently stands, not the bytes it was opened with, so annotations made
beforehand survive. The viewer reopens on the result, and nothing is written to disk until **Save**.

Extract is the exception: it produces a new file alongside the original rather than replacing what is open.

**Merge…** in the toolbar assembles several documents into one, in an order you set by dragging them (or with
the ↑/↓ buttons), and works with nothing open at all — that is the case Append cannot serve. Drop PDFs
anywhere in the window to open them: one file opens straight away, while several open the merge dialog with
them queued, so the order can be checked before anything is assembled.

## Reducing file size

The size of the open document is shown beside its name in the toolbar, from the moment it is opened and
after every operation. "Is this file big?" is the question that sends anyone looking for Reduce size, and it
should not take running the reduction to answer it.

That figure is the size of the bytes this app holds, which costs nothing to show but is blind to
annotating: highlights, stamps and form values live inside the viewer and never reach those bytes.
**Click the size to measure what saving right now would actually write**, annotations included. A measured
figure is marked with an asterisk, and the mark clears as soon as an operation replaces the document.

Measuring has the viewer serialise the whole document, which takes about a second on a large file — fine on
a press, far too slow to do on every render, which is why it is a button rather than the default. Expect the
measured figure to differ from the file on disk even when nothing has been annotated: the viewer writes its
own PDF rather than handing back the bytes it was given. It answers "how big would this be if I saved it
now", not "how big is the file I opened".

**Reduce size…** in the toolbar makes a file smaller by lowering the resolution of the images inside it —
the same job as Preview's "Reduce File Size". Text, vector drawings and page structure are untouched; only
image streams are rewritten, so a document stays searchable, selectable and the same shape.

Three presets, with the resolution each one means shown beside it:

| Preset   | Images reduced to | For                                            |
| -------- | ----------------- | ---------------------------------------------- |
| Screen   | 72 DPI            | Smallest file. Fine on screen, coarse in print |
| Balanced | 150 DPI           | Much smaller, still sharp on paper             |
| Print    | 300 DPI           | Keeps photographic detail. Saves least         |

What it will and will not touch:

- **JPEG (`DCTDecode`) images only.** Flate bitmaps, CCITT and JBIG2 scans and JPEG 2000 are counted and
  left exactly as they are. A JPEG stream *is* a JPEG file, so the browser decodes and re-encodes it
  directly; the others would have to be unpacked and repacked by hand, and that is not where a large PDF's
  megabytes usually are.
- **Images already at or below the target are skipped**, as are images carrying a `/Decode` array or
  `/ImageMask`, and any the platform cannot decode (a CMYK JPEG, say). Each one is left alone rather than
  risked.
- **Resolution is judged against the whole page** an image is drawn on rather than the box it actually
  occupies. The error only runs one way — a small image reads as lower resolution than it is, and is
  reduced too little rather than too much.
- **A reduction that gains nothing is thrown away.** If the rewritten document is not smaller than the
  original, the original is what you keep, and the toolbar says so.

Nothing is written to disk until **Save**, as with every other operation here, so a result you do not like
costs a Close rather than a lost file. A reduced document is also renamed — see [Saving](#saving) below.

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

## Saving

Nothing is written to disk until **Save as…**, and **a document this app has changed is never offered back
under the name it was opened with**. The file on disk is still the original; a Save dialog pre-filled with
its name is an invitation to overwrite it, and several of these changes cannot be undone from the result —
a reduction has thrown the resolution away, a deleted page is simply not in the bytes any more.

| What you did                              | Saved as                |
| ----------------------------------------- | ----------------------- |
| Rotate, delete, reorder, append, annotate | `<name>-edited.pdf`     |
| Make searchable (OCR)                     | `<name>-searchable.pdf` |
| Reduce size                               | `<name>-reduced.pdf`    |
| Extract pages                             | `<name>-pages.pdf`      |
| Split                                     | `<name>-part-N.pdf`     |
| Merge…                                    | `merged.pdf`            |
| Nothing                                   | unchanged               |

Markers replace rather than accumulate: rotating a page, reducing the result and then running OCR gives
`report-searchable.pdf`, not `report-edited-reduced-searchable.pdf`. Only a marker at the very end of the
name counts as one of ours, so a file you called `reduced-staff-list.pdf` keeps the word you chose. The
toolbar shows the new name the moment an operation finishes, so there is no surprise at the Save dialog.

Annotating is the one case where nothing is renamed up front: highlights, stamps and form values live
inside the viewer and never pass through this app, so the new name is worked out when you press Save. A
document that already carries a more specific marker is left alone — a reduction you then highlighted is
still a reduction, and `-edited` would say less about it.

To overwrite the original deliberately, type its name back into the Save dialog. It is one deliberate act
rather than the default.

## Known limitations

- **Editable dropdowns only take values from their list.** Some forms have a dropdown that also lets
  you type your own value (Acrobat allows this). Here it behaves like an ordinary dropdown: you can
  pick any listed value, but not type a new one. A fix was attempted and dropped on 2026-09-28, since
  the viewer offers no way to record a value outside the list without restyling the field; see
  `KNOWN-ISSUES.md` for what was tried and the one route left open.
- Other form-field gaps (file-select fields, push buttons) and the viewer defects this app patches
  are listed in `KNOWN-ISSUES.md`.

## Staying offline

The packaged viewer fetches four things from the internet by default — the PDFium WASM binary, its own UI
font, the signature dialog's cursive fonts, and the rubber-stamp gallery. `src/lib/viewer/offline-config.ts`
points the engine, the stamp gallery and the cursive fonts at bundled assets, and turns off the UI font (the
system stack replaces it).

The cursive faces matter more than they look: with no stylesheet the viewer drops the signature dialog's
"Type" tab altogether rather than falling back to a system cursive. `scripts/sync-signature-fonts.mjs`
refreshes them from the `@fontsource/*` packages into `public/fonts/` (156 KB, SIL OFL 1.1).

The stamp gallery is built in `src/lib/viewer/stamps.ts` from `@embedpdf/default-stamps`. Only English is
bundled; the package also carries de, nl, fr, es, sv, ja and zh-CN if another locale is wanted.

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

See `CLAUDE.md` for the architectural decisions behind this stack, `DECISIONS.md` for
assumptions made along the way, and `KNOWN-ISSUES.md` for defects that live in a dependency.
