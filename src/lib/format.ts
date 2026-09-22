/** Formatting of values for display. Nothing here knows what a PDF is. */

/**
 * A byte count as a person would write it.
 *
 * Shown in the toolbar for every open document, not only after a size
 * reduction: "is this file big?" is the question that sends someone looking for
 * Reduce size in the first place, and it should be answerable without running
 * anything.
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${String(Math.round(bytes))} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.round(kb))} KB`;

  const mb = kb / 1024;
  // One decimal below 100 MB, none above it: "4.2 MB" is useful, "418.3 MB" is noise.
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${String(Math.round(mb))} MB`;
}
