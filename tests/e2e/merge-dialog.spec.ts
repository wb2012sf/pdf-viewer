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

test.describe('merge list drag reordering', () => {
  test.slow();

  /** Drags one queued document onto another with a real mouse. */
  async function dragRow(page: Page, from: number, to: number): Promise<void> {
    const source = (await page.getByTestId(`merge-item-${String(from)}`).boundingBox())!;
    const target = (await page.getByTestId(`merge-item-${String(to)}`).boundingBox())!;
    const startX = source.x + source.width / 3;
    const startY = source.y + source.height / 2;
    const endY = target.y + target.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(startX, startY + ((endY - startY) * step) / 6);
    }
    await page.mouse.up();
  }

  test('drags a document into a new position, and merges in that order', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);
    await expect(page.getByTestId('merge-total')).toHaveText('7 pages in 2 files', { timeout: 30_000 });

    await dragRow(page, 1, 0);

    await expect(page.getByTestId('merge-item-0')).toContainText('five.pdf');
    await page.getByTestId('merge-confirm').click();

    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    const merged = await saveAndLoad(page);
    // five.pdf leads now, so page 1 is one of its narrow pages.
    expect(Math.round(merged.getPage(0).getWidth())).toBe(100);
  });

  test('a press on a row button does not start a drag', async ({ page }) => {
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);
    await expect(page.getByTestId('merge-item-1')).toBeVisible({ timeout: 30_000 });

    // Pressing ↓ on the first row should move it, not drag it somewhere else.
    await page.getByTestId('merge-down-0').click();

    await expect(page.getByTestId('merge-item-0')).toContainText('five.pdf');
    await expect(page.getByTestId('merge-item-1')).toContainText('sample.pdf');
  });
});

test.describe('dropping several files at once', () => {
  test.slow();

  /** Drops files onto the window the way a file manager does. */
  async function dropFiles(page: Page, files: { name: string; path: string }[]): Promise<void> {
    const payload = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        buffer: (await readFile(file.path)).toString('base64'),
      })),
    );
    await page.evaluate((dropped) => {
      const transfer = new DataTransfer();
      for (const item of dropped) {
        const bytes = Uint8Array.from(atob(item.buffer), (char) => char.charCodeAt(0));
        transfer.items.add(new File([bytes], item.name, { type: 'application/pdf' }));
      }
      // React listens at its own root, so a drop dispatched on an ancestor of
      // the dropzone never reaches it. A file manager targets what is under the
      // pointer; here that is the dropzone itself.
      const target = document.querySelector('[data-testid="dropzone"]') ?? document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    }, payload);
  }

  test('offers the merge dialog rather than merging behind the reader', async ({ page }) => {
    // Dropping several files is an assembly job. Combining them silently gives
    // no chance to check or change the order, and the result is a document
    // nobody asked to be built that way.
    await page.goto('/');
    await expect(page.getByTestId('empty-state')).toBeVisible();

    await dropFiles(page, [
      { name: 'sample.pdf', path: SAMPLE_PDF },
      { name: 'five.pdf', path: FIVE_PDF },
    ]);

    await expect(page.getByTestId('merge-dialog')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('merge-total')).toHaveText('7 pages in 2 files', { timeout: 30_000 });
    await expect(page.getByTestId('merge-item-0')).toContainText('sample.pdf');
    await expect(page.getByTestId('merge-item-1')).toContainText('five.pdf');
  });

  test('a single dropped file still opens straight away', async ({ page }) => {
    // The dialog is for assembling; one file is just an open.
    await page.goto('/');
    await dropFiles(page, [{ name: 'sample.pdf', path: SAMPLE_PDF }]);

    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('merge-dialog')).toHaveCount(0);
    await expect(page.getByTestId('open-filename')).toHaveText('sample.pdf');
  });

  test('the merged result is not named after whichever file was first', async ({ page }) => {
    // "sample.pdf" for a document that is no longer sample.pdf invites saving
    // over the original.
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF]);
    await expect(page.getByTestId('merge-total')).toHaveText('7 pages in 2 files', { timeout: 30_000 });

    await page.getByTestId('merge-confirm').click();

    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('open-filename')).toHaveText('merged.pdf');
  });
});

test.describe('the arrows follow the document, not the position', () => {
  test.slow();

  const FORM_PDF = fileURLToPath(new URL('./fixtures/form.pdf', import.meta.url));
  const SCANNED_PDF = fileURLToPath(new URL('./fixtures/scanned.pdf', import.meta.url));

  async function queueFour(page: Page): Promise<void> {
    await openMergeDialog(page);
    await page.getByTestId('merge-dialog-input').setInputFiles([SAMPLE_PDF, FIVE_PDF, FORM_PDF, SCANNED_PDF]);
    await expect(page.getByTestId('merge-item-3')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('merge-item-0')).toContainText('sample.pdf');
  }

  test('keeps the keyboard on the document that moved', async ({ page }) => {
    // The row moves out from under the pointer, so the button that was just
    // pressed now belongs to a different document. Focus has to travel with the
    // document, or the next press acts on whatever took its place.
    await queueFour(page);

    await page.getByTestId('merge-down-0').click();

    await expect(page.getByTestId('merge-item-1')).toContainText('sample.pdf');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Move sample.pdf later');
  });

  test('pressing again moves the same document rather than its replacement', async ({ page }) => {
    await queueFour(page);

    await page.getByTestId('merge-down-0').click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('merge-item-3')).toContainText('sample.pdf');
  });

  test('reaching the end keeps the keyboard on the document rather than dropping it', async ({ page }) => {
    // The button just pressed is disabled once the document is last, so focus
    // would otherwise fall back to the page and the next key go nowhere.
    await queueFour(page);

    await page.getByTestId('merge-down-0').click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('merge-item-3')).toContainText('sample.pdf');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Move sample.pdf earlier');
  });
});
