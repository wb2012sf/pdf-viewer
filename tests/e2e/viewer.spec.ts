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

  // PDFium renders each page to a canvas; waiting on one proves the WASM
  // engine actually booted rather than the shell merely mounting.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  await page.screenshot({ path: 'test-results/screenshots/document-open.png', fullPage: true });
});
