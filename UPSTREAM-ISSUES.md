# Upstream issue drafts — EmbedPDF

Drafts for <https://github.com/embedpdf/embed-pdf-viewer/issues>, eight of them,
one section per issue, ready to paste. Written 2026-09-03 against **2.15.0**
(exact, not a resolved range).

Two known defects are deliberately **not** here. File-select fields offering no
picker is a security position other viewers take too, not a defect worth a
maintainer's attention. The combo-box dropdown arrow cannot be reproduced
without a PDF from a real form authoring tool, and its likely cause is already
switched on here — a report nobody can confirm costs more than it is worth. Both
stay recorded in `KNOWN-ISSUES.md`.

Everything below was measured on the day it was written, with this app's own
workarounds disabled, so the numbers describe the viewer's behaviour rather than
ours. See `KNOWN-ISSUES.md` for how each one affects this app and what it does
about it.

**Before filing:** check whether a newer release fixes any of these, and search
the tracker for duplicates. Attach `tests/e2e/fixtures/form-types.pdf` (5.5 KB)
to issues 1–4 — it carries every field type below in one document, and
`node tests/e2e/fixtures/make-fixture-pdf.mjs` regenerates it.

**Shared environment block** for issues 1–4:

> - `@embedpdf/react-pdf-viewer` 2.15.0 (`@embedpdf/core`, `@embedpdf/pdfium` also 2.15.0)
> - Chromium 142 via Playwright 1.62.1, headless, Linux
> - Viewer configured with `render: { withForms: true, withAnnotations: true }`
> - Fixture: `form-types.pdf`, attached, generated with pdf-lib 1.17.1

---

## 1. A `MaxLen` text field accepts a longer value, then silently truncates it on save

**Type:** bug

### What happens

A text field with `/MaxLen 4` renders as an `<input>` carrying **no `maxlength`
attribute**. The field accepts nine characters and displays all nine. Exporting
the document then writes `"1234"` — the five extra characters are discarded with
no indication that anything was dropped.

### Steps to reproduce

1. Open the attached `form-types.pdf`.
2. Type `123456789` into the field named `field.maxlength` (declared `/MaxLen 4`).
3. Observe the field shows `123456789`.
4. Export the document and read the field back.

### Expected

The widget carries `maxlength="4"`, so the fifth character is refused as it is
typed — the same thing Acrobat does, and what the `/MaxLen` entry is for.

### Actual

Measured on 2026-09-03:

| | |
| --- | --- |
| `maxlength` attribute on the widget | `null` |
| Value the widget holds after typing 9 chars | `"123456789"` |
| Value in the exported PDF | `"1234"` |
| `/MaxLen` in the exported PDF | `4` |

### Why it matters

The truncation itself is correct — the value must not exceed `/MaxLen`. The
problem is *where* it happens. Someone types a nine-character reference number,
sees nine characters on screen, saves, and gets a document containing four. The
loss is invisible at the moment it occurs and only discoverable by reopening the
file. Refusing the input at the keystroke is the difference between a limit and
a trap.

### Workaround

Reading the limits from the document with pdf-lib and applying `maxlength` to
the widgets from outside the viewer, reapplied on mutation because widgets are
rebuilt on scroll and zoom. Works, but it needs the host app to parse the PDF a
second time purely to recover something the viewer already knows.

---

## 2. A multiline field with automatic font size is drawn at the field's full height, so it cannot wrap

**Type:** bug

### What happens

For a multiline text field with no explicit font size in its `/DA` string, the
font size is fitted to the field's **height**. That is right for a single-line
field and wrong for a multiline one: the result is one enormous line filling a
box that was authored to wrap.

### Steps to reproduce

1. Open the attached `form-types.pdf`.
2. Compare `field.multilineAuto` (multiline, automatic size) with
   `field.multiline` (multiline, explicit 10pt). Both are the same size.

### Expected

An automatically sized multiline field is drawn small enough to fit several
lines — Acrobat sizes these for wrapping, not for the box height.

### Actual

Both fields are `<textarea>`, both 69.8px tall as rendered:

| Field | Computed font size | Font size ÷ height |
| --- | --- | --- |
| `field.multilineAuto` (automatic) | **59.478px** | 0.85 |
| `field.multiline` (explicit 10pt) | 8.62px | 0.12 |

