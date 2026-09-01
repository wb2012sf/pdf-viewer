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

/** Waits for the previews to catch up with the document. */
async function thumbnailsSettle(page: Page): Promise<void> {
  await expect(page.getByTestId('pages-list')).toHaveAttribute('data-stale', 'false', { timeout: 90_000 });
}

/**
 * Drags the page at `from` onto the page at `to` with a real mouse.
 *
 * Deliberately not `locator.dragTo`: that dispatches HTML5 drag events straight
 * at the page, so it passed while a person moving the mouse could not reorder
 * anything at all. Press, move in steps, release — the same events a hand makes.
 */
async function dragPage(page: Page, from: number, to: number): Promise<void> {
  // Grab the preview image, which is what a person actually takes hold of.
  const source = (await page.getByTestId(`page-item-${String(from)}`).locator('img').boundingBox())!;
  const target = (await page.getByTestId(`page-item-${String(to)}`).boundingBox())!;

  const startX = source.x + source.width / 2;
  const startY = source.y + source.height / 2;
  const endX = target.x + target.width / 2;
  const endY = target.y + target.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(startX + ((endX - startX) * step) / 6, startY + ((endY - startY) * step) / 6);
  }
  await page.mouse.up();
}

test.describe('page operations', () => {
  test.slow();

  test('lists the pages of the open document', async ({ page }) => {
    await openSample(page);

    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2);

    // A preview per page: a page is identifiable by what is on it, not by a
    // number. The screenshot is reviewed for the panel's layout as a whole.
    await thumbnailsSettle(page);
    await expect(page.getByTestId('pages-list').locator('img')).toHaveCount(2);

    await page.getByTestId('page-0').check();
    await page.screenshot({ path: 'test-results/screenshots/page-panel.png', fullPage: true });
  });

  test('keeps the previews on screen across an edit', async ({ page }) => {
    // The panel used to empty itself on every operation, losing its scroll
    // position at the moment the user most wanted to see the result.
    await openSample(page);
    await thumbnailsSettle(page);

    // Watch the list continuously rather than sampling it afterwards: polling
    // for "not empty" is satisfied the moment the *new* previews land, and says
    // nothing about whether the panel blanked in between. It did.
    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="pages-list"]')!;
      const seen = { emptied: false };
      (window as unknown as { previewWatch: typeof seen }).previewWatch = seen;
      new MutationObserver(() => {
        if (list.querySelectorAll('img').length === 0) seen.emptied = true;
      }).observe(list, { childList: true, subtree: true });
    });

    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-rotate-right').click();

    await expect(page.getByTestId('page-0-rotation')).toHaveText('+90°', { timeout: 60_000 });
    await thumbnailsSettle(page);

    await expect(page.getByTestId('pages-list').locator('img')).toHaveCount(2);
    expect(
      await page.evaluate(() => (window as unknown as { previewWatch: { emptied: boolean } }).previewWatch.emptied),
    ).toBe(false);
  });

  test('rotates a page, and the rotation survives saving', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-rotate-right').click();

    // The panel re-reads rotations from the rewritten bytes, so this appearing
    // means the operation actually landed rather than just being requested.
    await expect(page.getByTestId('page-0-rotation')).toHaveText('+90°', { timeout: 60_000 });
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
    await dragPage(page, 0, 1);
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

  test('splits into separate documents at the ticked pages', async ({ page }) => {
    await openSample(page);
    // Ticking page 2 means "start a new document here", giving two parts.
    await page.getByTestId('page-1').check();

    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));

    await page.getByTestId('pages-split').click();

    await expect.poll(() => downloads, { timeout: 60_000 }).toEqual(['sample-part-1.pdf', 'sample-part-2.pdf']);
    // Like extract, split leaves the open document alone.
    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2);
  });

  test('will not split before the first page alone, which would change nothing', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('page-0').check();

    await expect(page.getByTestId('pages-split')).toBeDisabled();
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
    await expect(page.getByTestId('page-0-rotation')).toHaveText('+90°', { timeout: 60_000 });
    await viewerSettles(page);

    const saved = await saveAndLoad(page);
    const annots = saved.getPage(0).node.Annots();
    expect(annots?.size() ?? 0).toBeGreaterThan(0);
  });
});
test('shows a preview for every page of a long document', async ({ page }) => {
  // 200 pages render in about a second, so previews are built eagerly rather
  // than lazily. This guards that: if it ever stops scaling, the fix is
  // windowing the list, and this test is what should fail first.
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(
    fileURLToPath(new URL('./fixtures/large.pdf', import.meta.url)),
  );
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('toggle-pages').click();

  await expect(page.getByTestId('pages-list')).toHaveAttribute('data-stale', 'false', { timeout: 120_000 });
  await expect(page.getByTestId('pages-list').locator('img')).toHaveCount(200);
});

