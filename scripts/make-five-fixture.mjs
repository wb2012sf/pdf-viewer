// Five identifiable pages: page i is (100 + i) points wide, so a test can prove
// which page ended up where after a reorder.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 5; i += 1) {
  const page = doc.addPage([100 + i, 200]);
  page.drawText(`Page ${i + 1}`, { x: 8, y: 100, size: 11, font });
}
const out = fileURLToPath(new URL('../tests/e2e/fixtures/five.pdf', import.meta.url));
await writeFile(out, await doc.save());
console.log(`wrote ${out}`);
