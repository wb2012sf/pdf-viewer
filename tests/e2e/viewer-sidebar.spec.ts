import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));
const OUTLINE_PDF = fileURLToPath(new URL('./fixtures/outline.pdf', import.meta.url));

/**
 * The viewer's own left sidebar.
 *
 * Out of the box it has two tabs, Thumbnails and Outline, with Thumbnails open
 * by default. Thumbnails looks like this app's Pages panel but can only
 * navigate, and every report of pages that "cannot be dragged or rotated" has
 * turned out to be that tab. The sidebar is redefined to hold Outline alone.
 */

async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
}

/** Visible text of everything in the viewer's shadow root. */
async function viewerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    return Array.from(root?.querySelectorAll('*') ?? [])
      .filter((el) => el.children.length === 0 && el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT')
      .map((el) => (el.textContent ?? '').trim())
      .join('\n');
  });
}

async function openSidebar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    (root?.querySelector('[aria-label="Sidebar"]') as HTMLElement | undefined)?.click();
  });
}

/** Clicks the innermost element in the viewer whose text is exactly `text`. */
async function clickViewerText(page: Page, text: string): Promise<void> {
  const clicked = await page.evaluate((wanted) => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    const match = Array.from(root?.querySelectorAll<HTMLElement>('*') ?? []).find(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim() === wanted,
    );
    match?.click();
    return Boolean(match);
  }, text);
  expect(clicked, `expected "${text}" in the viewer`).toBe(true);
}

test.describe("the viewer's sidebar", () => {
  test.slow();

  test('opens on the outline, with no Thumbnails tab', async ({ page }) => {
    await openSample(page);
    await openSidebar(page);

    // sample.pdf has no bookmarks, so an open Outline says so.
    await expect.poll(() => viewerText(page), { timeout: 30_000 }).toContain('No outline available');
    // The tabs are icon-only, so their absence is checked by role, not text.
    const tabs = await page.evaluate(
      () => document.querySelector('embedpdf-container')?.shadowRoot?.querySelectorAll('[role="tab"]').length ?? -1,
    );
    expect(tabs).toBe(0);

    await page.screenshot({ path: 'test-results/viewer-sidebar-outline.png' });
  });

  test("lists a document's bookmarks and jumps to them", async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(OUTLINE_PDF);
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await openSidebar(page);

    // The top level is listed; the nested bookmark sits under Chapter 2.
    await expect.poll(() => viewerText(page), { timeout: 30_000 }).toContain('Chapter 1');
    expect(await viewerText(page)).toContain('Chapter 2');
    await page.screenshot({ path: 'test-results/viewer-sidebar-bookmarks.png' });

    // Following a bookmark moves the viewer, which the Pages panel follows.
    await page.getByTestId('toggle-pages').click();
    await expect(page.getByTestId('page-item-0')).toHaveAttribute('data-current', 'true', { timeout: 30_000 });
    await clickViewerText(page, 'Chapter 2');
    await expect(page.getByTestId('page-item-1')).toHaveAttribute('data-current', 'true', { timeout: 30_000 });
  });

  // The viewer only offers a per-bookmark arrow; these two are this app's.
  // See `src/lib/viewer/outline-controls.ts`.

  test('collapses and expands every level of the outline at once', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(OUTLINE_PDF);
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await openSidebar(page);
    await expect.poll(() => viewerText(page), { timeout: 30_000 }).toContain('Chapter 2');

    // Collapsed children are not rendered at all, so their text disappears.
    await page.getByTestId('outline-collapse-all').click();
    await expect.poll(() => viewerText(page), { timeout: 10_000 }).not.toContain('Section 2.1');
    expect(await viewerText(page)).toContain('Chapter 1');

    await page.getByTestId('outline-expand-all').click();
    await expect.poll(() => viewerText(page), { timeout: 10_000 }).toContain('Detail 2.1.1');
    expect(await viewerText(page)).toContain('Section 2.1');
    await page.screenshot({ path: 'test-results/viewer-sidebar-expand-all.png' });

    // Collapsing from fully expanded hides the deepest level too.
    await page.getByTestId('outline-collapse-all').click();
    await expect.poll(() => viewerText(page), { timeout: 10_000 }).not.toContain('Detail 2.1.1');
    await page.screenshot({ path: 'test-results/viewer-sidebar-collapse-all.png' });
  });

  test('offers no expand or collapse when there is no outline', async ({ page }) => {
    await openSample(page);
    await openSidebar(page);
    await expect.poll(() => viewerText(page), { timeout: 30_000 }).toContain('No outline available');

    await expect(page.getByTestId('outline-expand-all')).toHaveCount(0);
    await expect(page.getByTestId('outline-collapse-all')).toHaveCount(0);
  });
});
