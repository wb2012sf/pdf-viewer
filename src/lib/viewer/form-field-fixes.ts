import { PDFDocument } from 'pdf-lib';

/**
 * Repairs two form-widget defects in the viewer, from outside it.
 *
 * Both are EmbedPDF's (see `KNOWN-ISSUES.md`), but both make a document
 * unusable rather than merely untidy, so they are patched here rather than
 * waiting on a release:
 *
 *  - a `MaxLen` field accepts and saves any length, because the widget carries
 *    no `maxlength`;
 *  - a multiline field with no explicit font size is drawn at a size fitted to
 *    the field's *height*, so one enormous line fills a box meant to wrap.
 *
 * This reaches into the viewer's shadow DOM, which is not a boundary it invites
 * anyone through — so it is written to fail quietly and change nothing it does
 * not recognise. If a viewer release fixes either defect, the corresponding
 * `test.fail()` in `tests/e2e/form-field-types.spec.ts` starts passing and this
 * can go.
 */

/** What the PDF says about a field, which the widget does not carry. */
export interface FieldConstraints {
  maxLength?: number;
  multiline: boolean;
}

/**
 * Reads the constraints the widgets are missing, keyed by field name.
 *
 * Returns an empty map for a document pdf-lib cannot read: the fixes are a
 * nicety, and failing to apply them must never stop a file being opened.
 */
export async function readFieldConstraints(bytes: Uint8Array): Promise<Map<string, FieldConstraints>> {
  const constraints = new Map<string, FieldConstraints>();

  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const field of doc.getForm().getFields()) {
      // Only text fields carry either property.
      const maxLength = 'getMaxLength' in field ? (field as { getMaxLength(): number | undefined }).getMaxLength() : undefined;
      const multiline = 'isMultiline' in field ? (field as { isMultiline(): boolean }).isMultiline() : false;

      if (maxLength !== undefined || multiline) {
        constraints.set(field.getName(), {
          ...(maxLength !== undefined ? { maxLength } : {}),
          multiline,
        });
      }
    }
  } catch {
    // A document the viewer renders but pdf-lib refuses; nothing to apply.
  }
  return constraints;
}

/**
 * The largest font size that still leaves a multiline box able to wrap.
 *
 * Expressed as a fraction of the widget's height rather than a fixed pixel
 * size, because widget sizes scale with the zoom level — a fixed size would
 * come out wrong at every zoom but one.
 */
export function multilineFontSize(heightPx: number): number {
  return Math.max(8, heightPx / 6);
}

/** True when the widget is drawn too large for the lines it is meant to hold. */
export function needsSmallerFont(fontSizePx: number, heightPx: number): boolean {
  return fontSizePx > heightPx / 3;
}

/** Applies both fixes to whatever widgets are currently in `root`. */
export function applyFieldFixes(root: ParentNode, constraints: ReadonlyMap<string, FieldConstraints>): void {
  for (const [name, field] of constraints) {
    // Field names come from the document, so they are escaped rather than
    // interpolated into a selector directly.
    const widget = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!widget) continue;

    if (field.maxLength !== undefined && widget instanceof HTMLInputElement) {
      if (widget.maxLength !== field.maxLength) widget.maxLength = field.maxLength;
      // A value already longer than the limit is trimmed: the attribute alone
      // only stops further typing.
      if (widget.value.length > field.maxLength) {
        widget.value = widget.value.slice(0, field.maxLength);
        widget.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    if (field.multiline && widget instanceof HTMLTextAreaElement) {
      const height = widget.getBoundingClientRect().height;
      const fontSize = parseFloat(window.getComputedStyle(widget).fontSize);
      if (height > 0 && Number.isFinite(fontSize) && needsSmallerFont(fontSize, height)) {
        widget.style.fontSize = `${String(multilineFontSize(height))}px`;
      }
    }
  }
}

/**
 * Keeps the fixes applied as widgets come and go.
 *
 * Widgets are created and destroyed as pages scroll in and out and as the zoom
 * changes, so a one-shot pass would only hold until the first scroll.
 *
 * Returns a function that stops watching.
 */
export function watchFormFields(
  root: ParentNode & Node,
  constraints: ReadonlyMap<string, FieldConstraints>,
): () => void {
  if (constraints.size === 0) return () => undefined;

  applyFieldFixes(root, constraints);

  const observer = new MutationObserver(() => {
    applyFieldFixes(root, constraints);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

  return () => {
    observer.disconnect();
  };
}
