import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

const PHOTO_PDF = fileURLToPath(new URL('./fixtures/photo.pdf', import.meta.url));
const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

/**
 * Exercises size reduction in a real browser, which is the only place the
 * decode-scale-encode half of it exists at all: `lib/pdf/compress.ts` is tested
 * headlessly against a stub resampler, and this is what proves the canvas
 * actually hands back a smaller JPEG that PDFium can still draw.
 */

async function open(page: Page, file: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

interface SavedDocument {
  /** The name the save was offered under — what a Save dialog would pre-fill. */
  filename: string;
  images: { width: number; height: number; bytes: number }[];
}

/** Saves the open document and reads back what actually landed. */
async function save(page: Page): Promise<SavedDocument> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('save').click(),
  ]);
  const doc = await PDFDocument.load(new Uint8Array(await readFile(await download.path())), {
    ignoreEncryption: true,
  });

  const images: { width: number; height: number; bytes: number }[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (String(object.dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    images.push({
      width: Number(object.dict.get(PDFName.of('Width'))?.toString() ?? 0),
      height: Number(object.dict.get(PDFName.of('Height'))?.toString() ?? 0),
      bytes: object.contents.byteLength,
    });
  }
  return { filename: download.suggestedFilename(), images };
}

test.describe('reducing the file size', () => {
  test('downsamples the photograph and says how much it saved', async ({ page }) => {
    await open(page, PHOTO_PDF);

    const before = await save(page);
    expect(before.images).toHaveLength(1);
    expect(before.filename).toBe('photo.pdf');
    // The fixture: 2448x3168 px filling an 11 in page, so 288 DPI.
    expect(before.images[0]?.width).toBe(2448);

    await page.getByTestId('open-reduce').click();
    await expect(page.getByTestId('reduce-dialog')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/reduce-dialog.png', fullPage: true });

    // Screen: 72 DPI, a quarter of the fixture's resolution on each edge.
    await page.getByTestId('reduce-preset-screen').click();
    await page.getByTestId('reduce-confirm').click();

    const summary = page.getByTestId('reduce-summary');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    // "190 KB → 30 KB (84% smaller)" — the arrow is the reduction.
    await expect(summary).toContainText('→');
    await expect(summary).toContainText('smaller');

    // The viewer is showing the reduced document, not a blank frame where one
    // used to be — the screenshot is reviewed for what the photo now looks like.
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: 'test-results/screenshots/reduce-complete.png', fullPage: true });

    const after = await save(page);
    expect(after.images).toHaveLength(1);
    // The reduction is lossy, so it must not be offered back under the name of
    // the file it was made from — saving over that original is unrecoverable.
    expect(after.filename).toBe('photo-reduced.pdf');
    // 3168 px over 11 in reduced to 72 DPI is 792 px on the long edge.
    expect(after.images[0]?.height).toBeLessThanOrEqual(820);
    expect(after.images[0]?.height).toBeGreaterThan(700);
    // The point of the whole exercise.
    expect(after.images[0]?.bytes).toBeLessThan((before.images[0]?.bytes ?? 0) / 2);
  });

  test('says plainly when a document has no images to reduce', async ({ page }) => {
    await open(page, SAMPLE_PDF);

    await page.getByTestId('open-reduce').click();
    await page.getByTestId('reduce-confirm').click();

    // A text-only document cannot be made smaller this way, and pretending
    // otherwise is how a feature looks broken.
    await expect(page.getByTestId('reduce-summary')).toContainText('No images to reduce', { timeout: 60_000 });
  });

  test('leaves a document alone when it is already at the target resolution', async ({ page }) => {
    await open(page, PHOTO_PDF);
    const originalSize = (await stat(PHOTO_PDF)).size;

    await page.getByTestId('open-reduce').click();
    // Print keeps 300 DPI, and the fixture is 288 — under the target already.
    await page.getByTestId('reduce-preset-print').click();
    await page.getByTestId('reduce-confirm').click();

    await expect(page.getByTestId('reduce-summary')).toContainText('No further reduction', {
      timeout: 60_000,
    });

    const after = await save(page);
    expect(after.images[0]?.width).toBe(2448);
    // Nothing was thrown away, so there is nothing to rename away from.
    expect(after.filename).toBe('photo.pdf');
    expect(originalSize).toBeGreaterThan(0);
  });
});
