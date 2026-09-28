// Regenerates the documents the end-to-end tests open.
// Run with: node tests/e2e/fixtures/make-fixture-pdf.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from 'pdf-lib';

async function write(name, bytes) {
  const out = fileURLToPath(new URL(`./${name}`, import.meta.url));
  await writeFile(out, bytes);
  console.log(`wrote ${out}`);
}

// A plain two-page document, for the viewer tests.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const [index, heading] of ['First page', 'Second page'].entries()) {
    const page = doc.addPage([420, 595]);
    page.drawText(heading, { x: 48, y: 500, size: 28, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(`Sample fixture, page ${index + 1} of 2.`, { x: 48, y: 460, size: 12, font });
  }
  await write('sample.pdf', await doc.save());
}

// A document with bookmarks, for the viewer's Outline sidebar. pdf-lib has no
// outline API, so the /Outlines tree is built from low-level objects:
//
//   Chapter 1        -> page 1
//   Chapter 2        -> page 2
//     Section 2.1    -> page 3
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = ['Chapter 1', 'Chapter 2', 'Section 2.1'].map((heading) => {
    const page = doc.addPage([420, 595]);
    page.drawText(heading, { x: 48, y: 500, size: 28, font, color: rgb(0.1, 0.1, 0.1) });
    return page;
  });

  const { context } = doc;
  const outlinesRef = context.nextRef();
  const [chapter1, chapter2, section21] = [context.nextRef(), context.nextRef(), context.nextRef()];
  const item = (title, pageIndex, parent, extra) =>
    context.obj({
      Title: PDFHexString.fromText(title),
      Parent: parent,
      Dest: [pages[pageIndex].ref, PDFName.of('Fit')],
      ...extra,
    });

  context.assign(chapter1, item('Chapter 1', 0, outlinesRef, { Next: chapter2 }));
  context.assign(
    chapter2,
    item('Chapter 2', 1, outlinesRef, { Prev: chapter1, First: section21, Last: section21, Count: 1 }),
  );
  context.assign(section21, item('Section 2.1', 2, chapter2, {}));
  context.assign(outlinesRef, context.obj({ Type: 'Outlines', First: chapter1, Last: chapter2, Count: 3 }));
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  await write('outline.pdf', await doc.save());
}

// A document with real AcroForm fields, for exercising the viewer's Form tab.
// The fields are large and plainly labelled so a test can click them by
// position without depending on the viewer's internal markup.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 595]);
  const form = doc.getForm();

  page.drawText('Full name', { x: 48, y: 520, size: 14, font });
  const name = form.createTextField('applicant.name');
  name.addToPage(page, { x: 48, y: 470, width: 320, height: 34, font });

  page.drawText('Reference', { x: 48, y: 420, size: 14, font });
  const reference = form.createTextField('applicant.reference');
  reference.addToPage(page, { x: 48, y: 370, width: 320, height: 34, font });

  page.drawText('Agreed', { x: 48, y: 310, size: 14, font });
  const agreed = form.createCheckBox('applicant.agreed');
  agreed.addToPage(page, { x: 48, y: 268, width: 26, height: 26 });

  await write('form.pdf', await doc.save());
}

