// Regenerates the documents the end-to-end tests open.
// Run with: node tests/e2e/fixtures/make-fixture-pdf.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
