import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

/**
 * The viewer renders into a shadow root and labels its controls with
 * `aria-label`, so these helpers locate elements by that and click real screen
 * coordinates. Playwright's own actionability checks cannot see into the
 * component's internals well enough to drive it.
 */
async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.evaluate((sel) => {
    const element = document.querySelector('embedpdf-container')?.shadowRoot?.querySelector(sel);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);

  expect(box, `expected to find ${selector} in the viewer`).not.toBeNull();
  return box!;
}

/** Centre of the nth stamp thumbnail in the gallery panel. */
async function stampThumbnail(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.evaluate((n) => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    // Thumbnails are the small images; the rendered page is the large one.
    const thumbs = Array.from(root?.querySelectorAll('img') ?? []).filter((img) => {
      const width = img.getBoundingClientRect().width;
      return width > 10 && width < 120;
    });
    const element = thumbs[n];
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, index);

  expect(box, 'expected the stamp gallery to have thumbnails').not.toBeNull();
  return box!;
}

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

async function placeFirstStamp(page: Page): Promise<void> {
  await page.getByText('Insert', { exact: true }).click();

  const tool = await centreOf(page, '[aria-label="Rubber Stamp"]');
  await page.mouse.click(tool.x, tool.y);

  // The gallery panel has to open and render its artwork before a stamp can be
  // picked; the thumbnails appearing is that signal.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Array.from(document.querySelector('embedpdf-container')?.shadowRoot?.querySelectorAll('img') ?? [])
              .filter((img) => {
                const width = img.getBoundingClientRect().width;
                return width > 10 && width < 120;
              }).length,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  const thumb = await stampThumbnail(page, 0);
  await page.mouse.click(thumb.x, thumb.y);

  // Choosing a stamp arms the tool: it renders the artwork to a bitmap and
  // attaches a drag preview before a click on the page will place anything.
  // There is no DOM signal for that being finished, so this waits it out.
  await page.waitForTimeout(1500);

  const pageBox = await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    const rendered = Array.from(root?.querySelectorAll('img') ?? [])
      .map((img) => img.getBoundingClientRect())
      .filter((rect) => rect.width > 200)
      .sort((a, b) => b.width - a.width)[0];
    if (!rendered) return null;
    return { x: rendered.x + rendered.width / 2, y: rendered.y + rendered.height / 3 };
  });
  expect(pageBox, 'expected a rendered page to stamp onto').not.toBeNull();

  await page.mouse.click(pageBox!.x, pageBox!.y);
}

/** Annotation subtypes (`/Stamp`, `/Highlight`, …) on a page of a saved document. */
async function annotationSubtypes(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const annots = doc.getPage(pageIndex).node.Annots();
  if (!annots) return [];

  const subtypes: string[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const subtype = annots.lookup(index, PDFDict).get(PDFName.of('Subtype'));
    subtypes.push(subtype ? subtype.toString() : '');
  }
  return subtypes;
}

test.describe('rubber stamps', () => {
  test.slow();

  test('places a stamp from the bundled gallery onto the page', async ({ page }) => {
    await openSample(page);
    await placeFirstStamp(page);

    // A freshly placed annotation comes up selected, so its action bar is the
    // signal that something actually landed on the page.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document
                .querySelector('embedpdf-container')
                ?.shadowRoot?.querySelector('[aria-label="Delete selected annotation"]') !== null &&
              document
                .querySelector('embedpdf-container')
                ?.shadowRoot?.querySelector('[aria-label="Delete selected annotation"]') !== undefined,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.screenshot({ path: 'test-results/screenshots/stamp-placed.png', fullPage: true });
  });

  test('keeps the stamp when the document is saved', async ({ page }) => {
    // The bytes the file was opened with do not contain anything drawn since;
    // saving those would throw the stamp away without saying so.
    await openSample(page);

    const before = await annotationSubtypes(new Uint8Array(await readFile(SAMPLE_PDF)), 0);
    expect(before).toEqual([]);

    await placeFirstStamp(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('save').click(),
    ]);
    const saved = new Uint8Array(await readFile(await download.path()));

    expect(await annotationSubtypes(saved, 0)).toContain('/Stamp');
  });

  test('saves the file under the name it was opened with', async ({ page }) => {
    await openSample(page);
    await placeFirstStamp(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('save').click(),
    ]);

    expect(download.suggestedFilename()).toBe('sample.pdf');
  });
});
