import { DEFAULT_JPEG_QUALITY, DEFAULT_TARGET_DPI, type CompressionReport } from '../lib/pdf/compress';

/**
 * The resolutions offered for size reduction, and the words used to report what
 * one achieved.
 *
 * Beside `ReduceSizeDialog` rather than inside it, the way `page-panel-size.ts`
 * sits beside `PagePanel`: the summary is rendered in the toolbar, not in the
 * dialog, and the wording is worth testing without rendering anything at all.
 */

/** One of the resolutions offered, named for what the result is *for*. */
export interface SizePreset {
  id: string;
  label: string;
  description: string;
  dpi: number;
  quality: number;
}

/**
 * Named for the destination rather than the number, because "150 DPI" is not a
 * decision anyone outside prepress can make. The DPI is still shown: someone
 * who does know what they want should not have to guess which preset hides it.
 */
export const SIZE_PRESETS: readonly SizePreset[] = [
  {
    id: 'screen',
    label: 'Screen',
    description: 'Smallest file. Fine to read on a screen, coarse in print.',
    dpi: 72,
    quality: 0.6,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Much smaller, still sharp on paper. A good default.',
    dpi: DEFAULT_TARGET_DPI,
    quality: DEFAULT_JPEG_QUALITY,
  },
  {
    id: 'print',
    label: 'Print',
    description: 'Keeps photographic detail. Saves least.',
    dpi: 300,
    quality: 0.85,
  },
];

export const DEFAULT_PRESET_ID = 'balanced';

/** A byte count as a person would write it. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${String(Math.round(bytes))} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.round(kb))} KB`;

  const mb = kb / 1024;
  // One decimal below 100 MB, none above it: "4.2 MB" is useful, "418.3 MB" is noise.
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${String(Math.round(mb))} MB`;
}

/**
 * What a finished run should say in the toolbar.
 *
 * "Nothing changed" is reported as plainly as a saving is. A reduction that
 * quietly did nothing, on a file the user can see is still 40 MB, reads as a
 * broken feature rather than as a file that was already small.
 *
 * Kept to a few words: this shares one toolbar row with the document's name and
 * six buttons, and a sentence long enough to be comfortable squeezes all of
 * them. The images it touched are not named here — the percentage already says
 * whether anything happened.
 */
export function reductionSummary(report: CompressionReport): string {
  if (!report.changed) {
    if (report.imagesFound === 0) return 'No images to reduce';
    return `No further reduction — still ${formatSize(report.originalSize)}`;
  }

  const saved = Math.round((1 - report.newSize / report.originalSize) * 100);
  return `${formatSize(report.originalSize)} → ${formatSize(report.newSize)} (${String(saved)}% smaller)`;
}

/** Marker appended to a reduced document's name. */
const REDUCED_SUFFIX = '-reduced';

/**
 * What to call the reduced copy of `name`.
 *
 * A reduction is lossy and cannot be undone: offering it back under the
 * original's name pre-fills the Save dialog with that name, and one click
 * through it in the original's folder destroys the high-resolution images for
 * good. The same reasoning names a merged document `merged.pdf` and an
 * extracted one `-pages.pdf` — a derived document gets a derived name.
 */
export function reducedFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  // A leading dot is a hidden file, not an extension.
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];

  // Reducing twice is a legitimate thing to do — at a lower resolution, or
  // after annotating — and "-reduced-reduced.pdf" says nothing the first one did not.
  if (stem.endsWith(REDUCED_SUFFIX)) return name;

  return `${stem}${REDUCED_SUFFIX}${extension}`;
}
