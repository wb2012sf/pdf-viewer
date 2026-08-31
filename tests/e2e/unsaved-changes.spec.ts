import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

/** Makes a change inside the viewer, which is what the warning has to notice. */
async function rotateAPage(page: Page): Promise<void> {
  await page.getByTestId('toggle-pages').click();
  await page.getByTestId('page-0').check();
  await page.getByTestId('pages-rotate-right').click();
  await expect(page.getByTestId('page-0-rotation')).toHaveText('90°', { timeout: 60_000 });
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

/**
 * Makes a change *inside the viewer* rather than through this app's own
 * controls — an annotation, which the app never sees directly and has to ask
 * the viewer about.
 */
async function stampThePage(page: Page): Promise<void> {
  await page.getByText('Insert', { exact: true }).click();

  const tool = await page.evaluate(() => {
    const element = document
      .querySelector('embedpdf-container')
      ?.shadowRoot?.querySelector('[aria-label="Rubber Stamp"]');
    const rect = element!.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(tool.x, tool.y);
  await page.waitForTimeout(2500);

  const thumb = await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    const element = Array.from(root!.querySelectorAll('img')).filter((img) => {
      const width = img.getBoundingClientRect().width;
      return width > 10 && width < 120;
    })[0]!;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(thumb.x, thumb.y);
  await page.waitForTimeout(1500);

  const target = await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    const rect = Array.from(root!.querySelectorAll('img'))
      .map((img) => img.getBoundingClientRect())
      .filter((box) => box.width > 200)
      .sort((a, b) => b.width - a.width)[0]!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 3 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(2500);
}

test.describe('unsaved changes', () => {
  test.slow();

  test('warns before closing after an annotation, not just after a page operation', async ({ page }) => {
    // Annotating happens entirely inside the viewer: this app is never told,
    // and nothing re-renders it. Asking at render time therefore reads a stale
    // answer — which is how this shipped broken.
    await openSample(page);
    await stampThePage(page);

    await page.getByTestId('close').click();

    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  });

  test('warns before opening another document after an annotation', async ({ page }) => {
    await openSample(page);
    await stampThePage(page);

    await page.getByTestId('open-pdf').click();

    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  });

  test('closes straight away when nothing has been changed', async ({ page }) => {
    // Warning about work that does not exist trains people to click through
    // warnings that do.
    await openSample(page);

    await page.getByTestId('close').click();

    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('warns before closing a document with changes', async ({ page }) => {
    await openSample(page);
    await rotateAPage(page);

    await page.getByTestId('close').click();

    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await expect(page.getByTestId('confirm-message')).toContainText('not been written to a file');
    // Still open behind the dialog.
    await expect(page.getByTestId('open-filename')).toHaveText('sample.pdf');
  });

  test('cancelling the warning leaves the document exactly where it was', async ({ page }) => {
    await openSample(page);
    await rotateAPage(page);
    await page.getByTestId('close').click();

    await page.getByTestId('confirm-cancel').click();

    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(page.getByTestId('open-filename')).toHaveText('sample.pdf');
    // And the change is still there, not quietly rolled back.
    await expect(page.getByTestId('page-0-rotation')).toHaveText('90°');
  });

  test('discarding closes the document', async ({ page }) => {
    await openSample(page);
    await rotateAPage(page);
    await page.getByTestId('close').click();

    await page.getByTestId('confirm-discard').click();

    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('open-filename')).toHaveText('No document open');
  });

  test('saving from the warning writes the file and then closes', async ({ page }) => {
    await openSample(page);
    await rotateAPage(page);
    await page.getByTestId('close').click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('confirm-save').click(),
    ]);

    expect(download.suggestedFilename()).toBe('sample.pdf');
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 30_000 });
  });

  test('warns before opening another document over unsaved work', async ({ page }) => {
    await openSample(page);
    await rotateAPage(page);

    await page.getByTestId('open-pdf').click();

    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await expect(page.getByTestId('confirm-discard')).toHaveText('Discard and open');
  });

  test('stops warning once the document has been saved', async ({ page }) => {
    await openSample(page);
    await rotateAPage(page);

    await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('save').click(),
    ]);

    await page.getByTestId('close').click();

    // The work is on disk now, so there is nothing left to warn about.
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('the save button is labelled Save as', async ({ page }) => {
    await openSample(page);

    await expect(page.getByTestId('save')).toHaveText('Save as…');
  });

  test('close leaves the app ready for another document', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('close').click();
    await expect(page.getByTestId('empty-state')).toBeVisible();

    await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);

    await expect(page.getByTestId('open-filename')).toHaveText('sample.pdf');
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
  });
});
