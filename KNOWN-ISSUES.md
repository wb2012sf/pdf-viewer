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
| Dropdown, editable (custom value) | **Not implemented** — cannot take a value outside the list |
| Max length | Works — patched by this app, see below |
| Multiline, explicit font size | Works |
| Multiline, automatic font size | Works — patched by this app, see below |
| File select (attachment) | **Not implemented** |
| Push button (Submit) | Drawn, but has no control behind it — cannot be pressed |

### Max length is not enforced — patched here

A field with `MaxLen 4` produces an `<input>` with no `maxlength` attribute, so
a longer value can be typed and is displayed in full.

It is not, however, *saved* in full: measured on 2026-09-03 with the workaround
disabled, typing `123456789` leaves the widget showing all nine characters while
the exported document contains `"1234"`. The truncation is correct — the value
must not exceed `MaxLen` — but it happens silently at save time rather than at
the keystroke, so the five discarded characters are invisible until the file is
reopened. (An earlier version of this note claimed the long value reached the
saved file. It does not.)

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

### Push buttons are drawn but cannot be pressed — half fixed

A push button used to be invisible as well as inert. The cause was
`render.withForms`, which defaults to **false**: PDFium draws a page's static
appearance streams and its *interactive* form widgets in separate passes, and
only the first was switched on. `src/lib/viewer/offline-config.ts` now enables
both, and a Submit button appears where it belongs.

It still has no HTML control behind it, so it cannot be clicked. Given the app
has no network by design, a submit action would have nowhere to go — but a
button that looks pressable and is not remains a gap.

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
option.

### The viewer's own Open and Close bypassed the warning — patched here

The viewer's document menu offers Open and Close, bound to Ctrl+O and Ctrl+W.
Left alone they swap the document inside the viewer without this app hearing
about it: no unsaved-changes warning, and a toolbar still naming a file that is
no longer on screen.

**Worked around** in `src/lib/viewer/document-commands.ts`, by re-registering
`document:open` and `document:close` through the commands plugin at runtime so
they run this app's handlers. That covers the shortcuts as well as the menu
items — a warning that Ctrl+W walks past is not a warning.

Two approaches that do *not* work, recorded so they are not tried again:
supplying `commands` in the viewer config replaces the entire command set, after
which the viewer fails to render at all because its UI refers to commands that
no longer exist; and `onDocumentOpened`/`onDocumentClosed` only report
afterwards, which is too late to ask the user anything.

### Dropping files needs Tauri's own drag-drop turned off

`dragDropEnabled` defaults to true, which hands file drops to Tauri and stops
the webview delivering HTML5 drag events at all — Tauri's own schema says
"disabling it is required to use HTML5 drag and drop on the frontend on
Windows". `src-tauri/tauri.conf.json` sets it to `false`, since this app handles
drops in the page rather than through Tauri's event. Nothing uses Tauri's
file-drop event, so there is nothing lost.

### The dropdown arrow

Reported as appearing only after clicking into the field, while Acrobat shows it
from the start — so the earlier guess that this was the document's own
appearance stream was wrong.

The likely cause is the same `render.withForms` default described above: with
form widgets never drawn, a combo box gets no dropdown button. That is now on.
The fixture here cannot confirm it, because pdf-lib's generated combo-box
appearance has no arrow to draw either way; a document authored by a real form
tool is the test.

What is ruled out: the `<select>` overlay is not it. Its computed opacity is `0`
before a click, after a click and after blurring, so nothing about it becomes
visible at any point.


### An editable dropdown will not take a custom value

A combo box carrying the `Edit` flag (`Ff` bit 19) lets the reader type a value
that is not in the list; Acrobat allows this. The viewer renders every combo box
as a plain `<select>`, which structurally cannot hold a value outside its
options, so the custom value has nowhere to go.

**Not yet worked around, but it is fixable rather than an upstream wall.**
`@embedpdf/plugin-form` exposes `setFormValues(values: Record<string, string>)`,
which writes any value into a field by name — so the shape of the fix is to
detect the `Edit` flag with pdf-lib the way the max-length limits are read
already, present those fields as an `<input>` with a `<datalist>` of the options
rather than a `<select>`, and write the result back through `setFormValues`.

That is a new control rather than an attribute patch, so unlike the two fixes
above it needs a screenshot review before it can be called done.

### Not a defect: the viewer has its own Thumbnails tab

There are two page views, and they are different things:

- **This app's Pages panel** (left, headed "Pages") — reorder by dragging or with
  ↑/↓, tick pages with click, shift-click or ctrl-click, rotate and delete per
  page or in bulk, extract, split, append, and drag the panel edge to resize.
- **The viewer's own sidebar tab headed "Thumbnails"** — navigation only. No
  drag, no selection, no rotation, and it never had any: it is EmbedPDF's own
  component, registered in its UI schema next to Outline.

Reports that thumbnails cannot be dragged, multi-selected or rotated have all
turned out to be the viewer's tab rather than the Pages panel. The two cannot be
told apart by looking, which is the actual problem; the viewer's tab is part of
a `tabs` schema entry carrying no `categories`, so `disabledCategories` cannot
remove it, and overriding `ui.schema` wholesale is the same trap that `commands`
turned out to be.
## Reporting these upstream

Drafted, not yet filed: see `UPSTREAM-ISSUES.md` for eight ready-to-paste
issues with the measurements behind each. File them at
<https://github.com/embedpdf/embed-pdf-viewer/issues>. The fixture in
`tests/e2e/fixtures/` reproduces all of them in one document, and
`node tests/e2e/fixtures/make-fixture-pdf.mjs` regenerates it.