// The field types reported as misbehaving in the viewer, one of each, laid out
// with generous spacing so a test can click any of them by position.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 700]);
  const form = doc.getForm();

  page.drawText('Country (dropdown)', { x: 40, y: 650, size: 11, font });
  const country = form.createDropdown('field.dropdown');
  country.addOptions(['Switzerland', 'Germany', 'France']);
  country.select('Switzerland');
  country.addToPage(page, { x: 40, y: 610, width: 240, height: 30, font });

  page.drawText('PIN (max length 4)', { x: 40, y: 560, size: 11, font });
  const pin = form.createTextField('field.maxlength');
  pin.setMaxLength(4);
  pin.addToPage(page, { x: 40, y: 520, width: 120, height: 30, font });

  page.drawText('Notes (multiline, 10pt)', { x: 40, y: 470, size: 11, font });
  const notes = form.createTextField('field.multiline');
  notes.enableMultiline();
  notes.addToPage(page, { x: 40, y: 380, width: 300, height: 80, font });
  // Only after addToPage: the default-appearance entry it writes is what
  // setFontSize edits.
  notes.setFontSize(10);

  // The same field with no explicit size, so its appearance says "auto".
  // Auto-sizing is where a multiline box is most likely to be mishandled.
  page.drawText('Notes (multiline, auto size)', { x: 40, y: 350, size: 11, font });
  const notesAuto = form.createTextField('field.multilineAuto');
  notesAuto.enableMultiline();
  notesAuto.addToPage(page, { x: 40, y: 260, width: 300, height: 80, font });

  page.drawText('Attachment (file select)', { x: 40, y: 230, size: 11, font });
  const attachment = form.createTextField('field.attachment');
  attachment.enableFileSelection();
  attachment.addToPage(page, { x: 40, y: 190, width: 300, height: 30, font });

  page.drawText('Submit (push button)', { x: 40, y: 155, size: 11, font });
  const submit = form.createButton('field.submit');
  submit.addToPage('Submit', page, { x: 40, y: 110, width: 120, height: 32, font });

  await write('form-types.pdf', await doc.save());
}

// Two fields differing only in the font they were authored with, for checking
// that a widget's font style follows the document rather than the viewer.
{
  const doc = await PDFDocument.create();
  const upright = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const page = doc.addPage([420, 300]);
  const form = doc.getForm();

  page.drawText('Authored with Helvetica', { x: 40, y: 250, size: 10, font: upright });
  form.createTextField('field.upright').addToPage(page, { x: 40, y: 210, width: 300, height: 30, font: upright });

  page.drawText('Authored with Helvetica-Oblique', { x: 40, y: 170, size: 10, font: upright });
  form.createTextField('field.oblique').addToPage(page, { x: 40, y: 130, width: 300, height: 30, font: oblique });

  await write('form-italic.pdf', await doc.save());
}

// A stand-in for a scan. OCR reads the *rendered* page, so what matters is that
// the ink is large and high-contrast enough to survive recognition -- this only
// has to be a page Tesseract can read, not a genuine raster scan.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([420, 595]);

  page.drawRectangle({ x: 0, y: 0, width: 420, height: 595, color: rgb(1, 1, 1) });
  page.drawText('INVOICE', { x: 60, y: 440, size: 72, font, color: rgb(0, 0, 0) });
  page.drawText('TOTAL', { x: 60, y: 340, size: 72, font, color: rgb(0, 0, 0) });

  await write('scanned.pdf', await doc.save());
}

// A page that is one large photograph, for the size-reduction tests.
//
// The JPEG is drawn by Playwright's Chromium rather than by a Node image
// library: encoding JPEG is exactly what the feature hands to the browser, and
// this keeps the fixture honest without adding a dependency for a dev script.
// Deliberately busy — a flat image would compress to almost nothing, and there
// would be no size to reduce.
{
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const browserPage = await browser.newPage();
    const dataUrl = await browserPage.evaluate(
      /* eslint-disable no-undef -- this callback is serialised and run inside Chromium */
      ([width, height]) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const sky = ctx.createLinearGradient(0, 0, 0, height);
        sky.addColorStop(0, '#0b3d91');
        sky.addColorStop(1, '#f6c445');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, height);

        // Fine detail, so the encoder has something to spend bytes on.
        let seed = 12345;
        const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let i = 0; i < 700; i += 1) {
          ctx.fillStyle = `rgb(${random() * 255 | 0},${random() * 255 | 0},${random() * 255 | 0})`;
          ctx.fillRect(random() * width, random() * height, random() * 40 + 4, random() * 40 + 4);
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(height / 12)}px sans-serif`;
        ctx.fillText('PHOTO', width * 0.1, height * 0.55);

        return canvas.toDataURL('image/jpeg', 0.8);
      },
      /* eslint-enable no-undef */
      [2448, 3168],
    );

    const jpeg = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const doc = await PDFDocument.create();
    // US Letter, so 3168 px on the 11 in edge is a 288 DPI image.
    const page = doc.addPage([612, 792]);
    const embedded = await doc.embedJpg(jpeg);
    page.drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });

    await write('photo.pdf', await doc.save());
  } finally {
    await browser.close();
  }
}
