import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const SCANNED_PDF = fileURLToPath(new URL('./fixtures/scanned.pdf', import.meta.url));

// A real OCR run loads a WASM core and 4 MB of language data, then recognizes a
// page at 4x. That is slow by nature, not a sign of a hang.
const OCR_TIMEOUT = 180_000;

test.describe('OCR', () => {
  test.slow();

  test('is offered only once a document is open', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('ocr-run')).toHaveCount(0);

    await page.getByTestId('file-input').setInputFiles(SCANNED_PDF);

    await expect(page.getByTestId('ocr-run')).toBeVisible();
  });

  test('becomes available once the viewer hands over its engine', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(SCANNED_PDF);

    await expect(page.getByTestId('ocr-run')).toBeEnabled({ timeout: 60_000 });
  });

  test('makes a scanned page searchable without any network access', async ({ page, context }) => {
    // The promise of this app is that it works offline, and Tesseract fetches
    // its worker, its WASM core and its language data from a CDN unless told
    // otherwise — so this watches for any request that leaves the app's origin.
    //
    // Recording rather than blocking: installing a route handler at all stops
    // the viewer resolving the blob: URL it is given, so an enforced blackout
    // would fail for a reason that has nothing to do with OCR.
    const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:4173').origin;
    const offOrigin: string[] = [];
    context.on('request', (request) => {
      const url = request.url();
      if ((url.startsWith('http://') || url.startsWith('https://')) && !url.startsWith(origin)) {
        offOrigin.push(url);
      }
    });

    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(SCANNED_PDF);
    await expect(page.getByTestId('ocr-run')).toBeEnabled({ timeout: 60_000 });

    await page.getByTestId('ocr-run').click();

    // Progress must actually be reported: a silent multi-minute wait is
    // indistinguishable from a hang.
    await expect(page.getByTestId('ocr-progress')).toBeVisible();

    const done = page.getByTestId('ocr-done');
    await expect(done).toBeVisible({ timeout: OCR_TIMEOUT });
    await expect(done).toContainText(/Added \d+ searchable words?/);

    // Nothing may have gone off-origin: not for the worker, the core, or the
    // 4 MB of language data.
    expect(offOrigin).toEqual([]);

    // The viewer reopens on the searchable copy; wait for it to finish so the
    // screenshot shows the result rather than a loading spinner.
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: 'test-results/screenshots/ocr-complete.png', fullPage: true });
  });

  test('finds the words that are actually on the page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(SCANNED_PDF);
    await expect(page.getByTestId('ocr-run')).toBeEnabled({ timeout: 60_000 });

    await page.getByTestId('ocr-run').click();
    await expect(page.getByTestId('ocr-done')).toBeVisible({ timeout: OCR_TIMEOUT });

    // The fixture says INVOICE and TOTAL in large bold type. A pipeline that
    // runs but recognizes nothing usable would still report success, so this
    // asserts on the count rather than on the absence of an error.
    const summary = (await page.getByTestId('ocr-done').textContent()) ?? '';
    const added = Number(/Added (\d+) searchable/.exec(summary)?.[1] ?? '0');

    expect(added).toBeGreaterThanOrEqual(2);
  });

  test('keeps the document on screen after OCR', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(SCANNED_PDF);
    await expect(page.getByTestId('ocr-run')).toBeEnabled({ timeout: 60_000 });

    await page.getByTestId('ocr-run').click();
    await expect(page.getByTestId('ocr-done')).toBeVisible({ timeout: OCR_TIMEOUT });

    // The viewer is reopened on the new bytes, so the scan must still be
    // rendered — under the name of what it now is, since the searchable copy is
    // not the file that was opened.
    await expect(page.getByTestId('open-filename')).toHaveText('scanned-searchable.pdf');
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
  });
});
