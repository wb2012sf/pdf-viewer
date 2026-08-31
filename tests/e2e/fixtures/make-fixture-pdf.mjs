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
