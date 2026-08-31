# Known issues

Defects that live in a dependency rather than in this codebase. Each has a test
in `tests/e2e/form-field-types.spec.ts` marked `test.fail()`, describing the
behaviour that *should* happen — so if a dependency upgrade fixes one, the suite
reports it as an unexpected pass rather than staying quiet.

## Form fields (EmbedPDF)

This app draws no form UI of its own; widgets come from the viewer. Reproduced
against `tests/e2e/fixtures/form-types.pdf` on 2026-08-31.

**How form widgets work here**, which explains several reports at once: what you
*see* is PDFium drawing the field's appearance stream into the page bitmap. The
HTML control on top has `opacity: 0` and only handles input. So a widget's
*appearance* is whatever the PDF says it is, and its *behaviour* comes from the
HTML control — the two are separate, and a field can look right while behaving
wrong, or the reverse.

| Field type | Status |
| --- | --- |
| Text | Works — value reaches the saved file, survives page operations |
| Checkbox | Works |
| Dropdown | Works as a control; see the note on the arrow below |
| Max length | Works — patched by this app, see below |
| Multiline, explicit font size | Works |
| Multiline, automatic font size | Works — patched by this app, see below |
| File select (attachment) | **Not implemented** |
| Push button (Submit) | **Not rendered** |

### Max length is not enforced — patched here

A field with `MaxLen 4` produces an `<input>` with no `maxlength` attribute, so
a longer value could be typed and saved. Nothing in the PDF stops it either —
the limit only ever exists in the viewer.

**Worked around** in `src/lib/viewer/form-field-fixes.ts`: the limits are read
from the document with pdf-lib and applied to the widgets, and a value that is
already too long is trimmed. Remove the workaround if the viewer starts doing
this itself.

### An automatically sized multiline field shows one enormous line

With no explicit font size the viewer fits the font to the field's *height*.
That is right for a single-line field and wrong for a multiline one: in an 80pt
box, the computed size came out at **59.5px**, so a single line fills the field
instead of wrapping at a readable size. The same field with an explicit 10pt
size renders at 8.6px and behaves correctly.

This is the explanation for the "multiline field shows one line in a huge font"
report: the PDF leaves the size automatic.

**Worked around** in `src/lib/viewer/form-field-fixes.ts`: a multiline widget
drawn at more than a third of its own height is reset to a sixth of it, which
leaves room to wrap. The size is a fraction of the widget rather than a fixed
number of pixels, because widget sizes scale with the zoom level. The fix is
reapplied as widgets are rebuilt — they come and go with scrolling and zooming,
so a one-shot pass would last until the first scroll.

### File-select fields offer no file picker

A field carrying the `FileSelect` flag renders as a plain text box, so there is
no way to choose a file. Worth noting this is common: many viewers deliberately
do not implement file-select or form submission, since both are routes for a
document to reach out to the network or the filesystem.

### Push buttons are not rendered

A push button in the PDF produces no widget at all, so a Submit button cannot be
pressed. Given the app has no network access by design, a submit action would
have nowhere to go regardless — but the button should at least be visible.

### Not a defect: a field renders in italics

A widget's typography comes from the font the *document* authored the field
with, not from the viewer. A field created with `Helvetica-Oblique` renders as
`font-family: Helvetica…; font-style: italic`, and one created with plain
`Helvetica` does not — confirmed with `tests/e2e/fixtures/form-italic.pdf`,
which contains one of each.

So a "signature" placeholder field appearing in italics is the PDF asking for
it. This is unrelated to the cursive faces in the Create Signature dialog, which
apply only to signatures typed there.

### The viewer's own Export does nothing in the desktop app — patched here

The viewer answers its Export menu command by clicking a hidden `<a download>`.
A browser downloads the file; the Tauri webview has no download manager and
silently ignores it, so Export looked like a dead menu item in the packaged app.

**Worked around** in `src/lib/viewer/export-bridge.ts`: under Tauri, the plugin's
own request event is caught and the document saved through the OS dialog, with
the document's real filename rather than the internal UUID the viewer uses. In a
browser the bridge stays out of the way — the viewer's handler works there, and
taking over as well would save the document twice.

`disabledCategories: ['document-export']` does not remove the menu item in
2.15.0, at the top level or under `ui`/`commands`, so hiding it was not an
option. The same applies to `document-open` and `document-close`, which is why
the viewer's menu still offers its own Open and Close — see the open item below.

### The dropdown arrow

Reported as only appearing after clicking into the field. The arrow is part of
the widget's *appearance stream* — drawn by PDFium from the PDF — not something
the viewer styles. Whether one is drawn therefore depends on how the document
was authored, and this varies between PDFs; the fixture here is generated by
pdf-lib, whose combo-box appearance has no arrow. Before treating this as a
viewer bug, check the same document in another reader: if the arrow is missing
there too, it is the PDF.

## Reporting these upstream

<https://github.com/embedpdf/embed-pdf-viewer/issues>. The fixture in
`tests/e2e/fixtures/` reproduces all of them in one document, and
`node tests/e2e/fixtures/make-fixture-pdf.mjs` regenerates it.