test.describe('bulk page selection', () => {
  test.slow();

  const FIVE_PAGES = fileURLToPath(new URL('./fixtures/five.pdf', import.meta.url));

  async function openFive(page: Page): Promise<void> {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(FIVE_PAGES);
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('toggle-pages').click();
    await expect(page.getByTestId('pages-list')).toHaveAttribute('data-stale', 'false', { timeout: 90_000 });
  }

  test('shift-click selects the run between two pages', async ({ page }) => {
    await openFive(page);

    await page.getByTestId('page-1').click();
    await page.getByTestId('page-3').click({ modifiers: ['Shift'] });

    // 2, 3 and 4 — the run, not just the two clicked.
    await expect(page.getByTestId('page-panel')).toContainText('3 of 5 selected');
  });

  test('rotates a selected run in one go', async ({ page }) => {
    await openFive(page);
    await page.getByTestId('page-1').click();
    await page.getByTestId('page-3').click({ modifiers: ['Shift'] });

    await page.getByTestId('pages-rotate-right').click();

    for (const index of [1, 2, 3]) {
      await expect(page.getByTestId(`page-${String(index)}-rotation`)).toHaveText('+90°', { timeout: 60_000 });
    }
    await expect(page.getByTestId('page-0-rotation')).toHaveCount(0);
    await expect(page.getByTestId('page-4-rotation')).toHaveCount(0);
  });

  test('deletes a selected run in one go', async ({ page }) => {
    await openFive(page);
    await page.getByTestId('page-0').click();
    await page.getByTestId('page-2').click({ modifiers: ['Shift'] });

    await page.getByTestId('pages-delete').click();

    await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2, { timeout: 60_000 });
  });

  test("a page's own buttons act on that page alone", async ({ page }) => {
    // Even with a different selection active.
    await openFive(page);
    await page.getByTestId('page-0').click();
    await page.getByTestId('page-1').click({ modifiers: ['Shift'] });

    await page.getByTestId('page-4-rotate-right').click();

    await expect(page.getByTestId('page-4-rotation')).toHaveText('+90°', { timeout: 60_000 });
    await expect(page.getByTestId('page-0-rotation')).toHaveCount(0);
    await expect(page.getByTestId('page-1-rotation')).toHaveCount(0);
  });

  test('drags a selected run as one block, and the file agrees', async ({ page }) => {
    await openFive(page);
    await page.getByTestId('page-0').click();
    await page.getByTestId('page-1').click({ modifiers: ['Shift'] });

    await dragPage(page, 0, 4);
    await expect(page.getByTestId('pages-list')).toHaveAttribute('data-stale', 'false', { timeout: 90_000 });
    await viewerSettles(page);

    // Pages 1 and 2 moved to the end: the saved order is 3,4,5,1,2. Page sizes
    // identify them — the fixture makes page i (100 + i) wide.
    const saved = await saveAndLoad(page);
    const widths = saved.getPages().map((p) => Math.round(p.getWidth()) - 100);
    expect(widths).toEqual([2, 3, 4, 0, 1]);
  });
});
