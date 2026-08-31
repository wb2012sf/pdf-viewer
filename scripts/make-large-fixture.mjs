// A realistically long document, for checking that the page panel copes.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 200; i += 1) {
  const page = doc.addPage([420, 595]);
  page.drawText(`Page ${i + 1}`, { x: 48, y: 500, size: 28, font });
  page.drawText('Body text '.repeat(20), { x: 48, y: 440, size: 9, font, maxWidth: 320 });
}
const out = fileURLToPath(new URL('../tests/e2e/fixtures/large.pdf', import.meta.url));
await writeFile(out, await doc.save());
console.log(`wrote ${out}`);
