import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

test('shows an empty state before a document is opened', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('open-filename')).toHaveText('No document open');

  await page.screenshot({ path: 'test-results/screenshots/empty-state.png', fullPage: true });
});

test('renders a PDF picked from disk', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);

  await expect(page.getByTestId('open-filename')).toHaveText('sample.pdf');
  await expect(page.getByTestId('empty-state')).toHaveCount(0);

  // EmbedPDF paints each page into an <img> inside its shadow root, so waiting
  // for one proves the PDFium WASM engine actually booted and produced a
  // bitmap, rather than the shell merely having mounted.
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

  await page.screenshot({ path: 'test-results/screenshots/document-open.png', fullPage: true });
});

test('loads the stamp gallery from the bundle rather than a CDN', async ({ page }) => {
  // The viewer normally fetches the rubber-stamp manifest and artwork from
  // jsDelivr as it starts. Both now come from the build, so the gallery has to
  // survive with no connection — see src/lib/viewer/stamps.ts.
  const served: string[] = [];
  const failed: string[] = [];
  page.on('response', (response) => served.push(response.url()));
  page.on('requestfailed', (request) => failed.push(request.url()));

  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

  // The plugin loads its library as it initialises, so the bundled artwork
  // being fetched is proof the local library was accepted; if the manifest were
  // malformed, nothing would ask for the PDF at all.
  await expect
    .poll(() => served.filter((url) => /\/assets\/stamps-[^/]+\.pdf$/.test(url)), { timeout: 30_000 })
    .toHaveLength(1);

  expect(failed).toEqual([]);
});
