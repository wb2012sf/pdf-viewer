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

  test('a widget is styled by the font the document authored it with', async ({ page }) => {
    // A field drawn in an oblique face renders in italics, and one drawn in the
    // upright face does not. That is the viewer honouring the PDF, not a bug —
    // worth pinning down, because a "why is this field in italics?" report
    // looks like a rendering fault and is not one.
    //
    // It also guards the widget patching below: reaching into these elements
    // must not start overriding the document's own typography.
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(
      fileURLToPath(new URL('./fixtures/form-italic.pdf', import.meta.url)),
    );
    await expect(page.locator('embedpdf-container img').first()).toBeVisible({ timeout: 90_000 });
    await expect(widget(page, 'field.upright')).toBeAttached({ timeout: 60_000 });

    const styleOf = (name: string) =>
      widget(page, name).evaluate((el) => window.getComputedStyle(el).fontStyle);

    expect(await styleOf('field.upright')).toBe('normal');
    expect(await styleOf('field.oblique')).toBe('italic');
  });

  // The two below are viewer defects that this app patches from outside; see
  // `src/lib/viewer/form-field-fixes.ts`.

  test('a max-length field limits what can be typed', async ({ page }) => {
    await openFormTypes(page);

    await expect(widget(page, 'field.maxlength')).toHaveAttribute('maxlength', '4', { timeout: 30_000 });
  });

  test('a max-length field refuses a longer value', async ({ page }) => {
    // The attribute is only worth having if it actually stops the typing.
    await openFormTypes(page);
    await expect(widget(page, 'field.maxlength')).toHaveAttribute('maxlength', '4', { timeout: 30_000 });

    await widget(page, 'field.maxlength').fill('123456789');

    await expect(widget(page, 'field.maxlength')).toHaveValue('1234');
  });

  test('an auto-sized multiline field is readable and can wrap', async ({ page }) => {
    // Left alone the viewer fits the font to the field *height* — right for a
    // single line, wrong for a box meant to wrap, which then shows one
    // enormous line.
    await openFormTypes(page);

    await expect
      .poll(
        () =>
          widget(page, 'field.multilineAuto').evaluate((el) => {
            const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
            return fontSize / el.getBoundingClientRect().height;
          }),
        { timeout: 30_000 },
      )
      .toBeLessThan(1 / 3);
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
