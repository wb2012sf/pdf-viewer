// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  applyFieldFixes,
  multilineFontSize,
  needsSmallerFont,
  readFieldConstraints,
  type FieldConstraints,
} from './form-field-fixes';

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();

  const pin = form.createTextField('pin');
  pin.setMaxLength(4);
  pin.addToPage(page, { x: 10, y: 300, width: 100, height: 24, font });

  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 10, y: 180, width: 200, height: 80, font });

  const plain = form.createTextField('plain');
  plain.addToPage(page, { x: 10, y: 120, width: 200, height: 24, font });

  return doc.save();
}

describe('readFieldConstraints', () => {
  it('reads the limits the widgets do not carry', async () => {
    const constraints = await readFieldConstraints(await formPdf());

    expect(constraints.get('pin')?.maxLength).toBe(4);
    expect(constraints.get('notes')?.multiline).toBe(true);
  });

  it('ignores fields with nothing to fix', async () => {
    const constraints = await readFieldConstraints(await formPdf());

    // A plain single-line field with no limit needs no patching.
    expect(constraints.has('plain')).toBe(false);
  });

  it('returns nothing for bytes it cannot read, rather than throwing', async () => {
    // Failing to apply a nicety must never stop a document being opened.
    expect((await readFieldConstraints(new Uint8Array([1, 2, 3]))).size).toBe(0);
  });
});

describe('multilineFontSize', () => {
  it('leaves room for several lines', () => {
    expect(multilineFontSize(90)).toBe(15);
  });

  it('scales with the widget, so it stays right at any zoom', () => {
    // Widget sizes track the zoom level; a fixed pixel size would be wrong at
    // every zoom but one.
    expect(multilineFontSize(180)).toBe(multilineFontSize(90) * 2);
  });

  it('never shrinks to something unreadable', () => {
    expect(multilineFontSize(12)).toBe(8);
  });
});

describe('needsSmallerFont', () => {
  it('spots the one-enormous-line case', () => {
    expect(needsSmallerFont(59, 70)).toBe(true);
  });

  it('leaves a field that already fits alone', () => {
    expect(needsSmallerFont(8.6, 70)).toBe(false);
  });
});

describe('applyFieldFixes', () => {
  const constraints = new Map<string, FieldConstraints>([
    ['pin', { maxLength: 4, multiline: false }],
    ['notes', { multiline: true }],
  ]);

  function widgets(): HTMLDivElement {
    const root = window.document.createElement('div');
    root.innerHTML = `
      <input name="pin" type="text" />
      <textarea name="notes" style="font-size: 59px"></textarea>
    `;
    window.document.body.append(root);
    return root;
  }

  it('gives a max-length field the limit the PDF specifies', () => {
    const root = widgets();

    applyFieldFixes(root, constraints);

    expect(root.querySelector<HTMLInputElement>('[name="pin"]')?.maxLength).toBe(4);
  });

  it('trims a value that is already too long', () => {
    // The attribute alone only stops further typing; a value restored from the
    // document could already be over.
    const root = widgets();
    const pin = root.querySelector<HTMLInputElement>('[name="pin"]')!;
    pin.value = '123456';

    applyFieldFixes(root, constraints);

    expect(pin.value).toBe('1234');
  });

  it('does nothing to a field it has no constraint for', () => {
    const root = widgets();
    root.insertAdjacentHTML('beforeend', '<input name="other" type="text" />');

    applyFieldFixes(root, constraints);

    expect(root.querySelector<HTMLInputElement>('[name="other"]')?.maxLength).toBe(-1);
  });

  it('survives a field name that would otherwise break the selector', () => {
    // Field names come from the document and can contain anything.
    const root = window.document.createElement('div');
    root.innerHTML = '<input name="a.b[0]" type="text" />';

    expect(() =>
      applyFieldFixes(root, new Map([['a.b[0]', { maxLength: 2, multiline: false }]])),
    ).not.toThrow();
    expect(root.querySelector<HTMLInputElement>('[name="a.b[0]"]')?.maxLength).toBe(2);
  });
});
