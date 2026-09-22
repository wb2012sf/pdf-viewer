/**
 * What to call a document once this app has changed it.
 *
 * Every operation here hands back a *new* document and reopens the viewer on
 * it, while the file it came from is still sitting on disk. Offering that new
 * document back under the old name pre-fills the Save dialog with the original,
 * and one click through it — in the folder the original lives in — writes over
 * a file the user never meant to touch. Some of those changes cannot be undone
 * from the result: a size reduction has thrown the resolution away, and a
 * deleted page is not in the bytes any more.
 *
 * So a derived document gets a derived name. Merge, extract and split already
 * did this on their own (`merged.pdf`, `-pages.pdf`, `-part-N.pdf`); this is
 * the same rule for everything that replaces the document in place.
 */

/** The kinds of change this app makes to an open document. */
export type DocumentChange = 'edited' | 'searchable' | 'reduced';

/**
 * Suffix per kind of change.
 *
 * `edited` deliberately covers rotate, delete, reorder, append *and* annotating
 * in the viewer. Naming each of them separately would mean deciding what to
 * call a document that was rotated and then had a page removed, and the name
 * only has to be different and recognisable — not a changelog.
 */
export const CHANGE_MARKERS: Record<DocumentChange, string> = {
  edited: '-edited',
  searchable: '-searchable',
  reduced: '-reduced',
};

/** Splits a filename into the part before the extension and the extension. */
function splitExtension(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.');
  // A leading dot makes a hidden file, not an extension.
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/** The marker `stem` already ends with, if any. */
function trailingMarker(stem: string): string | null {
  return Object.values(CHANGE_MARKERS).find((marker) => stem.endsWith(marker)) ?? null;
}

/** Whether `name` already carries one of this app's markers. */
export function hasChangeMarker(name: string): boolean {
  return trailingMarker(splitExtension(name)[0]) !== null;
}

/**
 * The name for `name` after `change`.
 *
 * Markers replace rather than accumulate: rotating a page, reducing the result
 * and then running OCR gives `report-searchable.pdf`, not
 * `report-edited-reduced-searchable.pdf`. Only a marker at the very end of the
 * name is replaced, so a document the user called `reduced-staff-list.pdf`
 * keeps the word they chose.
 */
export function derivedName(name: string, change: DocumentChange): string {
  const [stem, extension] = splitExtension(name);
  const existing = trailingMarker(stem);
  const base = existing === null ? stem : stem.slice(0, -existing.length);

  return `${base}${CHANGE_MARKERS[change]}${extension}`;
}
