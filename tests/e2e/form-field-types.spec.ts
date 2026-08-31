import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const FORM_TYPES_PDF = fileURLToPath(new URL('./fixtures/form-types.pdf', import.meta.url));

/**
 * How the viewer handles the less common form field types.
 *
 * Everything here is EmbedPDF's rendering, not this app's — the app draws no
 * form UI of its own. The tests marked `test.fail()` describe what *should*
 * happen and are expected to fail today; if one starts passing, the viewer has
 * fixed it and the marker should come off.
 *
 * Regenerate the fixture with `node tests/e2e/fixtures/make-fixture-pdf.mjs`.
 */

async function openFormTypes(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(FORM_TYPES_PDF);
  await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('embedpdf-container [name="field.dropdown"]')).toBeAttached({ timeout: 60_000 });
}

function widget(page: Page, name: string) {
  return page.locator(`embedpdf-container [name="${name}"]`);
}

test.describe('form field types', () => {
  test.slow();

  test('text and dropdown fields get an interactive widget', async ({ page }) => {
    await openFormTypes(page);

    // These work: a real <select> and real <input>/<textarea> elements, named
    // after the PDF fields.
    await expect(widget(page, 'field.dropdown')).toBeAttached();
    await expect(widget(page, 'field.maxlength')).toBeAttached();
    await expect(widget(page, 'field.multiline')).toBeAttached();
  });

  test('a multiline field with an explicit font size fits several lines', async ({ page }) => {
    await openFormTypes(page);

    const { fontSize, height } = await widget(page, 'field.multiline').evaluate((el) => ({
      fontSize: parseFloat(window.getComputedStyle(el).fontSize),
      height: el.getBoundingClientRect().height,
    }));

    expect(fontSize).toBeLessThan(height / 3);
  });

  test('the interactive layer sits invisibly over the rendered page', async ({ page }) => {
    await openFormTypes(page);

    // Not a defect, but the thing to know before chasing any "the widget looks
    // wrong" report: what you see is PDFium drawing the field's appearance
    // stream into the page bitmap. The HTML control on top is transparent and
    // only handles input, so a widget's *appearance* comes from the PDF, not
    // from CSS in the viewer.
    const opacity = await widget(page, 'field.dropdown').evaluate(
      (el) => window.getComputedStyle(el).opacity,
    );

    expect(opacity).toBe('0');
  });

  test.fail(
    'KNOWN ISSUE: a max-length field does not limit what can be typed',
    async ({ page }) => {
      // The PDF says MaxLen 4, but the widget carries no maxlength attribute,
      // so nothing stops a longer value being entered and saved.
      await openFormTypes(page);

      await expect(widget(page, 'field.maxlength')).toHaveAttribute('maxlength', '4', { timeout: 5000 });
    },
  );

  test.fail('KNOWN ISSUE: an auto-sized multiline field uses a one-line font', async ({ page }) => {
    // With no explicit size the viewer fits the font to the field *height* —
    // right for a single-line field, wrong for a multiline one, which then
    // shows one enormous line instead of wrapping.
    await openFormTypes(page);

    const { fontSize, height } = await widget(page, 'field.multilineAuto').evaluate((el) => ({
      fontSize: parseFloat(window.getComputedStyle(el).fontSize),
      height: el.getBoundingClientRect().height,
    }));

    expect(fontSize).toBeLessThan(height / 3);
  });

  test.fail('KNOWN ISSUE: a file-select field offers no file picker', async ({ page }) => {
    // The field carries the FileSelect flag; the viewer renders a plain text
    // box, so there is no way to choose a file.
    await openFormTypes(page);

    await expect(widget(page, 'field.attachment')).toHaveAttribute('type', 'file', { timeout: 5000 });
  });

  test.fail('KNOWN ISSUE: a push button is not rendered at all', async ({ page }) => {
    // A Submit button in the PDF produces no widget, so it cannot be pressed.
    await openFormTypes(page);

    await expect(widget(page, 'field.submit')).toBeAttached({ timeout: 5000 });
  });
});
