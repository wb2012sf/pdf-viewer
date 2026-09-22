import { describe, expect, it } from 'vitest';
import { CHANGE_MARKERS, derivedName, hasChangeMarker } from './derived-name';

describe('derivedName', () => {
  it.each([
    ['report.pdf', 'edited', 'report-edited.pdf'],
    ['report.pdf', 'searchable', 'report-searchable.pdf'],
    ['report.pdf', 'reduced', 'report-reduced.pdf'],
  ] as const)('names a %s document that was %s as %s', (name, change, expected) => {
    expect(derivedName(name, change)).toBe(expected);
  });

  it('keeps the extension it was given, whatever its case', () => {
    expect(derivedName('SCAN.PDF', 'searchable')).toBe('SCAN-searchable.PDF');
  });

  it('copes with a name that carries no extension', () => {
    expect(derivedName('report', 'edited')).toBe('report-edited');
  });

  it('leaves dots inside the name alone', () => {
    expect(derivedName('2026.08.invoice.pdf', 'edited')).toBe('2026.08.invoice-edited.pdf');
  });

  it('treats a leading dot as a hidden file rather than an extension', () => {
    expect(derivedName('.scan', 'edited')).toBe('.scan-edited');
  });

  it('replaces the marker already there rather than stacking another on it', () => {
    // Three operations in a row must not produce "-edited-reduced-searchable".
    expect(derivedName('report-edited.pdf', 'reduced')).toBe('report-reduced.pdf');
    expect(derivedName('report-reduced.pdf', 'searchable')).toBe('report-searchable.pdf');
  });

  it('is unchanged by repeating the same kind of change', () => {
    expect(derivedName('report-edited.pdf', 'edited')).toBe('report-edited.pdf');
  });

  it('only strips a marker that ends the name, not one buried in it', () => {
    // A document the user themselves called this is not one of ours.
    expect(derivedName('reduced-staff-list.pdf', 'edited')).toBe('reduced-staff-list-edited.pdf');
    expect(derivedName('my-edited-notes.pdf', 'reduced')).toBe('my-edited-notes-reduced.pdf');
  });
});

describe('hasChangeMarker', () => {
  it('recognises every marker this app writes', () => {
    for (const marker of Object.values(CHANGE_MARKERS)) {
      expect(hasChangeMarker(`report${marker}.pdf`)).toBe(true);
    }
  });

  it('does not claim an untouched document', () => {
    expect(hasChangeMarker('report.pdf')).toBe(false);
    expect(hasChangeMarker('reduced-staff-list.pdf')).toBe(false);
  });
});
