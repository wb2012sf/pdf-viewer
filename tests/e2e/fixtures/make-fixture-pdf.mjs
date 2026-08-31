// Regenerates sample.pdf, the document the end-to-end tests open.
// Run with: node tests/e2e/fixtures/make-fixture-pdf.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

for (const [index, heading] of ['First page', 'Second page'].entries()) {
  const page = doc.addPage([420, 595]);
  page.drawText(heading, { x: 48, y: 500, size: 28, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(`Sample fixture, page ${index + 1} of 2.`, { x: 48, y: 460, size: 12, font });
}

const out = fileURLToPath(new URL('./sample.pdf', import.meta.url));
await writeFile(out, await doc.save());
console.log(`wrote ${out}`);
