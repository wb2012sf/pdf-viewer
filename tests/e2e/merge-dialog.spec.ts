import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));
const FIVE_PDF = fileURLToPath(new URL('./fixtures/five.pdf', import.meta.url));

async function openMergeDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('open-merge').click();
  await expect(page.getByTestId('merge-dialog')).toBeVisible();
}

async function saveAndLoad(page: Page): Promise<PDFDocument> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('save').click(),
  ]);
  return PDFDocument.load(new Uint8Array(await readFile(await download.path())), { ignoreEncryption: true });
}

test.describe('merge dialog', () => {
  test.slow();

  test('opens with no document loaded at all', async ({ page }) => {
    // Assembling documents from nothing is the case the page panel's Append
    // cannot serve, and the reason this exists separately.
    await page.goto('/');
    await expect(page.getByTestId('empty-state')).toBeVisible();

    await page.getByTestId('open-merge').click();

    await expect(page.getByTestId('merge-dialog')).toBeVisible();
    await expect(page.getByTestId('merge-empty')).toBeVisible();
  });

  test('will not merge until there are two documents', async ({ page }) => {
    await openMergeDialog(page);
    await expect(page.getByTestId('merge-confirm')).toBeDisabled();

    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF]);

    await expect(page.getByTestId('merge-item-0')).toBeVisible();
    await expect(page.getByTestId('merge-confirm')).toBeDisabled();
  });

  test('reports what the result will contain before writing anything', async ({ page }) => {
    await openMergeDialog(page);

    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);

    // 2 pages + 5 pages, counted as the files are added.
    await expect(page.getByTestId('merge-total')).toHaveText('7 pages in 2 files', { timeout: 30_000 });
  });

  test('merges in the order shown', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);
    await expect(page.getByTestId('merge-total')).toHaveText('7 pages in 2 files', { timeout: 30_000 });

    await page.getByTestId('merge-confirm').click();

    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    const merged = await saveAndLoad(page);
    expect(merged.getPageCount()).toBe(7);
    // sample.pdf's pages are 420pt wide, five.pdf's are 100–104.
    expect(Math.round(merged.getPage(0).getWidth())).toBe(420);
    expect(Math.round(merged.getPage(2).getWidth())).toBe(100);
  });

  test('respects a reordering before merging', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);
    await expect(page.getByTestId('merge-total')).toHaveText('7 pages in 2 files', { timeout: 30_000 });

    await page.getByTestId('merge-up-1').click();
    await page.getByTestId('merge-confirm').click();

    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    const merged = await saveAndLoad(page);
    // five.pdf now leads, so page 1 is one of its narrow pages.
    expect(Math.round(merged.getPage(0).getWidth())).toBe(100);
  });

  test('drops a document from the queue', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);
    await expect(page.getByTestId('merge-item-1')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('merge-remove-1').click();

    await expect(page.getByTestId('merge-item-1')).toHaveCount(0);
    await expect(page.getByTestId('merge-confirm')).toBeDisabled();
  });

  test('includes the open document, and will not let it be removed', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

    await page.getByTestId('open-merge').click();

    // The result replaces what is open, so taking it out would make Merge
    // quietly mean something else.
    await expect(page.getByTestId('merge-item-0')).toContainText('sample.pdf');
    await expect(page.getByTestId('merge-remove-0')).toBeDisabled();
  });

  test('rejects something that is not a readable PDF as it is added', async ({ page }) => {
    await openMergeDialog(page);

    await page.getByTestId('merge-dialog-input').setInputFiles({
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a pdf at all'),
    });

    // Named when it is added, rather than taking the whole batch down later.
    await expect(page.getByTestId('merge-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('merge-confirm')).toBeDisabled();
  });

  test('closes without touching the document', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

    await page.getByTestId('open-merge').click();
    await page.getByTestId('merge-cancel').click();

    await expect(page.getByTestId('merge-dialog')).toHaveCount(0);
    await expect(page.getByTestId('open-filename')).toHaveText('sample.pdf');
  });
});
