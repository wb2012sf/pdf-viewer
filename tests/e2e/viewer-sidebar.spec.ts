import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

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

test.describe("the viewer's sidebar", () => {
  test.slow();

  test('opens on the outline, with no Thumbnails tab', async ({ page }) => {
    await openSample(page);
    await page.evaluate(() => {
      const root = document.querySelector('embedpdf-container')?.shadowRoot;
      (root?.querySelector('[aria-label="Sidebar"]') as HTMLElement | undefined)?.click();
    });

    // sample.pdf has no bookmarks, so an open Outline says so.
    await expect.poll(() => viewerText(page), { timeout: 30_000 }).toContain('No outline available');
    // The tabs are icon-only, so their absence is checked by role, not text.
    const tabs = await page.evaluate(
      () => document.querySelector('embedpdf-container')?.shadowRoot?.querySelectorAll('[role="tab"]').length ?? -1,
    );
    expect(tabs).toBe(0);

    await page.screenshot({ path: 'test-results/viewer-sidebar-outline.png' });
  });
});
