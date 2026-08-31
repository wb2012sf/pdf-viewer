import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Boxes of the drawing canvases in the Create Signature dialog. */
async function canvasBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    return Array.from(root?.querySelectorAll('canvas') ?? []).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
  });
}

/** Clicks a button in the viewer's shadow root by its visible text. */
async function clickByText(page: Page, text: string): Promise<void> {
  const clicked = await page.evaluate((label) => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    const button = Array.from(root?.querySelectorAll('button') ?? []).find((element) =>
      (element.textContent ?? '').trim().includes(label),
    );
    button?.click();
    return button !== undefined;
  }, text);
  expect(clicked, `expected a "${text}" button in the viewer`).toBe(true);
}

/** Scribbles a stroke across a canvas, the way a person signs with a mouse. */
async function scribble(page: Page, box: Box): Promise<void> {
  const midY = box.y + box.h / 2;
  await page.mouse.move(box.x + box.w * 0.15, midY);
  await page.mouse.down();
  for (const [fx, fy] of [
    [0.3, -0.25],
    [0.45, 0.2],
    [0.6, -0.2],
    [0.8, 0.1],
  ] as const) {
    await page.mouse.move(box.x + box.w * fx, midY + box.h * fy);
  }
  await page.mouse.up();
}

async function openSignatureDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

  await page.getByText('Insert', { exact: true }).click();
  await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    (root?.querySelector('[aria-label="Signatures"]') as HTMLElement | undefined)?.click();
  });
  await clickByText(page, 'Create Signature');

  await expect.poll(() => canvasBoxes(page).then((boxes) => boxes.length), { timeout: 30_000 }).toBeGreaterThan(0);
}

/** Annotation subtypes (`/Stamp`, `/Widget`, …) on a page of a saved document. */
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

test.describe('signatures', () => {
  test.slow();

  test('offers a way to draw one', async ({ page }) => {
    await openSignatureDialog(page);

    // Signature and initials get a canvas each.
    expect((await canvasBoxes(page)).length).toBeGreaterThanOrEqual(1);
  });

  test('places a drawn signature on the page and keeps it in the saved file', async ({ page }) => {
    await openSignatureDialog(page);

    for (const box of await canvasBoxes(page)) {
      await scribble(page, box);
    }
    await clickByText(page, 'Save');
    await page.waitForTimeout(2000);

    // The saved signature appears in the panel; picking it arms the tool.
    const thumb = await page.evaluate(() => {
      const root = document.querySelector('embedpdf-container')?.shadowRoot;
      const small = Array.from(root?.querySelectorAll('img') ?? []).filter((img) => {
        const width = img.getBoundingClientRect().width;
        return width > 10 && width < 200;
      })[0];
      if (!small) return null;
      const rect = small.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    expect(thumb, 'expected the new signature to appear in the panel').not.toBeNull();

    await page.mouse.click(thumb!.x, thumb!.y);
    await page.waitForTimeout(1500);

    const target = await page.evaluate(() => {
      const root = document.querySelector('embedpdf-container')?.shadowRoot;
      const rect = Array.from(root?.querySelectorAll('img') ?? [])
        .map((img) => img.getBoundingClientRect())
        .filter((box) => box.width > 200)
        .sort((a, b) => b.width - a.width)[0];
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    });
    await page.mouse.click(target!.x, target!.y);
    await page.waitForTimeout(2500);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('save').click(),
    ]);
    const saved = new Uint8Array(await readFile(await download.path()));

    // A drawn signature is written as an Ink annotation — the strokes
    // themselves — rather than the Stamp a rubber stamp produces.
    expect(await annotationSubtypes(saved, 0)).toContain('/Ink');

    await page.screenshot({ path: 'test-results/screenshots/signature-placed.png', fullPage: true });
  });
});
