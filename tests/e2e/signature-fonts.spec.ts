import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));

/** Opens Insert → Signatures → Create Signature and returns the dialog's buttons. */
async function openSignatureDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });

  await page.getByText('Insert', { exact: true }).click();
  await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    (root?.querySelector('[aria-label="Signatures"]') as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    Array.from(root?.querySelectorAll('button') ?? [])
      .find((button) => (button.textContent ?? '').includes('Create Signature'))
      ?.click();
  });
}

function dialogButtonLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('embedpdf-container')?.shadowRoot;
    return Array.from(root?.querySelectorAll('button') ?? [])
      .map((button) => (button.textContent ?? '').trim())
      .filter((label) => label.length > 0);
  });
}

test.describe('typed signatures', () => {
  test.slow();

  test('offers the Type tab, which needs cursive fonts to exist at all', async ({ page }) => {
    // With no signature stylesheet the viewer drops this tab rather than
    // falling back to a system cursive — so its presence is what proves the
    // bundled fonts were accepted.
    await openSignatureDialog(page);

    await expect.poll(() => dialogButtonLabels(page), { timeout: 30_000 }).toContain('Type');
  });

  test('still offers drawing and uploading alongside it', async ({ page }) => {
    await openSignatureDialog(page);

    const labels = await dialogButtonLabels(page);
    expect(labels).toContain('Draw');
    expect(labels).toContain('Upload');
  });

  test('loads the cursive faces from the bundle, not from Google Fonts', async ({ page, context }) => {
    const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:4173').origin;
    const offOrigin: string[] = [];
    context.on('request', (request) => {
      const url = request.url();
      if ((url.startsWith('http://') || url.startsWith('https://')) && !url.startsWith(origin)) {
        offOrigin.push(url);
      }
    });
    const served: string[] = [];
    page.on('response', (response) => served.push(response.url()));

    await openSignatureDialog(page);
    await expect.poll(() => dialogButtonLabels(page), { timeout: 30_000 }).toContain('Type');

    // Selecting Type is what pulls the faces in.
    await page.evaluate(() => {
      const root = document.querySelector('embedpdf-container')?.shadowRoot;
      Array.from(root?.querySelectorAll('button') ?? [])
        .find((button) => (button.textContent ?? '').trim() === 'Type')
        ?.click();
    });

    await expect.poll(() => served.filter((url) => url.includes('/fonts/')), { timeout: 30_000 }).not.toEqual(
      [],
    );
    expect(offOrigin).toEqual([]);
  });

  test('renders a typed signature in a cursive face', async ({ page }) => {
    await openSignatureDialog(page);
    await expect.poll(() => dialogButtonLabels(page), { timeout: 30_000 }).toContain('Type');

    await page.evaluate(() => {
      const root = document.querySelector('embedpdf-container')?.shadowRoot;
      Array.from(root?.querySelectorAll('button') ?? [])
        .find((button) => (button.textContent ?? '').trim() === 'Type')
        ?.click();
    });

    const typed = page.locator('embedpdf-container input[type="text"]').first();
    await typed.fill('Ada Lovelace');

    // The preview has to actually use one of the bundled families; falling back
    // to a system font would mean the stylesheet never loaded.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const root = document.querySelector('embedpdf-container')?.shadowRoot;
            return Array.from(root?.querySelectorAll('*') ?? [])
              .map((element) => window.getComputedStyle(element).fontFamily)
              .join(' | ');
          }),
        { timeout: 30_000 },
      )
      .toMatch(/Caveat|Dancing Script|Great Vibes|Pacifico/);

    await page.screenshot({ path: 'test-results/screenshots/typed-signature.png', fullPage: true });
  });
});