At 0.85 of the field's height, exactly one line is visible and the field cannot
show a second.

### Why it matters

Automatic sizing is the default in most form authoring tools, so this affects
the common case rather than an unusual one. A comments or address box — the
fields most likely to be multiline — is the worst affected.

### Workaround

A multiline widget computed at more than a third of its own height is reset to a
sixth of it. Expressed as a fraction rather than a pixel value, because widget
sizes scale with zoom.

---

## 3. An editable combo box (`Ff` bit 19) is rendered as `<select>`, so a custom value cannot be entered

**Type:** bug

### What happens

A combo box carrying the `Edit` flag lets the reader type a value that is not in
the option list. Every combo box renders as a plain `<select>`, which
structurally cannot hold a value outside its `<option>` set, so the custom value
has nowhere to go.

### Steps to reproduce

1. Open a PDF with a combo box whose `/Ff` has bit 19 (`Edit`) set.
2. Try to enter a value that is not one of the listed options.

### Expected

The field accepts arbitrary text while still offering the list, as Acrobat does.

### Actual

The widget is a `<select>` (confirmed: `tagName === "SELECT"`). Only listed
options can be chosen.

### Note

`@embedpdf/plugin-form` already exposes `setFormValues(values: Record<string, string>)`,
which writes any value into a field by name — so the missing piece looks like the
control rather than the plumbing. An `<input>` paired with a `<datalist>` of the
options would preserve the list while allowing a value outside it.

---

## 4. A push button is drawn into the page but has no interactive control

**Type:** bug

### What happens

With `render.withForms: true` a push button's appearance is drawn into the page
bitmap and looks like a button. There is **no HTML element** for it in the
widget layer, so it cannot be focused, pressed, or reached by keyboard.

### Steps to reproduce

1. Open the attached `form-types.pdf` with `render: { withForms: true }`.
2. Look for a widget named `field.submit`.

### Expected

Either an interactive control, or a documented statement that push buttons are
intentionally inert so hosts know not to expect one.

### Actual

Querying the widget layer for `[name="field.submit"]` returns **0 elements**,
while the button is plainly visible on the page. A control that looks pressable
and is not is worse than one that is not drawn at all.

### Note

Form *submission* being unimplemented is entirely reasonable — it is a route for
a document to reach the network, and several viewers deliberately skip it. But
push buttons also carry non-network actions (JavaScript, named actions, reset),
and a host application cannot implement any of them without an element to bind
to.

### Related

`render.withForms` defaults to **false**, which means interactive widget
appearances are not drawn at all by default. That default cost us real time —
buttons were invisible *and* inert, which reads as a rendering fault rather than
a configuration one. Worth calling out in the rendering docs, if it isn't
already.

## 5. The Export command uses `<a download>`, which silently does nothing in a non-browser webview

**Type:** bug

### What happens

The export plugin answers its Export command by clicking a hidden `<a download>`
element. That works in a browser tab. In an embedded webview with no download
manager, the click is ignored and **nothing happens at all** — no file, no
error, no event.

### Environment

Observed in a Tauri v2 packaged build on Windows (WebView2). The same shape
applies to any host webview without download handling: Electron with downloads
disabled, WKWebView, and so on.

### Steps to reproduce

1. Embed the viewer in a Tauri v2 app (or any webview without a download manager).
2. Invoke the viewer's own Export command from the document menu.

### Expected

Either the export reaches the host, or it fails loudly. A menu item that does
nothing when clicked is the worst of the three.

### Actual

Nothing observable happens. The command reports no error.

### Workaround

Catching the export plugin's own request event under Tauri and writing the file
through the OS save dialog instead. This works, and the plugin does expose the
event — which is the good news.

### Suggestion

A configuration option along the lines of `export: { handler }` — or simply
documenting the request event as the supported interception point for embedders
— would turn this from a discovery into a documented integration path. The event
is there; nothing says it is the thing to use.

---

## 6. No way to intercept `document:open` / `document:close` before they act

**Type:** feature request

### What happens

The document menu offers Open and Close, bound to Ctrl+O and Ctrl+W. A host
application that owns the document lifecycle — and needs to warn about unsaved
work before it is discarded — has no supported way to run first.

### Why it matters

Left alone these swap the document inside the viewer without the host hearing
about it: no unsaved-changes prompt, and a host toolbar still naming a file that
is no longer on screen. The shortcuts matter as much as the menu items; a
warning that Ctrl+W walks straight past is not a warning.

