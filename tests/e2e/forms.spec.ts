import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const FORM_PDF = fileURLToPath(new URL('./fixtures/form.pdf', import.meta.url));

/** The fixture's page size, which the click maths below is relative to. */
const PAGE_WIDTH = 420;
const PAGE_HEIGHT = 595;

async function openForm(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(FORM_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
  // Widgets are laid over the page once it has rendered.
  await expect(page.locator('embedpdf-container input[name="applicant.name"]')).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Clicks a point given in PDF coordinates (origin bottom-left, points).
 *
 * The checkbox widget is not exposed by field name anywhere in the DOM, so it
 * is reached the way a person reaches it — by clicking where it is drawn.
 */
async function clickOnPage(page: Page, x: number, y: number): Promise<void> {
  const rect = await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    const rendered = Array.from(root?.querySelectorAll('img') ?? [])
      .map((img) => img.getBoundingClientRect())
      .filter((box) => box.width > 200)
      .sort((a, b) => b.width - a.width)[0];
    return rendered ? { x: rendered.x, y: rendered.y, w: rendered.width, h: rendered.height } : null;
  });
  expect(rect, 'expected a rendered page').not.toBeNull();

  await page.mouse.click(
    rect!.x + (x / PAGE_WIDTH) * rect!.w,
    rect!.y + (1 - y / PAGE_HEIGHT) * rect!.h,
  );
}

async function saveAndLoad(page: Page): Promise<PDFDocument> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('save').click(),
  ]);
  return PDFDocument.load(new Uint8Array(await readFile(await download.path())), { ignoreEncryption: true });
}

test.describe('form filling', () => {
  test.slow();

  test('renders a widget for each field in the document', async ({ page }) => {
    await openForm(page);

    await expect(page.locator('embedpdf-container input[name="applicant.name"]')).toBeVisible();
    await expect(page.locator('embedpdf-container input[name="applicant.reference"]')).toBeVisible();
  });

  test('writes a typed value into the saved document', async ({ page }) => {
    // The point of the whole feature: what is typed has to end up in the file,
    // not just on screen.
    await openForm(page);

    await page.locator('embedpdf-container input[name="applicant.name"]').fill('Ada Lovelace');
    await page.keyboard.press('Tab');

    const saved = await saveAndLoad(page);
    expect(saved.getForm().getTextField('applicant.name').getText()).toBe('Ada Lovelace');
  });

  test('keeps each field separate', async ({ page }) => {
    await openForm(page);

    await page.locator('embedpdf-container input[name="applicant.name"]').fill('Ada Lovelace');
    await page.keyboard.press('Tab');
    await page.locator('embedpdf-container input[name="applicant.reference"]').fill('REF-2026-118');
    await page.keyboard.press('Tab');

    const form = (await saveAndLoad(page)).getForm();
    expect(form.getTextField('applicant.name').getText()).toBe('Ada Lovelace');
    expect(form.getTextField('applicant.reference').getText()).toBe('REF-2026-118');
  });

  test('ticks a checkbox', async ({ page }) => {
    await openForm(page);
    expect((await saveAndLoad(page)).getForm().getCheckBox('applicant.agreed').isChecked()).toBe(false);

    // The fixture puts the box at 48,268 with a 26pt side.
    await clickOnPage(page, 48 + 13, 268 + 13);
    await page.waitForTimeout(1000);

    expect((await saveAndLoad(page)).getForm().getCheckBox('applicant.agreed').isChecked()).toBe(true);
  });

  test('keeps filled values through a page operation', async ({ page }) => {
    // Page operations re-read the document from the viewer, so a value typed
    // beforehand must survive being rotated around.
    await openForm(page);
    await page.locator('embedpdf-container input[name="applicant.name"]').fill('Ada Lovelace');
    await page.keyboard.press('Tab');

    await page.getByTestId('toggle-pages').click();
    await page.getByTestId('page-0').check();
    await page.getByTestId('pages-rotate-right').click();
    await expect(page.getByTestId('page-0-rotation')).toHaveText('+90°', { timeout: 60_000 });
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

    const saved = await saveAndLoad(page);
    expect(saved.getForm().getTextField('applicant.name').getText()).toBe('Ada Lovelace');
    expect(saved.getPage(0).getRotation().angle).toBe(90);
  });
});
