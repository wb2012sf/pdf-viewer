import { DEFAULT_JPEG_QUALITY, DEFAULT_TARGET_DPI, type CompressionReport } from '../lib/pdf/compress';
import { formatSize } from '../lib/format';

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

/**
 * What a finished run should say in the toolbar.
 *
 * "Nothing changed" is reported as plainly as a saving is. A reduction that
 * quietly did nothing, on a file the user can see is still 40 MB, reads as a
 * broken feature rather than as a file that was already small.
 *
 * Says only what the size shown beside the filename cannot. That figure is the
 * document's size now, so repeating it here would spend half of a crowded
 * toolbar row saying the same thing twice; what it cannot say is where the
 * document started, which is gone the moment the reduction lands.
 */
export function reductionSummary(report: CompressionReport): string {
  if (!report.changed) {
    if (report.imagesFound === 0) return 'No images to reduce';
    return 'No further reduction at this resolution';
  }

  const saved = Math.round((1 - report.newSize / report.originalSize) * 100);
  return `was ${formatSize(report.originalSize)} (${String(saved)}% smaller)`;
}
