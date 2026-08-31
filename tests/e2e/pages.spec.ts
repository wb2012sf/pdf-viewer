import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('toggle-pages').click();
  await expect(page.getByTestId('page-panel')).toBeVisible();
}

/** Saves the open document and reads it back with pdf-lib. */
async function saveAndLoad(page: Page): Promise<PDFDocument> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('save').click(),
  ]);
  return PDFDocument.load(new Uint8Array(await readFile(await download.path())), { ignoreEncryption: true });
}

/**
 * Which of the fixture's headings page 1 carries — the only way to tell the two
 * pages apart, since they are the same size.
 *
 * pdf-lib cannot extract text, so this reads the page's content stream and
 * looks for the heading's glyphs, which pdf-lib writes as uppercase hex.
 */
function firstPageHeading(doc: PDFDocument): 'First page' | 'Second page' | 'unknown' {
  const contents = doc.getPage(0).node.Contents();
  if (!contents) return 'unknown';

  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const text = streams
    .map((stream) => (stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : new Uint8Array()))
    .map((bytes) => new TextDecoder('latin1').decode(bytes))
    .join('');

  const hex = (value: string): string =>
    [...value].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join('');

  if (text.includes(hex('First page'))) return 'First page';
  if (text.includes(hex('Second page'))) return 'Second page';
  return 'unknown';
}

/** Waits for the viewer to finish reopening on the rewritten document. */
async function viewerSettles(page: Page): Promise<void> {
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

test.describe('page operations', () => {
  test.slow();

  test('lists the pages of the open document', async ({ page }) => {
    await openSample(page);

    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2);

    // With page 1 ticked, "move earlier" has nowhere to go and "move later"
    // does — the screenshot is reviewed for the panel's layout as a whole.
    await page.getByTestId('page-0').check();
    await expect(page.getByTestId('pages-move-up')).toBeDisabled();
    await expect(page.getByTestId('pages-move-down')).toBeEnabled();

    await page.screenshot({ path: 'test-results/screenshots/page-panel.png', fullPage: true });
  });

  test('rotates a page, and the rotation survives saving', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-rotate-right').click();

    // The panel re-reads rotations from the rewritten bytes, so this appearing
    // means the operation actually landed rather than just being requested.
    await expect(page.getByTestId('page-0-rotation')).toHaveText('90°', { timeout: 60_000 });
    await viewerSettles(page);

    const saved = await saveAndLoad(page);
    expect(saved.getPage(0).getRotation().angle).toBe(90);
    expect(saved.getPage(1).getRotation().angle).toBe(0);
  });

  test('deletes a page, and the document really loses it', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-delete').click();

    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(1, { timeout: 60_000 });
    await viewerSettles(page);

    const saved = await saveAndLoad(page);
    expect(saved.getPageCount()).toBe(1);
  });

  test('will not delete every page', async ({ page }) => {
    // A zero-page PDF is a file nothing will open.
    await openSample(page);
    await page.getByTestId('pages-select-all').click();

    await expect(page.getByTestId('pages-delete')).toBeDisabled();
  });

  test('reorders pages, and the new order is what gets saved', async ({ page }) => {
    await openSample(page);

    // Both fixture pages are the same size, so page identity has to come from
    // what is drawn on them: page 1 reads "First page", page 2 "Second page".
    await expect
      .poll(() => saveAndLoad(page).then(firstPageHeading))
      .toBe('First page');

    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-move-down').click();
    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2, { timeout: 60_000 });
    await viewerSettles(page);

    const after = await saveAndLoad(page);
    expect(after.getPageCount()).toBe(2);
    expect(firstPageHeading(after)).toBe('Second page');
  });

  test('merges another document onto the end', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('merge-input').setInputFiles(SAMPLE_PDF);

    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(4, { timeout: 60_000 });
    await viewerSettles(page);

    expect((await saveAndLoad(page)).getPageCount()).toBe(4);
  });

  test('extracts the selected pages to a separate file, leaving the original alone', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('page-1').check();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('pages-extract').click(),
    ]);
    const extracted = await PDFDocument.load(new Uint8Array(await readFile(await download.path())), {
      ignoreEncryption: true,
    });

    expect(extracted.getPageCount()).toBe(1);
    expect(download.suggestedFilename()).toBe('sample-pages.pdf');
    // Extract produces something alongside the original; it must not edit it.
    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2);
  });

  test('keeps annotations made before a page operation', async ({ page }) => {
    // Page operations read the document back out of the viewer, so a stamp
    // placed first has to survive being reordered around.
    await openSample(page);
    await page.getByTestId('toggle-pages').click();

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
    await page.waitForTimeout(3000);

    await page.getByTestId('toggle-pages').click();
    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-rotate-right').click();
    await expect(page.getByTestId('page-0-rotation')).toHaveText('90°', { timeout: 60_000 });
    await viewerSettles(page);

    const saved = await saveAndLoad(page);
    const annots = saved.getPage(0).node.Annots();
    expect(annots?.size() ?? 0).toBeGreaterThan(0);
  });
});