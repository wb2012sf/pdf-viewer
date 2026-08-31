// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PdfAnnotationName } from '@embedpdf/models';
import { defaultStampLibrary, toAnnotationName } from './stamps';

describe('toAnnotationName', () => {
  it('resolves a manifest name to the annotation it stands for', () => {
    expect(toAnnotationName('Approved')).toBe(PdfAnnotationName.Approved);
    expect(toAnnotationName('NotForPublicRelease')).toBe(PdfAnnotationName.NotForPublicRelease);
  });

  it('rejects a name the enum does not define', () => {
    // Otherwise it would resolve to undefined and produce a stamp that cannot
    // be placed, with nothing said at build or run time.
    expect(() => toAnnotationName('Sparkles')).toThrow(/not a PDF annotation name/);
  });

  it('rejects a numeric-enum reverse lookup', () => {
    // `PdfAnnotationName[13]` answers 'Approved', so a manifest carrying "13"
    // would otherwise pass and yield a string where a number belongs.
    expect(() => toAnnotationName('13')).toThrow(/not a PDF annotation name/);
  });
});

describe('defaultStampLibrary', () => {
  const library = defaultStampLibrary();

  it('carries the standard gallery', () => {
    expect(library.stamps.length).toBeGreaterThanOrEqual(17);
    expect(library.stamps.map((stamp) => stamp.subject)).toEqual(
      expect.arrayContaining(['Approved', 'Draft', 'Confidential', 'Sign Here']),
    );
  });

  it('maps every stamp to a real annotation name', () => {
    // A single bad entry in the bundled manifest would otherwise only show up
    // when someone clicked that stamp.
    for (const stamp of library.stamps) {
      expect(typeof stamp.name).toBe('number');
      expect(PdfAnnotationName[stamp.name]).toBeDefined();
    }
  });

  it('gives every stamp a distinct id', () => {
    const ids = library.stamps.map((stamp) => stamp.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points at a bundled asset rather than a CDN', () => {
    // The whole reason this module exists.
    expect(typeof library.pdf).toBe('string');
    expect(library.pdf).not.toMatch(/^https?:\/\/(cdn|unpkg|fonts)\./);
  });

  it('resolves the artwork to an absolute URL', () => {
    // The stamp PDF is opened through the engine, which runs in a worker; a
    // relative URL would resolve against the worker's own location.
    expect(library.pdf).toMatch(/^https?:\/\//);
  });

  it('marks the bundled gallery read-only', () => {
    expect(library.readonly).toBe(true);
  });
});