### What we tried

Recorded because two of the three obvious approaches fail, and the failures are
not obvious:

1. **Supplying `commands` in the viewer config** — replaces the *entire* command
   set rather than merging, which takes the whole UI down with it. Filed
   separately as issue 7.
2. **`onDocumentOpened` / `onDocumentClosed`** — these report after the fact,
   which is too late to ask the user anything.
3. **Re-registering `document:open` and `document:close` through the commands
   plugin at runtime** — works, and is what we do. Registering by id replaces the
   command in place, including its shortcut. It requires restating the label,
   icon, shortcuts and categories, because registration replaces the whole
   command rather than just its action.

### Ask

Either a documented before-hook (`onBeforeDocumentClose` returning a promise or
`false` to cancel), or confirmation that runtime re-registration is the supported
path — it works well, it just isn't written down anywhere as the answer.

---

## 7. A partial `commands` map in the viewer config replaces the whole command set and takes the UI down

**Type:** bug

### What happens

`PDFViewerConfig.commands.commands` is typed `Record<string, Command>` and is
**required** within `CommandsPluginConfig`. Supplying it to override a single
command replaces the entire default command map rather than merging into it. The
viewer's own UI still refers to the commands that are now gone, so the toolbar
and the page area both fail to render.

There is no way to express "override this one command" through the config, and
nothing in the types signals that a partial map is not a partial override.

### Steps to reproduce

Configure the viewer with one command:

```ts
commands: {
  commands: {
    'document:close': {
      id: 'document:close',
      label: 'Close',
      shortcuts: ['Ctrl+W'],
      action: () => undefined,
    },
  },
},
```

Then open any document.

### Expected

The supplied command overrides the default of the same id; every other command
keeps working. Failing that, a startup error naming the actual problem.

### Actual

Measured on 2026-09-03, same document and viewer in both runs:

| | Default config | With the one-command map |
| --- | --- | --- |
| Buttons in the viewer's shadow root | 22 | **0** |
| Rendered page images | 4 | **0** |
| Uncaught page errors | none | `Command not found: document:menu` |

The custom element and its shadow root are still present, so nothing looks
crashed from the outside — the viewer is simply empty, with no toolbar and no
page.

### Why it matters

The error names `document:menu` — the first missing command the UI happens to
reach for — which points at a command the host never touched. Nothing connects
it to the `commands` key in the config, so it reads as an internal fault rather
than a configuration mistake. We spent real time on this before concluding the
config key was the cause.

### Ask

Merge the supplied map over the defaults, or reject a partial map at startup
with an error that names the config key. Either would have turned this into a
minute's work.

### Note

The workaround is to register commands at runtime through the commands plugin
instead, which replaces a command in place and leaves the rest alone. That works
well — see issue 6, which asks for it to be documented.

---

## 8. `disabledCategories` cannot remove the Thumbnails tab or the Export menu item

**Type:** bug / feature request

### What happens

`disabledCategories` is the documented way to remove UI. Two items cannot be
removed with it:

- **The Thumbnails sidebar tab.** It is a `tabs` schema entry carrying no
  `categories`, so no category value can match it.
- **The Export menu item.** `disabledCategories: ['document-export']` leaves it
  in place — tried at the top level and under both `ui` and `commands`.

### Why it matters

A host that provides its own page-management UI ends up shipping two page views
side by side that cannot be told apart by looking. In this app that ambiguity
generated four separate bug reports — thumbnails "can't be dragged", "can't be
multi-selected", "can't be rotated" — every one of which turned out to be the
viewer's own navigation-only tab rather than the host's panel. The reports were
reasonable; the two views look alike and do different things.

Overriding `ui.schema` wholesale is the same trap as issue 7's `commands`: it
replaces rather than merges.

(Found later, 2026-09-28: calling the UI capability's `mergeSchema` after
start-up *does* merge sidebars by id, and redefining `sidebar-panel` to hold
only `outline-sidebar` removes the Thumbnails tab cleanly. So the Thumbnails
half of this has a workaround; say so if filing, and consider whether the
config-time `ui.schema` should merge the same way. The Export half stands.)

### Ask

Either give every schema entry a category, or provide a supported way to hide
individual entries by id.

