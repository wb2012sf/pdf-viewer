import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

/**
 * The viewer's own Open and Close, and their Ctrl+O / Ctrl+W shortcuts.
 *
 * Left alone they swap the document inside the viewer without this app hearing
 * about it: no unsaved-changes warning, and a toolbar still naming a file that
 * is no longer on screen. They are redefined to run this app's handlers.
 */

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

async function makeAChange(page: Page): Promise<void> {
  await page.getByTestId('toggle-pages').click();
  await page.getByTestId('page-0').check();
  await page.getByTestId('pages-rotate-right').click();
  await expect(page.getByTestId('page-0-rotation')).toHaveText('+90°', { timeout: 60_000 });
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

/** Clicks an item in the viewer's document menu by its visible text. */
async function documentMenuItem(page: Page, label: string): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    (root?.querySelector('[aria-label="Document Menu"]') as HTMLElement | undefined)?.click();
  });
  await expect
    .poll(
      () =>
        page.evaluate((text) => {
          const root = document.querySelector('embedpdf-container')?.shadowRoot;
          return Array.from(root?.querySelectorAll('button') ?? []).some((b) =>
            (b.textContent ?? '').trim().startsWith(text),
          );
        }, label),
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.evaluate((text) => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    Array.from(root?.querySelectorAll('button') ?? [])
      .find((b) => (b.textContent ?? '').trim().startsWith(text))
      ?.click();
  }, label);
}

test.describe("the viewer's own document commands", () => {
  test.slow();

  test('leaves the rest of the document menu intact', async ({ page }) => {
    // Supplying commands by id must override those two, not replace the set.
    await openSample(page);
    await page.evaluate(() => {
      const root = document.querySelector('embedpdf-container')?.shadowRoot;
      (root?.querySelector('[aria-label="Document Menu"]') as HTMLElement | undefined)?.click();
    });

    // The menu opens asynchronously, so this waits for it rather than reading
    // whatever happens to be there the instant after the click.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const root = document.querySelector('embedpdf-container')?.shadowRoot;
            return Array.from(root?.querySelectorAll('button') ?? []).map((b) => (b.textContent ?? '').trim());
          }),
        { timeout: 30_000 },
      )
      .toEqual(expect.arrayContaining(['Print', 'Export', 'Fullscreen']));
  });

  test('its Close warns about unsaved changes', async ({ page }) => {
    await openSample(page);
    await makeAChange(page);

    await documentMenuItem(page, 'Close');

    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 30_000 });
  });

  test('its Close closes the document when there is nothing to lose', async ({ page }) => {
    await openSample(page);

    await documentMenuItem(page, 'Close');

    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('open-filename')).toHaveText('No document open');
  });

  test('its Open warns about unsaved changes', async ({ page }) => {
    await openSample(page);
    await makeAChange(page);

    await documentMenuItem(page, 'Open');

    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('confirm-discard')).toHaveText('Discard and open');
  });

  test('Ctrl+W warns too, not just the menu item', async ({ page }) => {
    // The shortcut is bound by the viewer as well, and would otherwise be a
    // second way around the warning.
    await openSample(page);
    await makeAChange(page);

    await page.locator('embedpdf-container').click({ position: { x: 400, y: 300 } });
    await page.keyboard.press('Control+w');

    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: 30_000 });
  });
});
